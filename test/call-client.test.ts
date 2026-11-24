import { CallClient, HttpSignaling } from '@packstub/holler'
import { exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBrowserGlobals } from './browser-fakes.js'
import { api, createMeeting, freshIp, joined } from './helpers'

/**
 * The real @packstub/holler CallClient, as the app configures it (docs/api.md),
 * talking to the Worker over HttpSignaling, with fake WebRTC underneath. Real
 * timers and fast polls: the server's timeouts are seconds, these tests are not.
 */

const clients: CallClient[] = []

beforeEach(() => {
    installBrowserGlobals()
})

afterEach(() => {
    for (const client of clients.splice(0)) client.destroy()
    vi.unstubAllGlobals()
})

type Person = { name: string, token: string, id: string }

function clientFor(code: string, person: Person) {
    const ip = freshIp()
    // workerd's Request has no `credentials`; everything else goes to the Worker as the browser would send it.
    const fetchViaWorker = async (url: string, init: RequestInit & { credentials?: string } = {}) => {
        const { credentials: _credentials, ...rest } = init
        return exports.default.fetch(new Request(new URL(url, 'http://meet.test'), rest))
    }

    const base = `/api/meetings/${code}/holler`
    const signaling = new HttpSignaling({
        routes: {
            poll: `${base}/poll`,
            store: `${base}/start`,
            answer: `${base}/answer`,
            decline: `${base}/decline`,
            hangup: `${base}/hangup`,
            signal: `${base}/signals`,
            leave: `${base}/leave`,
            hold: `${base}/hold`,
            resume: `${base}/resume`,
            ice: `${base}/ice`,
        },
        headers: { Authorization: `Bearer ${person.token}`, 'cf-connecting-ip': ip },
        beaconFields: { token: person.token },
        fetch: fetchViaWorker as typeof fetch,
    })

    const client = new CallClient({
        signaling,
        iceServers: () => signaling.configuration!().then((rtc: { iceServers: any[] }) => rtc.iceServers),
        maxParticipants: 4,
        poll: { idle: 40, active: 40, hidden: 40 },
        reconnectTimeout: 3000,
        statsInterval: 0,
    })
    const ended: string[] = []
    const left: string[] = []
    client.addEventListener('ended', (event: Event) => ended.push((event as CustomEvent).detail.reason))
    client.addEventListener('peerleft', (event: Event) => left.push((event as CustomEvent).detail.peer.id))
    clients.push(client)

    return Object.assign(client, { person, endedReasons: ended, leftPeers: left })
}

type Client = ReturnType<typeof clientFor>

/** Every connection a client has, once the offer and answer went through the Worker. */
function negotiated(client: Client, others: number) {
    const links = [...(client as any).topology?.links?.values() ?? []]
    return links.length === others && links.every((link: any) => link.pc.remoteDescription !== null && link.pc.signalingState === 'stable')
}

/** The network comes up on every connection. */
function connectAll(...all: Client[]) {
    for (const client of all) for (const link of (client as any).topology.links.values()) link.pc.setConnectionState('connected')
}

async function meetingOf(names: string[]) {
    const { code, hostKey } = await createMeeting()
    const people: Person[] = []
    for (const [index, name] of names.entries()) {
        const { token, participant } = await joined(code, index === 0 ? { name, hostKey } : { name })
        people.push({ name, token, id: participant.id })
    }

    return { code, hostKey, people }
}

const waitFor = <T>(check: () => T) => vi.waitFor(check, { timeout: 8000, interval: 20 })

describe('CallClient against the Worker', () => {
    it('connects three people in a mesh, signals going through D1', async () => {
        const { code, people } = await meetingOf(['Ion', 'Ana', 'Mihai'])
        const all = people.map((person) => clientFor(code, person))
        for (const client of all) client.resumeCall(code, { answer: true })

        await waitFor(() => {
            for (const client of all) expect(negotiated(client, 2)).toBe(true)
        })

        connectAll(...all)
        await waitFor(() => {
            for (const client of all) expect(client.state).toBe('active')
        })

        for (const client of all) {
            expect(client.peers.map((peer: { name: string }) => peer.name).sort()).toEqual(people.filter((p) => p !== client.person).map((p) => p.name).sort())
            expect(client.call?.id).toBe(code)
        }
        // Between two people the lower seat made the offer.
        const [ion] = all
        expect([...(ion as any).topology.links.values()].every((link: any) => link.pc.localDescription.type === 'offer')).toBe(true)
    })

    it('lets someone hang up while the others go on, and ends for everyone when the host ends it', async () => {
        const { code, hostKey, people } = await meetingOf(['Ion', 'Ana', 'Mihai'])
        const [ion, ana, mihai] = people.map((person) => clientFor(code, person))
        for (const client of [ion!, ana!, mihai!]) client.resumeCall(code, { answer: true })
        await waitFor(() => {
            for (const client of [ion!, ana!, mihai!]) expect(negotiated(client, 2)).toBe(true)
        })
        connectAll(ion!, ana!, mihai!)
        await waitFor(() => expect([ion!.state, ana!.state, mihai!.state]).toEqual(['active', 'active', 'active']))

        await mihai!.hangUp()
        await waitFor(() => {
            expect(ion!.leftPeers).toContain(mihai!.person.id)
            expect(ana!.leftPeers).toContain(mihai!.person.id)
        })
        expect(ion!.state).toBe('active')
        expect((await api('GET', `/api/meetings/${code}`)).body.participantCount).toBe(2)

        await api('POST', `/api/meetings/${code}/end`, { hostKey })
        await waitFor(() => {
            expect(ion!.endedReasons).toEqual(['ended'])
            expect(ana!.endedReasons).toEqual(['ended'])
        })
        expect(ion!.state).toBe('idle')
    })

    it('lets one person wait alone, and connects the next one who joins', async () => {
        const { code, people } = await meetingOf(['Ion'])
        const ion = clientFor(code, people[0]!)
        ion.resumeCall(code, { answer: true })
        await waitFor(() => expect(ion.call?.joined).toBe(true))

        // Alone for a while: no hang-up, no error.
        await new Promise((resolve) => setTimeout(resolve, 300))
        expect(ion.call?.status).toBe('ringing')
        expect(ion.endedReasons).toEqual([])

        const ana = await joined(code, { name: 'Ana' })
        const anaClient = clientFor(code, { name: 'Ana', token: ana.token, id: ana.participant.id })
        anaClient.resumeCall(code, { answer: true })
        await waitFor(() => {
            expect(negotiated(ion, 1)).toBe(true)
            expect(negotiated(anaClient, 1)).toBe(true)
        })
        connectAll(ion, anaClient)
        await waitFor(() => expect([ion.state, anaClient.state]).toEqual(['active', 'active']))
    })

    it('reconnects a reloaded page: a fresh client with the same token takes the side over', async () => {
        const { code, people } = await meetingOf(['Ion', 'Ana'])
        const ion = clientFor(code, people[0]!)
        let ana = clientFor(code, people[1]!)
        for (const client of [ion, ana]) client.resumeCall(code, { answer: true })
        await waitFor(() => expect([negotiated(ion, 1), negotiated(ana, 1)]).toEqual([true, true]))
        connectAll(ion, ana)
        await waitFor(() => expect([ion.state, ana.state]).toEqual(['active', 'active']))

        // The page goes away: the leave beacon, then a new page with the same token.
        const beacon = (globalThis as any).navigator.sendBeacon
        beacon.mockImplementation((url: string, body: FormData) => {
            void exports.default.fetch(new Request(new URL(url, 'http://meet.test'), { method: 'POST', body }))
            return true
        })
        ana.leave()
        ana.destroy()
        await new Promise((resolve) => setTimeout(resolve, 100))

        ana = clientFor(code, people[1]!)
        ana.start()
        await waitFor(() => expect(negotiated(ana, 1)).toBe(true))
        connectAll(ion, ana)
        await waitFor(() => expect([ion.state, ana.state]).toEqual(['active', 'active']))
        expect(ana.call?.claimed_elsewhere).toBe(false)
    })

    it('keeps the last one left in the meeting when the leaver\'s connection drops before their leave is polled', async () => {
        const { code, people } = await meetingOf(['Ion', 'Ana'])
        const [ion, ana] = people.map((person) => clientFor(code, person))
        for (const client of [ion!, ana!]) client.resumeCall(code, { answer: true })
        await waitFor(() => expect([negotiated(ion!, 1), negotiated(ana!, 1)]).toEqual([true, true]))
        connectAll(ion!, ana!)
        await waitFor(() => expect([ion!.state, ana!.state]).toEqual(['active', 'active']))

        // Ana's connection drops before Ion's next poll hears that she left. holler-js 1.0 armed its
        // reconnect timer here and hung Ion up as `dropped` (packstub/holler-js#16); now the call
        // rings again and he waits.
        for (const link of (ion as any).topology.links.values()) link.pc.setConnectionState('disconnected')
        await ana!.hangUp()

        await waitFor(() => expect(ion!.state).toBe('calling'))
        // Past the reconnect timeout (3 s in these tests).
        await new Promise((resolve) => setTimeout(resolve, 3500))
        expect(ion!.endedReasons).toEqual([])
        expect(ion!.state).toBe('calling')
        expect((await api('GET', `/api/meetings/${code}`)).body.status).toBe('open')
    }, 15000)
})

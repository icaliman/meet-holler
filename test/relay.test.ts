import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'
import { api, createMeeting, freshIp, joined, row } from './helpers'

/**
 * Relayed signaling on the Worker (docs/relay-signaling.md): who the hub is,
 * how its poll keeps the people connected to it alive, and what it brings back
 * for them. The client side is in relay-client.test.ts.
 */

afterEach(() => {
    vi.useRealTimers()
})

const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
}
const later = (seconds: number) => vi.setSystemTime(new Date(Date.now() + seconds * 1000))

type Person = { token: string, id: string, name: string }

/** A meeting that relays through its host, with the host and `guests` more in the call; nobody has polled yet. */
async function meeting(guests: string[] = ['Ana'], { relay = true }: { relay?: boolean } = {}) {
    const created = await createMeeting()
    if (relay) await env.DB.prepare(`UPDATE meetings SET relay = 'host' WHERE code = ?1`).bind(created.code).run()

    const host = await joined(created.code, { hostKey: created.hostKey, name: 'Ion' })
    const people: Person[] = [{ token: host.token, id: host.participant.id, name: 'Ion' }]
    for (const name of guests) {
        const guest = await joined(created.code, { name })
        people.push({ token: guest.token, id: guest.participant.id, name })
    }
    for (const person of people) await api('POST', `/api/meetings/${created.code}/holler/answer`, { token: person.token, body: { tab: tabOf(person) } })

    return { code: created.code, hostKey: created.hostKey, people }
}

const tabOf = (person: Person) => `tab-${person.id}`

/** The poll of a running client: it holds its side, and says whether it relays and (the hub) who is connected to it. */
function poll(code: string, person: Person, { relay = true, present = [] as Person[], after = 0, tab = tabOf(person) } = {}) {
    const query = new URLSearchParams({ after: String(after), call: code, tab, claim: '1' })
    if (relay) query.set('relay', '1')
    if (present.length) query.set('present', present.map((p) => p.id).join(','))

    return api('GET', `/api/meetings/${code}/holler/poll?${query}`, { token: person.token })
}

const send = (code: string, from: Person, to: Person, type = 'offer') => api('POST', `/api/meetings/${code}/holler/signals`, { token: from.token, body: { type, payload: { sdp: 'v=0' }, to: to.id } })
const participant = (id: string) => row<{ status: string, tab: string | null, seen_at: number, relay: number | null }>('SELECT status, tab, seen_at, relay FROM participants WHERE id = ?1', id)

describe('the flag', () => {
    it('is off unless RELAY_SIGNALING says host: the meeting and the call say nothing about relaying', async () => {
        const { code, people: [ion, ana] } = await meeting(['Ana'], { relay: false })

        expect((await api('GET', `/api/meetings/${code}`)).body.relay).toBeNull()
        const answer = await poll(code, ion!, { present: [ana!] })
        expect(answer.body.call).not.toHaveProperty('hub')
        expect(answer.body.call.peers[0]).not.toHaveProperty('hub')
        expect(answer.body.call.peers[0]).not.toHaveProperty('relay')
        expect(answer.body).not.toHaveProperty('relay')
        expect((await participant(ion!.id))!.relay).toBeNull()
    })

    it('makes new meetings relay through the host when the variable is set', async () => {
        const request = new Request('http://meet.test/api/meetings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': freshIp() },
            body: JSON.stringify({ visibility: 'public' }),
        })
        const response = await app.fetch(request, { ...env, RELAY_SIGNALING: 'host' })
        const { meeting: created } = await response.json<{ meeting: { code: string, relay: string | null } }>()

        expect(created.relay).toBe('host')
        expect((await api('GET', `/api/meetings/${created.code}`)).body.relay).toBe('host')
    })

    it('does not let a poll of a meeting that does not relay keep anyone else alive', async () => {
        at('2026-12-01T10:00:00Z')
        const { code, people: [ion, ana] } = await meeting(['Ana'], { relay: false })
        const before = (await participant(ana!.id))!.seen_at

        later(30)
        await poll(code, ion!, { present: [ana!] })

        expect((await participant(ana!.id))!.seen_at).toBe(before)
    })
})

describe('the hub', () => {
    it('is the host once its tab relays and holds its side, and every call says so', async () => {
        const { code, people: [ion, ana] } = await meeting()

        // Nobody has polled: no hub, and nobody has said whether they relay.
        const first = await poll(code, ana!)
        expect(first.body.call.hub).toBe(false)
        expect(first.body.call.peers[0]).toMatchObject({ id: ion!.id, hub: false, relay: null })

        const hub = await poll(code, ion!)
        expect(hub.body.call.hub).toBe(true)
        expect(hub.body.call.peers[0]).toMatchObject({ id: ana!.id, hub: false, relay: true })
        expect(hub.body.relay).toEqual({ views: {}, pending: [] })

        const second = await poll(code, ana!)
        expect(second.body.call.hub).toBe(false)
        expect(second.body.call.peers[0]).toMatchObject({ id: ion!.id, hub: true, relay: true })
        expect(second.body).not.toHaveProperty('relay')
    })

    it('is nobody while the host\'s tab does not relay, has gone quiet, or the host left', async () => {
        at('2026-12-01T10:00:00Z')
        const { code, people: [ion, ana] } = await meeting()

        // A tab without RelaySignaling.
        const plain = await poll(code, ion!, { relay: false })
        expect(plain.body.call.hub).toBe(false)
        expect(plain.body).not.toHaveProperty('relay')
        expect((await poll(code, ana!)).body.call.peers[0]).toMatchObject({ hub: false, relay: false })

        await poll(code, ion!)
        expect((await poll(code, ana!)).body.call.peers[0].hub).toBe(true)

        // Its tab went quiet for longer than a side is kept.
        later(25)
        expect((await poll(code, ana!)).body.call.peers[0].hub).toBe(false)

        await poll(code, ion!)
        expect((await poll(code, ana!)).body.call.peers[0].hub).toBe(true)
        await api('POST', `/api/meetings/${code}/holler/hangup`, { token: ion!.token })
        expect((await poll(code, ana!)).body.call.peers[0]).toMatchObject({ status: 'left', hub: false })
    })

    it('is never a guest', async () => {
        const { code, people: [ion, ana] } = await meeting()
        await api('POST', `/api/meetings/${code}/holler/hangup`, { token: ion!.token })

        const alone = await poll(code, ana!)
        expect(alone.body.call.hub).toBe(false)
        expect(alone.body).not.toHaveProperty('relay')
    })
})

describe('the people connected to the hub', () => {
    it('stay in the call without polling, for as long as the hub names them', async () => {
        at('2026-12-01T10:00:00Z')
        const { code, people: [ion, ana] } = await meeting()
        await poll(code, ion!)
        await poll(code, ana!)

        // Two minutes of a hub that polls every 3 seconds; Ana's tab asks nothing.
        for (let second = 0; second < 120; second += 3) {
            later(3)
            const answer = await poll(code, ion!, { present: [ana!] })
            expect(answer.body.call.peers[0]).toMatchObject({ id: ana!.id, status: 'joined', claimed: true, seen_ago: 0 })
        }

        expect(await participant(ana!.id)).toMatchObject({ status: 'joined', tab: tabOf(ana!) })
    })

    it('are dropped like anyone whose tab went quiet once the hub stops naming them', async () => {
        at('2026-12-01T10:00:00Z')
        const { code, people: [ion, ana] } = await meeting()
        await poll(code, ion!)
        await poll(code, ana!)

        for (let second = 0; second < 48; second += 3) {
            later(3)
            await poll(code, ion!)
        }

        expect((await participant(ana!.id))!.status).toBe('dropped')
    })

    it('are kept alive by the host only, from the tab that holds its side, and only if their own tab relays', async () => {
        at('2026-12-01T10:00:00Z')
        const { code, people: [ion, ana, mihai] } = await meeting(['Ana', 'Mihai'])
        await poll(code, ion!)
        await poll(code, ana!)
        await poll(code, mihai!, { relay: false })
        const seen = async () => [(await participant(ana!.id))!.seen_at, (await participant(mihai!.id))!.seen_at]
        const before = await seen()

        later(15)
        // A guest names the others: nothing.
        await poll(code, ana!, { present: [mihai!, ion!] })
        expect((await seen())[1]).toBe(before[1])
        // Another tab of the host, which does not hold the side: nothing.
        await poll(code, ion!, { present: [ana!, mihai!], tab: 'another-tab' })
        expect(await seen()).toEqual([Date.now(), before[1]])   // Ana polled herself just now

        later(15)
        // The hub names both: Ana's tab relays, Mihai's does not.
        await poll(code, ion!, { present: [ana!, mihai!] })
        expect(await seen()).toEqual([Date.now(), before[1]])
    })

    it('free their side with the leave beacon although the hub still names them', async () => {
        at('2026-12-01T10:00:00Z')
        const { code, people: [ion, ana] } = await meeting()
        await poll(code, ion!)
        await poll(code, ana!)

        const beacon = new FormData()
        beacon.append('tab', tabOf(ana!))
        beacon.append('token', ana!.token)
        await app.fetch(new Request(`http://meet.test/api/meetings/${code}/holler/leave`, { method: 'POST', body: beacon, headers: { 'cf-connecting-ip': freshIp() } }), env)
        const before = (await participant(ana!.id))!.seen_at

        later(15)
        await poll(code, ion!, { present: [ana!] })
        expect(await participant(ana!.id)).toMatchObject({ tab: null, seen_at: before })

        // Her reloaded page takes the side at once.
        const reloaded = await poll(code, ana!, { tab: 'new-tab' })
        expect(reloaded.body.call.claimed_elsewhere).toBe(false)
        expect((await participant(ana!.id))!.tab).toBe('new-tab')
    })
})

describe('what the hub passes on', () => {
    it('is, for each of them, what their own poll would answer', async () => {
        const { code, people: [ion, ana, mihai] } = await meeting(['Ana', 'Mihai'])
        await poll(code, ion!)
        await poll(code, ana!)
        await poll(code, mihai!)

        const hub = await poll(code, ion!, { present: [ana!, mihai!] })
        const own = await poll(code, ana!)

        expect(Object.keys(hub.body.relay.views).sort()).toEqual([ana!.id, mihai!.id].sort())
        expect(hub.body.relay.views[ana!.id]).toEqual({ call: own.body.call, incoming: null, on_hold: null, meeting: own.body.meeting })
        expect(hub.body.relay.views[ana!.id].call).toMatchObject({ seat: 1, joined: true, claimed_elsewhere: false, hub: false })
        // A guest's view never has the host's waiting list.
        expect(hub.body.relay.views[ana!.id].meeting).not.toHaveProperty('waiting')
        expect(hub.body.meeting).toHaveProperty('waiting')
    })

    it('leaves out strangers, the hub itself and tabs that do not relay', async () => {
        const { code, people: [ion, ana, mihai] } = await meeting(['Ana', 'Mihai'])
        await poll(code, ion!)
        await poll(code, ana!)
        await poll(code, mihai!, { relay: false })

        const query = new URLSearchParams({ call: code, tab: tabOf(ion!), claim: '1', relay: '1', present: `${ana!.id},${mihai!.id},${ion!.id},nobody,bad id!` })
        const hub = await api('GET', `/api/meetings/${code}/holler/poll?${query}`, { token: ion!.token })

        expect(Object.keys(hub.body.relay.views)).toEqual([ana!.id])
    })

    it('tells someone the host removed, and everyone when the meeting ends', async () => {
        const { code, hostKey, people: [ion, ana, mihai] } = await meeting(['Ana', 'Mihai'])
        await poll(code, ion!)
        await poll(code, ana!)
        await poll(code, mihai!)

        await api('POST', `/api/meetings/${code}/remove/${ana!.id}`, { hostKey })
        const removed = await poll(code, ion!, { present: [ana!, mihai!] })
        expect(removed.body.relay.views[ana!.id].call).toMatchObject({ status: 'ended', end_reason: 'removed' })
        expect(removed.body.relay.views[mihai!.id].call.peers.find((peer: { id: string }) => peer.id === ana!.id)).toMatchObject({ status: 'left' })

        await api('POST', `/api/meetings/${code}/end`, { hostKey })
        // The meeting is over: the host's poll still carries the news for the people connected to it.
        const over = await poll(code, ion!, { present: [mihai!] })
        expect(over.body.call).toMatchObject({ status: 'ended', end_reason: 'ended' })
        expect(over.body.relay.views[mihai!.id].call).toMatchObject({ status: 'ended', end_reason: 'ended' })
        // Not for a guest who asks.
        expect((await poll(code, mihai!, { present: [ion!] })).body).not.toHaveProperty('relay')
    })

    it('names who has signals waiting in D1, until they have read them', async () => {
        const { code, people: [ion, ana, mihai] } = await meeting(['Ana', 'Mihai'])
        await poll(code, ion!)
        await poll(code, ana!)
        await poll(code, mihai!, { relay: false })

        expect((await poll(code, ion!, { present: [ana!] })).body.relay.pending).toEqual([])

        // Mihai's tab does not relay: his offer to Ana goes to D1, where she does not look.
        expect((await send(code, mihai!, ana!)).status).toBe(201)
        expect((await poll(code, ion!, { present: [ana!] })).body.relay.pending).toEqual([ana!.id])

        // Told by the hub, she polls: the signal, then (the acknowledgement) nothing.
        const fetched = await poll(code, ana!)
        expect(fetched.body.signals).toHaveLength(1)
        expect((await poll(code, ana!, { after: fetched.body.cursor })).body.signals).toEqual([])
        expect((await poll(code, ion!, { present: [ana!] })).body.relay.pending).toEqual([])
    })
})

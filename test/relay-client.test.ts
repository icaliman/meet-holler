import { CallClient, HttpSignaling, RelaySignaling } from '@packstub/holler'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'
import { installBrowserGlobals, joinChannels } from './browser-fakes.js'
import { api, createMeeting, freshIp, joined, row } from './helpers'

/**
 * The real @packstub/holler CallClient behind RelaySignaling, as the app
 * configures it for a meeting that relays (docs/relay-signaling.md), against
 * the Worker, with fake WebRTC underneath: the connections and their data
 * channels come up when a test says so, and what one end of a channel sends
 * the other receives. Every request each browser makes is counted, with the
 * D1 rows it read and wrote: the numbers in docs/relay-signaling.md come from
 * the last test here.
 */

type Person = { name: string, token: string, id: string }
type Client = CallClient & { person: Person, code: string, relay: RelaySignaling | null, endedReasons: string[], leftPeers: string[], tally: Tally }
type Tally = { requests: Record<string, number>, rowsRead: number, rowsWritten: number, signalsTo: Record<string, number> }

const clients: Client[] = []
const tallies = new Map<string, Tally>()

beforeEach(() => {
    installBrowserGlobals()
    // The leave beacon of a page that goes away reaches the Worker too.
    ;(globalThis as any).navigator.sendBeacon.mockImplementation((url: string, body: FormData) => {
        void app.fetch(new Request(new URL(url, 'http://meet.test'), { method: 'POST', body, headers: { 'cf-connecting-ip': freshIp() } }), env)
        return true
    })
})

afterEach(() => {
    for (const client of clients.splice(0)) client.destroy()
    tallies.clear()
    vi.unstubAllGlobals()
})

/** D1 with every statement's `meta.rows_read` and `rows_written` added to a tally. */
function counted(db: D1Database, tally: Tally): D1Database {
    const add = (meta?: { rows_read?: number, rows_written?: number }) => {
        tally.rowsRead += meta?.rows_read ?? 0
        tally.rowsWritten += meta?.rows_written ?? 0
    }
    const watch = (statement: any): any => {
        const bind = statement.bind.bind(statement)
        statement.bind = (...values: unknown[]) => watch(bind(...values))
        for (const method of ['run', 'all']) {
            const original = statement[method].bind(statement)
            statement[method] = async (...args: unknown[]) => {
                const result = await original(...args)
                add(result.meta)
                return result
            }
        }
        statement.first = async (column?: string) => {
            const first = (await statement.all()).results[0] ?? null
            return column && first ? first[column] ?? null : first
        }

        return statement
    }

    return new Proxy(db, {
        get(target, property) {
            if (property === 'prepare') return (sql: string) => watch(target.prepare(sql))
            if (property === 'batch') {
                return async (statements: D1PreparedStatement[]) => {
                    const results = await target.batch(statements)
                    for (const result of results) add(result.meta)
                    return results
                }
            }
            const value = Reflect.get(target, property)
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
}

function tallyOf(name: string): Tally {
    if (! tallies.has(name)) tallies.set(name, { requests: {}, rowsRead: 0, rowsWritten: 0, signalsTo: {} })
    return tallies.get(name)!
}

function clientFor(code: string, person: Person, { relay = true }: { relay?: boolean } = {}): Client {
    const ip = freshIp()
    const tally = tallyOf(person.name)
    const worker = { ...env, DB: counted(env.DB, tally) }

    // workerd's Request has no `credentials`; everything else goes to the Worker as the browser would send it.
    const fetchViaWorker = async (url: string, init: RequestInit & { credentials?: string } = {}) => {
        const { credentials: _credentials, ...rest } = init
        const route = new URL(url, 'http://meet.test').pathname.split('/').pop()!
        tally.requests[route] = (tally.requests[route] ?? 0) + 1
        if (route === 'signals') {
            const to = JSON.parse(String(rest.body)).to ?? 'everyone'
            tally.signalsTo[to] = (tally.signalsTo[to] ?? 0) + 1
        }

        return app.fetch(new Request(new URL(url, 'http://meet.test'), rest), worker)
    }

    const base = `/api/meetings/${code}/holler`
    const http = new HttpSignaling({
        routes: {
            poll: `${base}/poll`,
            store: `${base}/start`,
            answer: `${base}/answer`,
            decline: `${base}/decline`,
            hangup: `${base}/hangup`,
            signal: `${base}/signals`,
            leave: `${base}/leave`,
            ice: `${base}/ice`,
        },
        headers: { Authorization: `Bearer ${person.token}`, 'cf-connecting-ip': ip },
        beaconFields: { token: person.token },
        fetch: fetchViaWorker as typeof fetch,
    })
    const relaying = relay ? new RelaySignaling(http) : null

    const client = new CallClient({
        signaling: relaying ?? http,
        iceServers: () => http.configuration().then((rtc) => rtc.iceServers),
        maxParticipants: 4,
        poll: { idle: 40, active: 40, hidden: 40 },
        reconnectTimeout: 3000,
        statsInterval: 0,
        channels: ['annotations'],
    })
    const ended: string[] = []
    const left: string[] = []
    client.addEventListener('ended', (event) => ended.push(event.detail.reason))
    client.addEventListener('peerleft', (event) => left.push(event.detail.peer.id))

    const made = Object.assign(client, { person, code, relay: relaying, endedReasons: ended, leftPeers: left, tally })
    clients.push(made)

    return made
}

const waitFor = <T>(check: () => T) => vi.waitFor(check, { timeout: 8000, interval: 10 })
const link = (from: Client, to: Client) => (from as any).topology?.link?.(to.person.id) ?? null
const total = (client: Client) => Object.values(client.tally.requests).reduce((sum, count) => sum + count, 0)
const polls = (client: Client) => client.tally.requests.poll ?? 0

/** How many ICE candidates each end of a connection finds in these tests; a browser finds 3 to 15. */
const CANDIDATES = 5

/** Two clients negotiate (wherever their signals travel), exchange candidates, and the network between them comes up. */
async function connectPair(a: Client, b: Client) {
    const settled = (from: Client, to: Client) => {
        const pc = link(from, to)?.pc
        expect(pc?.remoteDescription ?? null).not.toBeNull()
        expect(pc.signalingState).toBe('stable')
    }
    await waitFor(() => { settled(a, b); settled(b, a) })

    const [ab, ba] = [link(a, b), link(b, a)]
    for (let i = 0; i < CANDIDATES; i++) {
        ab.pc.gatherCandidate({ candidate: `candidate:${a.person.name}-${i}`, sdpMid: '0', sdpMLineIndex: 0 })
        ba.pc.gatherCandidate({ candidate: `candidate:${b.person.name}-${i}`, sdpMid: '0', sdpMLineIndex: 0 })
    }
    await waitFor(() => {
        expect(link(a, b)?.pc.candidates.length).toBeGreaterThanOrEqual(CANDIDATES)
        expect(link(b, a)?.pc.candidates.length).toBeGreaterThanOrEqual(CANDIDATES)
    })

    up(a, b)
}

/** The network between two clients: the connection, and the data channels on it. */
function up(a: Client, b: Client) {
    link(a, b).pc.setConnectionState('connected')
    link(b, a).pc.setConnectionState('connected')
    joinChannels(link(a, b), link(b, a))
}

async function newMeeting({ relay = true } = {}) {
    const created = await createMeeting()
    if (relay) await env.DB.prepare(`UPDATE meetings SET relay = 'host' WHERE code = ?1`).bind(created.code).run()

    return created
}

async function person(code: string, name: string, hostKey?: string): Promise<Person> {
    const { token, participant } = await joined(code, hostKey ? { name, hostKey } : { name })

    return { name, token, id: participant.id }
}

/** Someone joins the meeting and connects to everyone already in it, the way a browser would. */
async function enter(code: string, room: Client[], who: Person, options: { relay?: boolean } = {}) {
    const client = clientFor(code, who, options)
    client.resumeCall(code, { answer: true })
    for (const other of room) await connectPair(other, client)
    room.push(client)
    if (room.length > 1) await waitFor(() => { for (const each of room) expect(each.state).toBe('active') })

    return client
}

/** A meeting with the host (Ion) and these guests, everyone connected to everyone. */
async function room(names: string[], { relay = true, relayMeeting = true } = {}) {
    const { code, hostKey } = await newMeeting({ relay: relayMeeting })
    const all: Client[] = []
    await enter(code, all, await person(code, 'Ion', hostKey), { relay })
    for (const name of names) await enter(code, all, await person(code, name), { relay })
    if (relay && relayMeeting) await waitFor(() => { for (const guest of all.slice(1)) expect(guest.relay!.mode).toBe('quiet') })

    return { code, hostKey, all }
}

/** Wait while the host polls `count` more times. */
async function hostPolls(host: Client, count: number) {
    const from = polls(host)
    await waitFor(() => expect(polls(host) - from).toBeGreaterThanOrEqual(count))
}

describe('a meeting that relays through its host', () => {
    it('connects three people with only the host polling, and nothing between two guests touching the Worker', async () => {
        const { code, all: [ion, ana, mihai] } = await room(['Ana', 'Mihai'])

        expect([ion!.relay!.mode, ana!.relay!.mode, mihai!.relay!.mode]).toEqual(['hub', 'quiet', 'quiet'])
        for (const client of [ion!, ana!, mihai!]) {
            expect(client.state).toBe('active')
            expect(client.peers.map((peer) => peer.name).sort()).toEqual(['Ion', 'Ana', 'Mihai'].filter((name) => name !== client.person.name).sort())
            expect(client.peers.every((peer) => peer.connected && peer.alive)).toBe(true)
        }
        // Ana and Mihai never posted a signal for each other: the offer, the answer and the candidates went through Ion.
        expect(ana!.tally.signalsTo[mihai!.person.id]).toBeUndefined()
        expect(mihai!.tally.signalsTo[ana!.person.id]).toBeUndefined()
        expect(ion!.relay!.stats.relayed).toBeGreaterThanOrEqual(2 + 2 * CANDIDATES)

        const before = [total(ana!), total(mihai!)]
        await hostPolls(ion!, 40)
        expect([total(ana!), total(mihai!)]).toEqual(before)

        // What they tell each other needs no request either, and the server still has all three in.
        ana!.setMuted(true)
        await waitFor(() => {
            expect(ion!.peers.find((peer) => peer.id === ana!.person.id)!.muted).toBe(true)
            expect(mihai!.peers.find((peer) => peer.id === ana!.person.id)!.muted).toBe(true)
        })
        expect([total(ana!), total(mihai!)]).toEqual(before)
        expect((await api('GET', `/api/meetings/${code}`)).body.participantCount).toBe(3)
    }, 30000)

    it('carries the meeting itself to the quiet guests: the lock, a removal, the end', async () => {
        const { code, hostKey, all: [ion, ana, mihai] } = await room(['Ana', 'Mihai'])
        const told: Array<{ locked?: boolean }> = []
        const poll = ana!.relay!.poll.bind(ana!.relay!)
        ana!.relay!.poll = async (params) => {
            const answer = await poll(params) as { meeting?: { locked?: boolean } }
            if (answer.meeting) told.push(answer.meeting)
            return answer as any
        }
        const before = total(ana!)

        await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { locked: true } })
        await waitFor(() => expect(told.at(-1)?.locked).toBe(true))

        await api('POST', `/api/meetings/${code}/remove/${mihai!.person.id}`, { hostKey })
        await waitFor(() => {
            expect(mihai!.endedReasons).toEqual(['removed'])
            expect(ana!.leftPeers).toContain(mihai!.person.id)
        })
        expect(total(ana!)).toBe(before)

        await api('POST', `/api/meetings/${code}/end`, { hostKey })
        await waitFor(() => {
            expect(ion!.endedReasons).toEqual(['ended'])
            expect(ana!.endedReasons).toEqual(['ended'])
        })
    }, 30000)

    it('lets guests who came before the host poll as always, and rest once the host is in', async () => {
        const { code, hostKey } = await newMeeting()
        const all: Client[] = []
        const ana = await enter(code, all, await person(code, 'Ana'))
        const mihai = await enter(code, all, await person(code, 'Mihai'))

        expect([ana.relay!.mode, mihai.relay!.mode]).toEqual(['polling', 'polling'])
        const before = [polls(ana), polls(mihai)]
        await waitFor(() => {
            expect(polls(ana) - before[0]!).toBeGreaterThan(10)
            expect(polls(mihai) - before[1]!).toBeGreaterThan(10)
        })

        const ion = await enter(code, all, await person(code, 'Ion', hostKey))
        await waitFor(() => expect([ion.relay!.mode, ana.relay!.mode, mihai.relay!.mode]).toEqual(['hub', 'quiet', 'quiet']))
        const after = [total(ana), total(mihai)]
        await hostPolls(ion, 30)
        expect([total(ana), total(mihai)]).toEqual(after)
    }, 30000)
})

describe('when the host is not there', () => {
    it('reloads: the guests poll at once, reconnect to its new page and rest again', async () => {
        const { code, all } = await room(['Ana', 'Mihai'])
        const [ion, ana, mihai] = all
        const before = [polls(ana!), polls(mihai!)]

        // The host's page goes away: the leave beacon, every connection closed.
        ion!.leave()
        ion!.destroy()
        await waitFor(() => {
            expect([ana!.relay!.mode, mihai!.relay!.mode]).toEqual(['polling', 'polling'])
            expect(polls(ana!)).toBeGreaterThan(before[0]!)
            expect(polls(mihai!)).toBeGreaterThan(before[1]!)
        })
        expect([ana!.state, mihai!.state]).toEqual(['active', 'active'])

        // Its new page, with the same token.
        const again = clientFor(code, ion!.person)
        again.start()
        await connectPair(again, ana!)
        await connectPair(again, mihai!)

        await waitFor(() => {
            expect([again.relay!.mode, ana!.relay!.mode, mihai!.relay!.mode]).toEqual(['hub', 'quiet', 'quiet'])
            expect([again.state, ana!.state, mihai!.state]).toEqual(['active', 'active', 'active'])
        })
        expect([ana!.endedReasons, mihai!.endedReasons]).toEqual([[], []])
        const after = [total(ana!), total(mihai!)]
        await hostPolls(again, 30)
        expect([total(ana!), total(mihai!)]).toEqual(after)
    }, 30000)

    it('leaves: the guests go on by polling, and rest again when a host joins', async () => {
        const { code, hostKey, all } = await room(['Ana', 'Mihai'])
        const [ion, ana, mihai] = all

        await ion!.hangUp()
        await waitFor(() => {
            expect([ana!.relay!.mode, mihai!.relay!.mode]).toEqual(['polling', 'polling'])
            expect(ana!.leftPeers).toContain(ion!.person.id)
            expect(mihai!.leftPeers).toContain(ion!.person.id)
        })
        expect([ana!.state, mihai!.state]).toEqual(['active', 'active'])
        const before = [polls(ana!), polls(mihai!)]
        await waitFor(() => {
            expect(polls(ana!) - before[0]!).toBeGreaterThan(10)
            expect(polls(mihai!) - before[1]!).toBeGreaterThan(10)
        })

        // The host comes back through the join link: a new participant, the hub again.
        const guests = [ana!, mihai!]
        const back = await enter(code, guests, await person(code, 'Ion', hostKey))
        await waitFor(() => expect([back.relay!.mode, ana!.relay!.mode, mihai!.relay!.mode]).toEqual(['hub', 'quiet', 'quiet']))
        expect([ana!.endedReasons, mihai!.endedReasons]).toEqual([[], []])
    }, 30000)

    it('loses the channel to one guest only: that guest polls, the other rests on', async () => {
        const { all: [ion, ana, mihai] } = await room(['Ana', 'Mihai'])
        const before = total(mihai!)

        link(ana!, ion!).channels.get('holler:relay').close()
        await waitFor(() => expect(ana!.relay!.mode).toBe('polling'))
        const from = polls(ana!)
        await hostPolls(ion!, 20)

        expect(polls(ana!) - from).toBeGreaterThan(10)
        expect(total(mihai!)).toBe(before)
        expect([ion!.state, ana!.state, mihai!.state]).toEqual(['active', 'active', 'active'])
        expect(ana!.endedReasons).toEqual([])
    }, 30000)
})

describe('a meeting with tabs that relay and tabs that do not', () => {
    it('connects everyone: the old tab polls, the quiet guest fetches what it sent when the host says so', async () => {
        const { code, all } = await room(['Ana'])
        const [ion, ana] = all
        const mihai = await enter(code, all, await person(code, 'Mihai'), { relay: false })

        expect([ion!.state, ana!.state, mihai.state]).toEqual(['active', 'active', 'active'])
        // Between Ana and Mihai everything went through D1, as it does today.
        expect(ana!.tally.signalsTo[mihai.person.id]).toBeGreaterThanOrEqual(1 + CANDIDATES)
        expect(mihai.tally.signalsTo[ana!.person.id]).toBeGreaterThanOrEqual(1 + CANDIDATES)

        await waitFor(() => expect(ana!.relay!.mode).toBe('quiet'))
        const before = [total(ana!), polls(mihai)]
        await hostPolls(ion!, 30)
        expect(total(ana!)).toBe(before[0])
        expect(polls(mihai) - before[1]!).toBeGreaterThan(15)

        // Later signals cross both ways.
        mihai.setMuted(true)
        await waitFor(() => expect(ana!.peers.find((peer) => peer.id === mihai.person.id)!.muted).toBe(true))
        ana!.setCameraOff(true)
        await waitFor(() => expect(mihai.peers.find((peer) => peer.id === ana!.person.id)!.cameraOff).toBe(true))
        await waitFor(() => expect(ana!.relay!.mode).toBe('quiet'))
    }, 30000)

    it('changes nothing for a meeting that does not relay, whatever the tabs can do', async () => {
        const { all: [ion, ana, mihai] } = await room(['Ana', 'Mihai'], { relayMeeting: false })

        expect([ion!.relay!.mode, ana!.relay!.mode, mihai!.relay!.mode]).toEqual(['polling', 'polling', 'polling'])
        const before = [polls(ana!), polls(mihai!)]
        await hostPolls(ion!, 20)
        expect(polls(ana!) - before[0]!).toBeGreaterThan(10)
        expect(polls(mihai!) - before[1]!).toBeGreaterThan(10)
        expect(ion!.call).not.toHaveProperty('hub')
    }, 30000)
})

describe('what it costs', () => {
    /**
     * The same meeting with and without relaying: what connecting it costs, and what
     * every poll of the host costs once it runs. docs/relay-signaling.md turns the
     * steady numbers into an hour at the app's poll intervals.
     */
    async function measure(size: number, relay: boolean) {
        tallies.clear()
        const { all } = await room(['Ana', 'Mihai', 'Dana'].slice(0, size - 1), { relay })
        const [host, ...guests] = all
        const sum = (pick: (client: Client) => number) => all.reduce((total, client) => total + pick(client), 0)
        const snapshot = () => ({
            requests: sum(total),
            polls: sum(polls),
            posts: sum((client) => client.tally.requests.signals ?? 0),
            rowsRead: sum((client) => client.tally.rowsRead),
            rowsWritten: sum((client) => client.tally.rowsWritten),
            guestRequests: guests.reduce((count, guest) => count + total(guest), 0),
        })

        const connected = snapshot()
        const hostBefore = polls(host!)
        await hostPolls(host!, 50)
        const after = snapshot()
        const hostCycles = polls(host!) - hostBefore

        for (const client of all) {
            client.destroy()
            clients.splice(clients.indexOf(client), 1)
        }

        return {
            size,
            relay,
            connect: { requests: connected.requests, polls: connected.polls, posts: connected.posts, rowsRead: connected.rowsRead, rowsWritten: connected.rowsWritten },
            // Per poll of the host, in a meeting where every tab polls at the same interval.
            steady: {
                requests: +((after.requests - connected.requests) / hostCycles).toFixed(2),
                guestRequests: after.guestRequests - connected.guestRequests,
                rowsRead: +((after.rowsRead - connected.rowsRead) / hostCycles).toFixed(1),
                rowsWritten: +((after.rowsWritten - connected.rowsWritten) / hostCycles).toFixed(2),
            },
        }
    }

    it('measures 2, 3 and 4 people, with and without relaying', async () => {
        const results = []
        for (const size of [2, 3, 4]) {
            for (const relay of [false, true]) results.push(await measure(size, relay))
        }
        console.log(`RELAY-MEASURE ${JSON.stringify(results)}`)

        for (const size of [2, 3, 4]) {
            const plain = results.find((result) => result.size === size && ! result.relay)!
            const relayed = results.find((result) => result.size === size && result.relay)!
            // Once connected, the guests of a relayed meeting ask nothing; without it everyone polls.
            expect(relayed.steady.guestRequests).toBe(0)
            expect(relayed.steady.requests).toBeLessThanOrEqual(1.1)
            expect(plain.steady.requests).toBeGreaterThan(size - 0.5)
            // Connecting costs no more signals than without, and from three people on fewer.
            expect(relayed.connect.posts).toBeLessThanOrEqual(plain.connect.posts)
            if (size > 2) expect(relayed.connect.posts).toBeLessThan(plain.connect.posts)
        }
        expect(await row('SELECT COUNT(*) AS n FROM signals')).toMatchObject({ n: expect.any(Number) })
    }, 120000)
})

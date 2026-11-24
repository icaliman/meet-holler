import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { iceServers } from '../worker/holler/ice'
import { MAX_PENDING_SIGNALS, MAX_SIGNAL_BYTES } from '../worker/holler/routes'
import { api, createMeeting, joined, row, rows } from './helpers'

afterEach(() => {
    vi.useRealTimers()
})

const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
}
const later = (seconds: number) => vi.setSystemTime(new Date(Date.now() + seconds * 1000))

type Person = { token: string, id: string, name: string }

/** A meeting with the host and `guests` more, all admitted (not answered yet). */
async function meeting(guests: string[] = ['Ana'], fields: Record<string, unknown> = {}) {
    const created = await createMeeting(fields)
    const host = await joined(created.code, { hostKey: created.hostKey, name: 'Ion' })
    const people: Person[] = [{ token: host.token, id: host.participant.id, name: 'Ion' }]
    for (const name of guests) {
        const guest = await joined(created.code, { name })
        people.push({ token: guest.token, id: guest.participant.id, name })
    }

    return { code: created.code, hostKey: created.hostKey, people }
}

function holler(code: string, person: Person | null, method: string, path: string, body?: unknown) {
    return api(method, `/api/meetings/${code}/holler/${path}`, { token: person?.token, body })
}

function poll(code: string, person: Person, params: Record<string, string | number | boolean> = {}) {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))
    return holler(code, person, 'GET', `poll?${query}`)
}

/** A tab that holds its side: the poll a running CallClient sends. */
const claimPoll = (code: string, person: Person, tab: string, after = 0) => poll(code, person, { after, call: code, tab, claim: 1 })

const answer = (code: string, person: Person, tab = `tab-${person.id}`) => holler(code, person, 'POST', 'answer', { tab })
const send = (code: string, person: Person, type: string, payload: unknown, to?: string) => holler(code, person, 'POST', 'signals', to === undefined ? { type, payload } : { type, payload, to })

describe('the call of a meeting', () => {
    it('rings an admitted participant until they answer', async () => {
        const { code, people: [ion] } = await meeting([])

        const named = await poll(code, ion!, { call: code, tab: 't1', claim: 1 })
        expect(named.status).toBe(200)
        expect(named.body.call).toMatchObject({ id: code, kind: 'call', status: 'ringing', role: 'caller', seat: 0, joined: false, on_hold: false, peers: [] })
        expect(named.body.incoming).toBeNull()

        // A client that only started polling (no resumeCall) sees it ring as `incoming`.
        const unnamed = await poll(code, ion!, { tab: 't1' })
        expect(unnamed.body.call).toBeNull()
        expect(unnamed.body.incoming).toMatchObject({ id: code, joined: false })
    })

    it('stays `ringing` while one person is in it and turns `active` with two', async () => {
        const { code, people: [ion, ana] } = await meeting(['Ana'])

        const first = await answer(code, ion!)
        expect(first.status).toBe(200)
        expect(first.body).toMatchObject({ status: 'ringing', joined: true, answered_at: null })
        expect(first.body.peers).toEqual([{ id: ana!.id, name: 'Ana', avatar: null, seat: 1, status: 'ringing', claimed: false, seen_ago: null }])

        const second = await answer(code, ana!)
        expect(second.body).toMatchObject({ status: 'active', role: 'callee', seat: 1, joined: true, answered_at: expect.any(String) })
        expect(second.body.peers).toEqual([{ id: ion!.id, name: 'Ion', avatar: null, seat: 0, status: 'joined', claimed: true, seen_ago: 0 }])
        expect(second.body.peer).toEqual({ id: ion!.id, name: 'Ion', avatar: null })
        expect(second.body.peer_claimed).toBe(true)
    })

    it('refuses a second answer as not_ringing', async () => {
        const { code, people: [ion] } = await meeting([])
        await answer(code, ion!)

        const again = await answer(code, ion!)
        expect(again.status).toBe(409)
        expect(again.body.reason).toBe('not_ringing')
    })

    it('picks the call up again after a reload, from a poll that names nothing', async () => {
        const { code, people: [ion] } = await meeting([])
        await answer(code, ion!)

        const reloaded = await poll(code, ion!, { tab: 'fresh-tab' })
        expect(reloaded.body.call).toMatchObject({ id: code, joined: true })
        expect(reloaded.body.incoming).toBeNull()
    })

    it('refuses nobody-is-rung `start`, waiting guests and missing tokens', async () => {
        const { code, people: [ion] } = await meeting([], { waitingRoom: true })
        const waiting = await joined(code, { name: 'Waits' })

        const start = await holler(code, ion!, 'POST', 'start', { callee: 'x' })
        expect(start.status).toBe(422)
        expect(start.body.reason).toBe('not_allowed')

        const asWaiting = await poll(code, { token: waiting.token, id: waiting.participant.id, name: 'Waits' }, { call: code })
        expect(asWaiting.status).toBe(403)
        expect(asWaiting.body.reason).toBe('not_allowed')

        expect((await holler(code, null, 'GET', 'poll')).status).toBe(401)
        expect((await holler(code, null, 'POST', 'answer', {})).status).toBe(401)
    })

    it('returns nothing to a poll for another kind of call', async () => {
        const { code, people: [ion] } = await meeting([])
        await answer(code, ion!)

        const other = await poll(code, ion!, { kind: 'chat', call: code })
        expect(other.body).toMatchObject({ call: null, incoming: null, on_hold: null })
    })
})

describe('signals', () => {
    async function talking(guests = ['Ana']) {
        const setup = await meeting(guests)
        for (const person of setup.people) await answer(setup.code, person)

        return setup
    }

    it('reach the other participant in order, with the sender and the cursor', async () => {
        const { code, people: [ion, ana] } = await talking()

        expect((await send(code, ion!, 'offer', { sdp: 'v=0 offer' })).status).toBe(201)
        for (let i = 0; i < 5; i++) await send(code, ion!, 'ice', { candidate: `c${i}` })

        const received = await claimPoll(code, ana!, `tab-${ana!.id}`)
        expect(received.body.signals.map((s: { type: string, payload: unknown }) => [s.type, s.payload])).toEqual([
            ['offer', { sdp: 'v=0 offer' }],
            ...[0, 1, 2, 3, 4].map((i) => ['ice', { candidate: `c${i}` }]),
        ])
        expect(received.body.signals.every((s: { from: string, call: string }) => s.from === ion!.id && s.call === code)).toBe(true)
        const ids = received.body.signals.map((s: { id: number }) => s.id)
        expect(ids).toEqual([...ids].sort((a, b) => a - b))
        expect(received.body.cursor).toBe(ids.at(-1))

        // The sender gets nothing of its own.
        expect((await claimPoll(code, ion!, `tab-${ion!.id}`)).body.signals).toEqual([])
    })

    it('are delivered once: the next poll after the cursor acknowledges and deletes them', async () => {
        const { code, people: [ion, ana] } = await talking()
        await send(code, ion!, 'offer', { sdp: 'x' })
        await send(code, ion!, 'ice', { candidate: 'a' })

        const tab = `tab-${ana!.id}`
        const first = await claimPoll(code, ana!, tab, 0)
        expect(first.body.signals).toHaveLength(2)

        // A poll that asked from the middle gets the rest again (the response may have been lost).
        const resent = await claimPoll(code, ana!, tab, first.body.signals[0].id)
        expect(resent.body.signals.map((s: { type: string }) => s.type)).toEqual(['ice'])

        const next = await claimPoll(code, ana!, tab, first.body.cursor)
        expect(next.body.signals).toEqual([])
        expect(next.body.cursor).toBe(first.body.cursor)
        expect(await rows('SELECT id FROM signals WHERE to_id = ?', ana!.id)).toEqual([])
    })

    it('go to everyone else, or to one person with `to`', async () => {
        const { code, people: [ion, ana, mihai] } = await talking(['Ana', 'Mihai'])

        await send(code, ion!, 'state', { muted: true })
        await send(code, ion!, 'offer', { sdp: 'for ana' }, ana!.id)

        const anaGot = (await claimPoll(code, ana!, `tab-${ana!.id}`)).body.signals.map((s: { type: string }) => s.type)
        const mihaiGot = (await claimPoll(code, mihai!, `tab-${mihai!.id}`)).body.signals.map((s: { type: string }) => s.type)
        expect(anaGot).toEqual(['state', 'offer'])
        expect(mihaiGot).toEqual(['state'])
    })

    it('reach someone admitted who has not answered yet, once they answer', async () => {
        const { code, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)

        await send(code, ion!, 'offer', { sdp: 'early' })
        await answer(code, ana!)

        expect((await claimPoll(code, ana!, `tab-${ana!.id}`)).body.signals.map((s: { payload: unknown }) => s.payload)).toEqual([{ sdp: 'early' }])
    })

    it('are refused before answering, to strangers, of unknown types, too large, or not objects', async () => {
        const { code, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)

        const early = await send(code, ana!, 'offer', {})
        expect(early.status).toBe(422)
        expect(early.body.reason).toBe('not_allowed')

        const stranger = await send(code, ion!, 'offer', {}, 'nobody')
        expect(stranger.status).toBe(422)
        expect(stranger.body.reason).toBe('not_allowed')
        expect((await send(code, ion!, 'offer', {}, ion!.id)).body.reason).toBe('not_allowed')

        expect((await send(code, ion!, 'chat', {})).status).toBe(422)
        expect((await send(code, ion!, 'offer', 'sdp')).status).toBe(422)
        expect((await send(code, ion!, 'offer', ['a'])).status).toBe(422)

        const huge = await send(code, ion!, 'offer', { sdp: 'x'.repeat(MAX_SIGNAL_BYTES) })
        expect(huge.status).toBe(413)
        expect(huge.body.reason).toBe('too_large')
    })

    it('stop at 200 unread from one sender', async () => {
        const { code, people: [ion, ana] } = await talking()
        const insert = env.DB.prepare(`INSERT INTO signals (meeting_code, to_id, from_id, type, payload, created_at) VALUES (?, ?, ?, 'ice', '{}', ?)`)
        await env.DB.batch(Array.from({ length: MAX_PENDING_SIGNALS }, () => insert.bind(code, ana!.id, ion!.id, Date.now())))

        const response = await send(code, ion!, 'ice', {})
        expect(response.status).toBe(429)
        expect(response.body.reason).toBe('too_many')
        expect((await row('SELECT COUNT(*) AS n FROM signals WHERE to_id = ?', ana!.id)).n).toBe(MAX_PENDING_SIGNALS)
    })

    it('flow only to the tab that holds the side', async () => {
        const { code, people: [ion, ana] } = await talking()
        await send(code, ion!, 'offer', { sdp: 'x' })

        // Ana answered from her own tab; a second tab of hers is told someone else has the call.
        const other = await claimPoll(code, ana!, 'second-tab')
        expect(other.body.signals).toEqual([])
        expect(other.body.call.claimed_elsewhere).toBe(true)

        const own = await claimPoll(code, ana!, `tab-${ana!.id}`)
        expect(own.body.signals).toHaveLength(1)
        expect(own.body.call.claimed_elsewhere).toBe(false)
    })

    it('meant for a tab that went quiet are skipped by the tab that takes over', async () => {
        at('2027-10-01T10:00:00Z')
        const { code, people: [ion, ana] } = await talking()
        await send(code, ion!, 'offer', { sdp: 'for the old tab' })

        later(21)
        await claimPoll(code, ion!, `tab-${ion!.id}`)
        const takeover = await claimPoll(code, ana!, 'new-tab')
        expect(takeover.body.signals).toEqual([])
        expect(takeover.body.call.claimed_elsewhere).toBe(false)
        expect(takeover.body.cursor).toBeGreaterThan(0)

        await send(code, ion!, 'reset', {})
        const next = await claimPoll(code, ana!, 'new-tab', takeover.body.cursor)
        expect(next.body.signals.map((s: { type: string }) => s.type)).toEqual(['reset'])
    })

    it('meant for a tab that sent the leave beacon are skipped too, and the side is free at once', async () => {
        const { code, people: [ion, ana] } = await talking()
        await send(code, ion!, 'offer', { sdp: 'old' })

        const form = new FormData()
        form.append('tab', `tab-${ana!.id}`)
        form.append('token', ana!.token)
        const beacon = await exports.default.fetch(`http://meet.test/api/meetings/${code}/holler/leave`, { method: 'POST', body: form })
        expect(beacon.status).toBe(204)
        expect((await row('SELECT tab FROM participants WHERE id = ?', ana!.id)).tab).toBeNull()

        const reloaded = await claimPoll(code, ana!, 'reloaded-tab')
        expect(reloaded.body.call.claimed_elsewhere).toBe(false)
        expect(reloaded.body.signals).toEqual([])
    })

    it('refuse a leave beacon without a valid token', async () => {
        const { code } = await talking()
        const form = new FormData()
        form.append('tab', 'x')
        form.append('token', 'forged.token')

        expect((await exports.default.fetch(`http://meet.test/api/meetings/${code}/holler/leave`, { method: 'POST', body: form })).status).toBe(401)
    })
})

describe('heartbeats and quiet tabs', () => {
    it('writes the heartbeat at most every 10 seconds and reports a live tab as just seen', async () => {
        at('2027-11-01T10:00:00Z')
        const { code, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)
        await answer(code, ana!)
        const answeredAt = (await row('SELECT seen_at FROM participants WHERE id = ?', ion!.id)).seen_at

        for (let i = 0; i < 3; i++) {
            later(3)
            await claimPoll(code, ion!, `tab-${ion!.id}`)
        }
        expect((await row('SELECT seen_at FROM participants WHERE id = ?', ion!.id)).seen_at).toBe(answeredAt)

        later(3)
        await claimPoll(code, ion!, `tab-${ion!.id}`)
        expect((await row('SELECT seen_at FROM participants WHERE id = ?', ion!.id)).seen_at).toBe(Date.now())

        // 14 s after Ion's last write, Ana still sees him alive.
        later(14)
        const view = await claimPoll(code, ana!, `tab-${ana!.id}`)
        expect(view.body.call.peers[0]).toMatchObject({ id: ion!.id, claimed: true, seen_ago: 0 })

        // 21 s after: no longer claimed, and seen_ago past Holler's "alive" (< 6).
        later(7)
        const stale = await claimPoll(code, ana!, `tab-${ana!.id}`)
        expect(stale.body.call.peers[0]).toMatchObject({ claimed: false, seen_ago: 6 })
    })

    it('drops someone whose tab has been quiet for 45 seconds, then forgets them', async () => {
        at('2027-11-02T10:00:00Z')
        const { code, people: [ion, ana, mihai] } = await meeting(['Ana', 'Mihai'])
        for (const person of [ion!, ana!, mihai!]) await answer(code, person)

        for (let i = 0; i < 5; i++) {
            later(10)
            await claimPoll(code, ion!, `tab-${ion!.id}`)
            await claimPoll(code, ana!, `tab-${ana!.id}`)
        }

        const view = await claimPoll(code, ion!, `tab-${ion!.id}`)
        expect(view.body.call.status).toBe('active')
        expect(view.body.call.peers.find((p: { id: string }) => p.id === mihai!.id)).toMatchObject({ status: 'dropped' })
        expect((await api('GET', `/api/meetings/${code}/me`, { token: mihai!.token })).body.participant.state).toBe('left')

        for (let i = 0; i < 2; i++) {
            later(31)
            await claimPoll(code, ana!, `tab-${ana!.id}`)
            await claimPoll(code, ion!, `tab-${ion!.id}`)
        }
        const after = await claimPoll(code, ion!, `tab-${ion!.id}`)
        expect(after.body.call.peers.map((p: { id: string }) => p.id)).toEqual([ana!.id])
    })

    it('marks someone admitted who never answered as missed after a minute', async () => {
        at('2027-11-03T10:00:00Z')
        const { code, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)

        later(30)
        await claimPoll(code, ion!, `tab-${ion!.id}`)
        later(31)
        const view = await claimPoll(code, ion!, `tab-${ion!.id}`)
        expect(view.body.call.peers).toEqual([expect.objectContaining({ id: ana!.id, status: 'missed' })])
        expect((await answer(code, ana!)).body.reason).toBe('not_ringing')
    })
})

describe('leaving and ending', () => {
    it('lets someone hang up while the meeting goes on, back to `ringing` for the one left', async () => {
        const { code, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)
        await answer(code, ana!)
        await send(code, ion!, 'offer', {})

        const hungUp = await holler(code, ana!, 'POST', 'hangup')
        expect(hungUp.status).toBe(200)
        expect(hungUp.body.joined).toBe(false)
        expect(await rows('SELECT id FROM signals WHERE to_id = ?', ana!.id)).toEqual([])

        const view = await claimPoll(code, ion!, `tab-${ion!.id}`)
        expect(view.body.call.status).toBe('ringing')
        expect(view.body.call.peers).toEqual([expect.objectContaining({ id: ana!.id, status: 'left' })])

        expect((await poll(code, ana!, { call: code, tab: 'x', claim: 1 })).body.call).toBeNull()
        expect((await api('GET', `/api/meetings/${code}/me`, { token: ana!.token })).body.participant.state).toBe('left')
        expect((await api('GET', `/api/meetings/${code}`)).body.status).toBe('open')
    })

    it('lets someone decline before answering', async () => {
        const { code, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)

        await holler(code, ana!, 'POST', 'decline')
        const view = await claimPoll(code, ion!, `tab-${ion!.id}`)
        expect(view.body.call.peers).toEqual([expect.objectContaining({ id: ana!.id, status: 'declined' })])
    })

    it('ends the call for everyone when the host ends the meeting', async () => {
        const { code, hostKey, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)
        await answer(code, ana!)
        await send(code, ana!, 'offer', {})

        await api('POST', `/api/meetings/${code}/end`, { hostKey })

        const view = await claimPoll(code, ana!, `tab-${ana!.id}`)
        expect(view.body.call).toMatchObject({ id: code, status: 'ended', end_reason: 'ended' })
        expect(view.body.signals).toEqual([])
        expect(await rows('SELECT id FROM signals WHERE meeting_code = ?', code)).toEqual([])

        const late = await send(code, ion!, 'offer', {})
        expect(late.status).toBe(410)
        expect(late.body.reason).toBe('ended')
    })

    it('tells someone removed by the host, through the call', async () => {
        const { code, hostKey, people: [ion, ana] } = await meeting(['Ana'])
        await answer(code, ion!)
        await answer(code, ana!)

        await api('POST', `/api/meetings/${code}/remove/${ana!.id}`, { hostKey })

        const view = await claimPoll(code, ana!, `tab-${ana!.id}`)
        expect(view.body.call).toMatchObject({ status: 'ended', end_reason: 'removed' })
        expect((await send(code, ana!, 'offer', {})).status).toBe(403)
        expect((await claimPoll(code, ion!, `tab-${ion!.id}`)).body.call.peers).toEqual([expect.objectContaining({ id: ana!.id, status: 'left' })])
    })
})

describe('hold', () => {
    it('steps out of a running call and back in', async () => {
        const { code, people: [ion, ana] } = await meeting(['Ana'])

        await answer(code, ion!)
        const alone = await holler(code, ion!, 'POST', 'hold')
        expect(alone.status).toBe(422)
        expect(alone.body.reason).toBe('not_allowed')

        await answer(code, ana!)
        const held = await holler(code, ana!, 'POST', 'hold')
        expect(held.status).toBe(200)
        expect(held.body).toMatchObject({ on_hold: true, joined: false, status: 'active' })

        const mine = await poll(code, ana!, { call: code, tab: 'x', claim: 1 })
        expect(mine.body.call).toBeNull()
        expect(mine.body.on_hold).toMatchObject({ id: code, on_hold: true })

        // Nothing is queued for someone on hold.
        await send(code, ion!, 'state', { muted: true })
        expect(await rows('SELECT id FROM signals WHERE to_id = ?', ana!.id)).toEqual([])
        expect((await claimPoll(code, ion!, `tab-${ion!.id}`)).body.call.peers[0].status).toBe('on_hold')

        const resumed = await holler(code, ana!, 'POST', 'resume', { tab: 'back' })
        expect(resumed.body).toMatchObject({ on_hold: false, joined: true, claimed_elsewhere: false })
        expect((await holler(code, ana!, 'POST', 'resume', { tab: 'back' })).body.reason).toBe('not_allowed')
    })
})

describe('the meeting in the poll', () => {
    it('carries the waiting list for the host only', async () => {
        const { code, people: [ion] } = await meeting([], { waitingRoom: true, title: 'Review' })
        await joined(code, { name: 'Waits' })

        const host = await poll(code, ion!, { call: code })
        expect(host.body.meeting).toEqual({ status: 'open', title: 'Review', locked: false, waitingRoom: true, waiting: [expect.objectContaining({ name: 'Waits' })] })
    })

    it('leaves the waiting list out for guests', async () => {
        const { code, people: [, ana] } = await meeting(['Ana'])

        expect((await poll(code, ana!, {})).body.meeting).not.toHaveProperty('waiting')
    })
})

describe('ICE servers', () => {
    it('answers STUN, never cached', async () => {
        const { code, people: [ion] } = await meeting([])
        const response = await holler(code, ion!, 'GET', 'ice')

        expect(response.body).toEqual({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], iceTransportPolicy: 'all' })
        expect(response.headers.get('Cache-Control')).toBe('no-store')
    })

    it('adds Cloudflare TURN credentials when configured, without port 53', async () => {
        const fetcher = vi.fn(async () => Response.json({
            iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53', 'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp'], username: 'u', credential: 'c' }],
        }))
        const config = await iceServers({ ...env, TURN_KEY_ID: 'key', TURN_KEY_API_TOKEN: 'token' }, fetcher as unknown as typeof fetch)

        expect(fetcher).toHaveBeenCalledWith('https://rtc.live.cloudflare.com/v1/turn/keys/key/credentials/generate-ice-servers', expect.objectContaining({ method: 'POST' }))
        expect(config.iceServers).toEqual([
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
        ])
    })

    it('falls back to STUN when TURN does not answer', async () => {
        const config = await iceServers({ ...env, TURN_KEY_ID: 'key', TURN_KEY_API_TOKEN: 'token' }, (async () => { throw new Error('down') }) as unknown as typeof fetch)

        expect(config.iceServers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }])
    })
})

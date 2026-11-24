// The Holler signaling routes of docs/api.md ("Holler signaling") in memory, for `npm run dev`:
// enough for two or more browser tabs on this machine to see and hear each other through
// @packstub/holler. Timeouts are the Worker's (20 s to free a quiet tab's side, 45 s to drop it).

import type { MockMeeting, MockParticipant, MockRequest, MockResponse, MockStore } from './mock-store'

interface Signal {
    id: number
    call: string
    type: string
    payload: unknown
    from: string
    to: string
}

const SIDE_FREE_MS = 20_000
const DROP_MS = 45_000
const MISSED_MS = 60_000

const fail = (status: number, reason: string, message: string): MockResponse => ({ status, body: { error: { code: status === 403 ? 'forbidden' : 'invalid', message }, message, reason } })

export function installHoller(store: MockStore): void {
    const signals: Signal[] = []
    let ids = 0
    const leftAt = new Map<string, number>()
    const admittedAt = new Map<string, number>()

    function joined(meeting: MockMeeting): MockParticipant[] {
        return store.admitted(meeting).filter((p) => p.joined)
    }

    /** Drops people whose tab went quiet, and marks as missed those who never answered. */
    function expire(meeting: MockMeeting): void {
        const now = store.now()
        for (const p of meeting.participants.values()) {
            if (p.state !== 'admitted') continue
            if (! admittedAt.has(p.id)) admittedAt.set(p.id, now)
            if (p.joined && now - p.seenAt > DROP_MS) leave(p)
            else if (! p.joined && now - admittedAt.get(p.id)! > MISSED_MS && now - p.seenAt > MISSED_MS) leave(p)
        }
    }

    function leave(p: MockParticipant): void {
        p.state = 'left'
        p.joined = false
        p.tab = null
        leftAt.set(p.id, store.now())
    }

    function present(meeting: MockMeeting, me: MockParticipant, tab: string | null) {
        const now = store.now()
        const inCall = joined(meeting)
        const ended = meeting.ended || me.state === 'removed'
        const peers = [...meeting.participants.values()]
            .filter((p) => p.id !== me.id)
            .filter((p) => p.state === 'admitted' || (p.state === 'left' && now - (leftAt.get(p.id) ?? 0) < 60_000))
            .map((p) => ({
                id: p.id,
                name: p.name,
                avatar: null,
                seat: p.seat,
                role: p.role === 'host' ? 'host' : 'guest',
                status: p.state === 'left' ? 'left' : p.joined ? 'joined' : 'ringing',
                claimed: Boolean(p.tab) && now - p.seenAt < SIDE_FREE_MS,
                seen_ago: Math.floor((now - p.seenAt) / 1000),
            }))
        const first = peers.find((p) => p.status === 'joined') ?? null

        return {
            id: meeting.code,
            kind: 'call',
            status: ended ? 'ended' : inCall.length >= 2 ? 'active' : 'ringing',
            end_reason: meeting.ended ? 'ended' : me.state === 'removed' ? 'removed' : null,
            role: me.role === 'host' ? 'caller' : 'callee',
            seat: me.seat,
            joined: me.joined,
            peers,
            peer: first,
            peer_claimed: first?.claimed ?? false,
            peer_seen_ago: first?.seen_ago ?? null,
            answered_at: inCall.length >= 2 ? new Date(now).toISOString() : null,
            on_hold: false,
            claimed_elsewhere: Boolean(me.tab && tab && me.tab !== tab && now - me.seenAt < SIDE_FREE_MS),
        }
    }

    function meetingView(meeting: MockMeeting, me: MockParticipant) {
        return {
            status: store.status(meeting),
            title: meeting.title,
            locked: meeting.locked,
            waitingRoom: meeting.waitingRoom,
            ...(me.role === 'host'
                ? { waiting: [...meeting.participants.values()].filter((p) => p.state === 'waiting').map(({ id, name, since }) => ({ id, name, since })) }
                : {}),
        }
    }

    store.extensions.push((req: MockRequest): MockResponse | null => {
        const match = /^\/api\/meetings\/([^/]+)\/holler\/([a-z-]+)$/.exec(req.path)
        if (! match) return null
        const meeting = store.meetings.get(match[1].replace(/-/g, '').toLowerCase())
        if (! meeting) return fail(404, 'not_found', 'No such meeting.')
        const me = store.auth(req, meeting)
        if (! me) return fail(401, 'not_allowed', 'Join the meeting first.')
        const route = match[2]
        expire(meeting)

        // A removed participant and an ended meeting still poll once, to learn why.
        const ended = meeting.ended || me.state === 'removed'
        if (route !== 'poll' && route !== 'leave' && route !== 'ice' && ! ended && me.state !== 'admitted') return fail(403, 'not_allowed', 'You are not in this meeting.')

        const now = store.now()
        const body = req.body ?? {}

        switch (route) {
            case 'ice':
                // Two tabs on one machine need no STUN; and dev makes no outside requests.
                return { status: 200, body: { iceServers: [], iceTransportPolicy: 'all' } }

            case 'start':
                return fail(422, 'not_allowed', 'Nobody is rung in a meeting.')

            case 'poll': {
                const after = Number(req.query.get('after') ?? 0)
                const tab = req.query.get('tab')
                const named = req.query.get('call')
                const claim = req.query.get('claim') === '1'
                let cursor = after

                if (me.state !== 'admitted' && ! ended) {
                    return { status: 200, body: { call: null, incoming: null, on_hold: null, signals: [], cursor, meeting: meetingView(meeting, me) } }
                }

                if (claim && tab && named) {
                    const free = ! me.tab || me.tab === tab || now - me.seenAt > SIDE_FREE_MS
                    if (free) {
                        if (me.tab !== tab) {
                            // A fresh tab takes over: the old tab's unread signals are not for it.
                            cursor = Math.max(cursor, ...signals.filter((s) => s.to === me.id).map((s) => s.id), 0)
                        }
                        me.tab = tab
                    }
                }
                if (tab && me.tab === tab) me.seenAt = now
                else if (! me.tab) me.seenAt = now

                // Read signals up to `after` are acknowledged.
                for (let i = signals.length - 1; i >= 0; i--) if (signals[i].to === me.id && signals[i].id <= after) signals.splice(i, 1)

                const mine = me.tab && me.tab === tab
                    ? signals.filter((s) => s.to === me.id && s.id > cursor).slice(0, 100)
                    : []
                if (mine.length) cursor = mine[mine.length - 1].id

                const call = present(meeting, me, tab)
                const named_ = Boolean(named)

                return {
                    status: 200,
                    body: {
                        call: named_ || me.joined || ended ? call : null,
                        incoming: ! named_ && ! me.joined && ! ended ? call : null,
                        on_hold: null,
                        signals: mine.map(({ id, call, type, payload, from }) => ({ id, call, type, payload, from })),
                        cursor,
                        meeting: meetingView(meeting, me),
                    },
                }
            }

            case 'answer':
                if (ended) return fail(410, 'ended', 'This meeting has ended.')
                if (me.joined) return fail(409, 'not_ringing', 'Already in the call.')
                me.joined = true
                me.tab = body.tab ?? me.tab
                me.seenAt = now

                return { status: 200, body: present(meeting, me, body.tab ?? null) }

            case 'decline':
            case 'hangup':
                leave(me)

                return { status: 200, body: present(meeting, me, null) }

            case 'signals': {
                if (ended) return fail(410, 'ended', 'This meeting has ended.')
                if (! me.joined) return fail(422, 'not_allowed', 'Answer first.')
                const targets = body.to
                    ? [meeting.participants.get(String(body.to))].filter((p): p is MockParticipant => Boolean(p && p.state === 'admitted'))
                    : store.admitted(meeting).filter((p) => p.id !== me.id)
                if (body.to && ! targets.length) return fail(422, 'not_allowed', 'Not in the call.')
                for (const target of targets) signals.push({ id: ++ids, call: meeting.code, type: body.type, payload: body.payload ?? {}, from: me.id, to: target.id })

                return { status: 201, body: { id: ids } }
            }

            case 'leave':
                if (me.tab && me.tab === body.tab) me.tab = null

                return { status: 204, text: '' }
        }

        return fail(404, 'not_allowed', 'No such route.')
    })
}

import { CLAIM_STALE_MS, LEFT_VISIBLE_MS, SEEN_GRACE_MS, WAITING_STALE_MS } from '../lib/timing'
import { LIVE, meetingStatus, waitingEntry, type MeetingRow, type ParticipantRow, type ParticipantStatus } from '../meetings/model'

const GONE: ParticipantStatus[] = ['left', 'declined', 'missed', 'dropped', 'removed']

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

/** A tab holds this side and polled recently enough to keep it. */
export function isClaimed(participant: ParticipantRow, now: number): boolean {
    return participant.tab !== null && participant.seen_at !== null && now - participant.seen_at <= CLAIM_STALE_MS
}

/**
 * Seconds since the participant's tab last polled, as Holler means it. The
 * heartbeat is written at most every 10 s, so the stored time lags a live tab
 * by up to SEEN_GRACE_MS: that lag is taken off, or every peer would look gone
 * to holler-js (`alive` is `seen_ago < 6`).
 */
export function seenAgo(participant: ParticipantRow, now: number): number | null {
    if (participant.seen_at === null) return null

    return Math.max(0, Math.round((now - participant.seen_at - SEEN_GRACE_MS) / 1000))
}

/**
 * The hub of a meeting that relays (docs/relay-signaling.md): its host, in the
 * call, with a tab that relays and holds its side. The one browser that polls
 * for everyone connected to it. With two hosts in (the host key on two
 * devices), the one who came first.
 */
export function hubOf(meeting: MeetingRow, participants: ParticipantRow[], now: number): ParticipantRow | null {
    if (meeting.relay !== 'host' || meeting.ended_at !== null) return null

    return participants
        .filter((p) => p.role === 'host' && p.status === 'joined' && p.relay === 1 && isClaimed(p, now))
        .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))[0] ?? null
}

/** People in the call proper: answered, or on hold. */
export function inCallCount(participants: ParticipantRow[]): number {
    return participants.filter((p) => p.status === 'joined' || p.status === 'on_hold').length
}

/**
 * The meeting's call as `me` sees it, in Holler's shape (holler-js README,
 * "The signaling interface"). The call id is the meeting code.
 *
 * `status` is `ringing` while fewer than two people are in the call: holler-js
 * hangs up an `active` call with nobody to connect to, and a meeting must let
 * one person wait for the others.
 */
export function presentCall(meeting: MeetingRow, participants: ParticipantRow[], me: ParticipantRow, tab: string | null, now: number) {
    const ended = meeting.ended_at !== null
    const removed = me.status === 'removed'
    // Only a meeting that relays says anything about it: every other call looks as it always did.
    const relays = meeting.relay === 'host'
    const hub = relays ? hubOf(meeting, participants, now) : null

    // Someone the host removed is told so, and nothing more: who is still in the meeting is no longer theirs to know.
    const peers = (removed ? [] : participants)
        .filter((p) => p.id !== me.id && p.seat !== null)
        .filter((p) => LIVE.includes(p.status) || (GONE.includes(p.status) && (p.left_at ?? 0) >= now - LEFT_VISIBLE_MS))
        .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
        .map((p) => ({
            id: p.id,
            name: p.name,
            avatar: null,
            seat: p.seat,
            // From the participant's row, which only /join writes (from the hostKey): never from anything a client sends.
            role: p.role === 'host' ? 'host' as const : 'guest' as const,
            status: p.status === 'removed' ? 'left' : p.status,
            claimed: isClaimed(p, now),
            seen_ago: seenAgo(p, now),
            ...(relays ? { hub: hub?.id === p.id, relay: p.relay === null || p.relay === undefined ? null : p.relay === 1 } : {}),
        }))

    const first = peers.find((p) => LIVE.includes(p.status as ParticipantStatus)) ?? peers[0] ?? null

    return {
        id: meeting.code,
        kind: 'call',
        status: ended || removed ? 'ended' : inCallCount(participants) >= 2 ? 'active' : 'ringing',
        end_reason: ended ? (meeting.end_reason ?? 'ended') : removed ? 'removed' : null,
        role: me.role === 'host' ? 'caller' : 'callee',
        seat: me.seat,
        joined: me.status === 'joined',
        on_hold: me.status === 'on_hold',
        answered_at: iso(meeting.answered_at),
        claimed_elsewhere: isClaimed(me, now) && me.tab !== tab,
        ...(relays ? { hub: hub?.id === me.id } : {}),
        peers,
        peer: first ? { id: first.id, name: first.name, avatar: null } : null,
        peer_claimed: first?.claimed ?? false,
        peer_seen_ago: first?.seen_ago ?? null,
    }
}

/** What the call page needs besides the call; the waiting list for the host only. */
export function meetingView(meeting: MeetingRow, participants: ParticipantRow[], me: ParticipantRow, now: number) {
    return {
        status: meetingStatus(meeting, now),
        title: meeting.title,
        locked: meeting.locked === 1,
        waitingRoom: meeting.waiting_room === 1,
        ...(me.role === 'host'
            ? {
                waiting: participants
                    .filter((p) => p.status === 'waiting' && (p.seen_at ?? 0) >= now - WAITING_STALE_MS)
                    .sort((a, b) => a.created_at - b.created_at)
                    .map(waitingEntry),
            }
            : {}),
    }
}

/**
 * What the hub's poll brings back for the people connected to it (`present`):
 * for each, what a poll of their own would answer, and who has signals waiting
 * in D1 (a tab that does not relay sent them). The hub passes both on over its
 * data channels. Costs no query: everything is in the rows the poll read.
 */
export function relayAnswer(meeting: MeetingRow, participants: ParticipantRow[], hub: ParticipantRow, present: string[], pending: string[], now: number) {
    const ended = meeting.ended_at !== null
    const views: Record<string, unknown> = {}

    for (const id of present) {
        const p = participants.find((candidate) => candidate.id === id)
        if (! p || p.id === hub.id || p.seat === null || p.relay !== 1) continue

        const inCall = (LIVE.includes(p.status) && p.status !== 'on_hold') || ended || p.status === 'removed'
        views[p.id] = {
            call: inCall ? presentCall(meeting, participants, p, p.tab, now) : null,
            incoming: null,
            on_hold: ! ended && p.status === 'on_hold' ? presentCall(meeting, participants, p, p.tab, now) : null,
            meeting: meetingView(meeting, participants, p, now),
        }
    }

    return { views, pending: pending.filter((id) => id in views) }
}

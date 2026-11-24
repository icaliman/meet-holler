import { CAPACITY, DROP_AFTER_MS, HOLD_TIMEOUT_MS, RING_TIMEOUT_MS } from '../lib/timing'

export type MeetingRow = {
    code: string
    title: string | null
    visibility: 'public' | 'private'
    passcode_hash: string | null
    waiting_room: number
    locked: number
    scheduled_at: number | null
    duration_min: number | null
    host_name: string | null
    host_key_hash: string
    created_at: number
    opened_at: number | null
    answered_at: number | null
    ended_at: number | null
    end_reason: string | null
    pass_failures: number
    pass_window: number | null
    /** `host`: signaling is relayed through the host's browser (docs/relay-signaling.md). */
    relay?: 'host' | null
}

export type ParticipantStatus =
    | 'waiting' | 'denied' | 'removed'
    | 'ringing' | 'joined' | 'on_hold'
    | 'left' | 'declined' | 'missed' | 'dropped'

export type ParticipantRow = {
    id: string
    meeting_code: string
    name: string
    role: 'host' | 'guest'
    status: ParticipantStatus
    seat: number | null
    tab: string | null
    seen_at: number | null
    claim_nonce: string | null
    created_at: number
    admitted_at: number | null
    left_at: number | null
    /** Whether this tab takes signaling over a data channel; null until its first poll. */
    relay?: number | null
}

export type MeetingStatus = 'scheduled' | 'open' | 'ended'

/** In the meeting's call: admitted (ringing until they answer), in it, or on hold. */
export const LIVE: ParticipantStatus[] = ['ringing', 'joined', 'on_hold']
export const LIVE_SQL = `('ringing', 'joined', 'on_hold')`

/**
 * Whether a live participant has gone quiet past its timeout; the same rule as
 * EXPIRE_SQL, for counting without writing.
 */
export const FRESH_SQL = (alias = '') => {
    const p = alias ? `${alias}.` : ''
    return `((${p}status = 'joined' AND ${p}seen_at >= ?NOW - ${DROP_AFTER_MS})
        OR (${p}status = 'ringing' AND COALESCE(${p}seen_at, ${p}admitted_at) >= ?NOW - ${RING_TIMEOUT_MS})
        OR (${p}status = 'on_hold' AND ${p}seen_at >= ?NOW - ${HOLD_TIMEOUT_MS}))`
}

/**
 * Marks the people of a meeting who went quiet: dropped from the call, or
 * missed when they never answered. One statement that writes only when
 * someone expired, so it rides along in every poll's batch for free.
 */
export function expireStatement(db: D1Database, code: string, now: number): D1PreparedStatement {
    return db.prepare(`
        UPDATE participants
        SET status = CASE status WHEN 'ringing' THEN 'missed' ELSE 'dropped' END, tab = NULL, left_at = ?2
        WHERE meeting_code = ?1 AND status IN ${LIVE_SQL} AND NOT ${FRESH_SQL().replaceAll('?NOW', '?2')}
    `).bind(code, now)
}

/** The number of live, fresh participants, as a SELECT (no writes). */
export function liveCountStatement(db: D1Database, code: string, now: number): D1PreparedStatement {
    return db.prepare(`SELECT COUNT(*) AS n FROM participants WHERE meeting_code = ?1 AND status IN ${LIVE_SQL} AND ${FRESH_SQL().replaceAll('?NOW', '?2')}`).bind(code, now)
}

/** Admission into the call takes the next seat, and only while there is room (checked in the same statement). */
export const NEXT_SEAT_SQL = `(SELECT COALESCE(MAX(seat), -1) + 1 FROM participants WHERE meeting_code = ?1)`
export const ROOM_SQL = `((SELECT COUNT(*) FROM participants WHERE meeting_code = ?1 AND status IN ${LIVE_SQL}) < ${CAPACITY})`

export function meetingStatus(meeting: MeetingRow, now: number): MeetingStatus {
    if (meeting.ended_at !== null) return 'ended'
    if (meeting.scheduled_at !== null && meeting.opened_at === null && now < meeting.scheduled_at) return 'scheduled'

    return 'open'
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

/**
 * The meeting object of the API. `withheld` is a private meeting as someone
 * with only the link sees it: that it exists, when it is and that it needs a
 * passcode, so the app can show the passcode field or the countdown. What it
 * is about, who hosts it, how many are in and whether it is locked are for
 * people who got in (or hold the host key): those are `null`.
 */
export function publicMeeting(meeting: MeetingRow, participantCount: number, now: number, withheld = false) {
    return {
        code: meeting.code,
        title: withheld ? null : meeting.title,
        visibility: meeting.visibility,
        requiresPasscode: meeting.visibility === 'private',
        waitingRoom: meeting.waiting_room === 1,
        scheduledAt: iso(meeting.scheduled_at),
        durationMin: meeting.duration_min,
        status: meetingStatus(meeting, now),
        locked: withheld ? null : meeting.locked === 1,
        participantCount: withheld ? null : participantCount,
        capacity: CAPACITY,
        hostName: withheld ? null : meeting.host_name,
        relay: meeting.relay ?? null,
    }
}

export type ParticipantState = 'waiting' | 'admitted' | 'denied' | 'removed' | 'left'

export function participantState(status: ParticipantStatus): ParticipantState {
    if (status === 'waiting' || status === 'denied' || status === 'removed') return status
    if (LIVE.includes(status)) return 'admitted'

    return 'left'
}

export function publicParticipant(participant: ParticipantRow) {
    return { id: participant.id, name: participant.name, role: participant.role, state: participantState(participant.status) }
}

export function waitingEntry(participant: ParticipantRow) {
    return { id: participant.id, name: participant.name, since: new Date(participant.created_at).toISOString() }
}

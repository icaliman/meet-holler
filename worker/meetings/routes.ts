import { Hono, type Context } from 'hono'
import { newCode } from '../lib/codes'
import { hashPasscode, randomToken, safeEqual, sha256Hex, signToken, verifyPasscode } from '../lib/crypto'
import { ApiError, invalid } from '../lib/errors'
import { clientIp, clientKey, durableRateLimit, hitDurable, rateLimit } from '../lib/ratelimit'
import { PASSCODE_MAX_FAILURES, PASSCODE_WINDOW_MS, WAITING_HEARTBEAT_MS, WAITING_STALE_MS } from '../lib/timing'
import { jsonBody, optionalBoolean, optionalSecret, optionalText, requiredText } from '../lib/validate'
import { codeFrom, findMeeting, requireHost, requireParticipant, routeCode } from './auth'
import { meetingIcs } from './ics'
import {
    expireStatement, liveCountStatement, meetingStatus, NEXT_SEAT_SQL, publicMeeting, publicParticipant, ROOM_SQL, waitingEntry,
    type MeetingRow, type ParticipantRow,
} from './model'

export const meetings = new Hono<{ Bindings: Env }>()

const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60_000
const SCHEDULE_PAST_GRACE_MS = 5 * 60_000

const ended = () => new ApiError('ended', 'This meeting has ended.', 'ended')
const full = () => new ApiError('full', 'This meeting is full: four people are already in it.', 'full')

async function countLive(db: D1Database, code: string, now: number): Promise<number> {
    return (await liveCountStatement(db, code, now).first<{ n: number }>())?.n ?? 0
}

async function meetingResponse(db: D1Database, meeting: MeetingRow, now: number) {
    return publicMeeting(meeting, await countLive(db, meeting.code, now), now)
}

// ---- create ------------------------------------------------------------------

meetings.post('/', rateLimit('create'), durableRateLimit('create'), async (c) => {
    const body = await jsonBody(c)
    const now = Date.now()

    const title = optionalText(body, 'title', 100)
    const hostName = optionalText(body, 'hostName', 60)
    const visibility = body.visibility ?? 'public'
    if (visibility !== 'public' && visibility !== 'private') throw invalid('visibility must be public or private.')

    const passcode = optionalSecret(body, 'passcode')
    if (visibility === 'private' && ! passcode) throw invalid('A private meeting needs a passcode.')
    if (visibility === 'public' && passcode) throw invalid('A public meeting has no passcode: make it private to set one.')
    if (passcode && (passcode.length < 4 || passcode.length > 64)) throw invalid('The passcode must be 4 to 64 characters.')

    const waitingRoom = optionalBoolean(body, 'waitingRoom') ?? false

    let scheduledAt: number | null = null
    let durationMin: number | null = null
    if (body.scheduledAt !== undefined && body.scheduledAt !== null) {
        if (typeof body.scheduledAt !== 'string' || Number.isNaN(Date.parse(body.scheduledAt))) throw invalid('scheduledAt must be an ISO date and time.')
        scheduledAt = Date.parse(body.scheduledAt)
        if (scheduledAt < now - SCHEDULE_PAST_GRACE_MS) throw invalid('scheduledAt is in the past.')
        if (scheduledAt > now + MAX_SCHEDULE_AHEAD_MS) throw invalid('scheduledAt can be at most a year ahead.')

        durationMin = 60
        if (body.durationMin !== undefined && body.durationMin !== null) {
            if (typeof body.durationMin !== 'number' || ! Number.isInteger(body.durationMin) || body.durationMin < 5 || body.durationMin > 480) {
                throw invalid('durationMin must be a whole number of minutes from 5 to 480.')
            }
            durationMin = body.durationMin
        }
    }

    // Everyone together, counted last: a request that was refused or invalid uses none of it.
    await hitDurable(c.env.DB, 'createAll', '*', now, 'A lot of meetings are being created right now. Try again in a few minutes.')

    const hostKey = randomToken(24)
    const row: MeetingRow = {
        code: '',
        title,
        visibility,
        passcode_hash: passcode ? await hashPasscode(passcode) : null,
        waiting_room: waitingRoom ? 1 : 0,
        locked: 0,
        scheduled_at: scheduledAt,
        duration_min: durationMin,
        host_name: hostName,
        host_key_hash: await sha256Hex(hostKey),
        created_at: now,
        opened_at: null,
        answered_at: null,
        ended_at: null,
        end_reason: null,
        pass_failures: 0,
        pass_window: null,
    }

    // A collision among 31^10 codes is unlikely, but the primary key decides.
    for (let attempt = 0; ; attempt++) {
        row.code = newCode()
        const inserted = await c.env.DB.prepare(`
            INSERT INTO meetings (code, title, visibility, passcode_hash, waiting_room, locked, scheduled_at, duration_min, host_name, host_key_hash, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT (code) DO NOTHING
        `).bind(row.code, row.title, row.visibility, row.passcode_hash, row.waiting_room, row.scheduled_at, row.duration_min, row.host_name, row.host_key_hash, now).run()

        if (inserted.meta.changes === 1) break
        if (attempt >= 4) throw new Error('Could not find a free meeting code.')
    }

    return c.json({ meeting: publicMeeting(row, 0, now), hostKey }, 201)
})

// ---- look up -----------------------------------------------------------------

meetings.get('/:code', async (c) => {
    const raw = c.req.param('code')
    const now = Date.now()

    if (raw.toLowerCase().endsWith('.ics')) {
        const meeting = await findMeeting(c.env.DB, codeFrom(raw.slice(0, -4)))
        if (meeting.scheduled_at === null) throw new ApiError('not_found', 'Only a scheduled meeting has a calendar file.')

        return c.body(meetingIcs(meeting, new URL(c.req.url).origin, now), 200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="meeting-${meeting.code}.ics"`,
            'Cache-Control': 'no-store',
        })
    }

    const meeting = await findMeeting(c.env.DB, routeCode(c))

    return c.json(await meetingResponse(c.env.DB, meeting, now))
})

// ---- join --------------------------------------------------------------------

/**
 * Wrong passcodes are counted on the meeting itself (one row written per
 * wrong guess, nothing for a right one), so the cap holds across every Worker
 * instance: PASSCODE_MAX_FAILURES per PASSCODE_WINDOW_MS.
 */
async function checkPasscode(db: D1Database, meeting: MeetingRow, passcode: string | null, now: number): Promise<void> {
    const windowOpen = meeting.pass_window !== null && meeting.pass_window > now - PASSCODE_WINDOW_MS
    if (windowOpen && meeting.pass_failures >= PASSCODE_MAX_FAILURES) {
        const error = new ApiError('rate_limited', 'Too many wrong passcodes for this meeting. Try again in a few minutes.')
        error.retryAfter = Math.ceil(((meeting.pass_window ?? now) + PASSCODE_WINDOW_MS - now) / 1000)
        throw error
    }

    if (! passcode) throw new ApiError('passcode_required', 'This meeting needs a passcode.')
    if (meeting.passcode_hash && await verifyPasscode(passcode, meeting.passcode_hash)) return

    await db.prepare(`
        UPDATE meetings SET
            pass_failures = CASE WHEN pass_window IS NULL OR pass_window <= ?2 - ${PASSCODE_WINDOW_MS} THEN 1 ELSE pass_failures + 1 END,
            pass_window = CASE WHEN pass_window IS NULL OR pass_window <= ?2 - ${PASSCODE_WINDOW_MS} THEN ?2 ELSE pass_window END
        WHERE code = ?1
    `).bind(meeting.code, now).run()

    throw new ApiError('passcode_wrong', 'That passcode is not right.')
}

meetings.post('/:code/join', rateLimit('join'), durableRateLimit('join'), async (c) => {
    const code = routeCode(c)
    const body = await jsonBody(c)
    const now = Date.now()
    const db = c.env.DB

    const name = requiredText(body, 'name', 40, 'Your name')
    const hostKey = optionalSecret(body, 'hostKey')
    const passcode = optionalSecret(body, 'passcode')

    const meeting = await findMeeting(db, code)
    if (meeting.ended_at !== null) throw ended()

    const isHost = hostKey !== null
    if (isHost && ! safeEqual(await sha256Hex(hostKey), meeting.host_key_hash)) throw new ApiError('forbidden', 'This host link is not valid for this meeting.')

    if (! isHost) {
        if (meeting.visibility === 'private') await checkPasscode(db, meeting, passcode, now)
        if (meetingStatus(meeting, now) === 'scheduled') throw new ApiError('not_started', 'This meeting has not started yet.')
        if (meeting.locked === 1) throw new ApiError('locked', 'The host has locked this meeting.')
    }

    const waits = ! isHost && meeting.waiting_room === 1
    const id = randomToken(9)
    const statements = [
        expireStatement(db, code, now),
        // Admitted people take the next seat; everyone needs room in the meeting (one statement, so two joins cannot both take the last place).
        db.prepare(`
            INSERT INTO participants (id, meeting_code, name, role, status, seat, seen_at, created_at, admitted_at)
            SELECT ?2, ?1, ?3, ?4, ?5,
                CASE WHEN ?5 = 'waiting' THEN NULL ELSE ${NEXT_SEAT_SQL} END,
                CASE WHEN ?5 = 'waiting' THEN ?6 ELSE NULL END,
                ?6,
                CASE WHEN ?5 = 'waiting' THEN NULL ELSE ?6 END
            WHERE ${ROOM_SQL}
        `).bind(code, id, name, isHost ? 'host' : 'guest', waits ? 'waiting' : 'ringing', now),
    ]
    if (isHost) statements.push(db.prepare('UPDATE meetings SET opened_at = ?2 WHERE code = ?1 AND opened_at IS NULL').bind(code, now))

    const results = await db.batch(statements)
    if (results[1]?.meta.changes !== 1) throw full()

    if (isHost) meeting.opened_at ??= now
    const participant = await db.prepare('SELECT * FROM participants WHERE id = ?1').bind(id).first<ParticipantRow>()

    return c.json({
        token: await signToken({ m: code, p: id }, c.env.SESSION_SECRET),
        participant: publicParticipant(participant!),
        meeting: await meetingResponse(db, meeting, now),
    }, 201)
})

meetings.get('/:code/me', async (c) => {
    const code = routeCode(c)
    const now = Date.now()
    const { meeting, me } = await requireParticipant(c, code)

    // The waiting room's heartbeat: the host's list leaves out guests who stopped asking.
    if (me.status === 'waiting' && (me.seen_at ?? 0) < now - WAITING_HEARTBEAT_MS) {
        await c.env.DB.prepare('UPDATE participants SET seen_at = ?2 WHERE id = ?1').bind(me.id, now).run()
    }

    return c.json({ participant: publicParticipant(me), meeting: await meetingResponse(c.env.DB, meeting, now) })
})

// ---- the waiting room --------------------------------------------------------

export async function waitingList(db: D1Database, code: string, now: number) {
    const { results } = await db.prepare(`
        SELECT * FROM participants WHERE meeting_code = ?1 AND status = 'waiting' AND seen_at >= ?2 ORDER BY created_at
    `).bind(code, now - WAITING_STALE_MS).all<ParticipantRow>()

    return results.map(waitingEntry)
}

meetings.get('/:code/waiting', async (c) => {
    const code = routeCode(c)
    await requireHost(c, code)

    return c.json(await waitingList(c.env.DB, code, Date.now()))
})

/** Admit one waiting guest if there is room: their seat comes now, in admission order. */
function admitStatement(db: D1Database, code: string, id: string, now: number) {
    return db.prepare(`
        UPDATE participants SET status = 'ringing', seat = ${NEXT_SEAT_SQL}, admitted_at = ?3, seen_at = NULL
        WHERE id = ?2 AND meeting_code = ?1 AND status = 'waiting' AND ${ROOM_SQL}
    `).bind(code, id, now)
}

async function decide(c: Context<{ Bindings: Env }>, decision: 'admit' | 'deny') {
    const code = routeCode(c)
    const id = c.req.param('id') ?? ''
    const now = Date.now()
    const db = c.env.DB
    const { meeting } = await requireHost(c, code)
    if (meeting.ended_at !== null) throw ended()

    const [, changed, found] = await db.batch([
        expireStatement(db, code, now),
        decision === 'admit'
            ? admitStatement(db, code, id, now)
            : db.prepare(`UPDATE participants SET status = 'denied' WHERE id = ?2 AND meeting_code = ?1 AND status = 'waiting'`).bind(code, id),
        db.prepare('SELECT * FROM participants WHERE id = ?2 AND meeting_code = ?1').bind(code, id),
    ])

    const participant = found?.results[0] as ParticipantRow | undefined
    if (! participant) throw new ApiError('not_found', 'There is nobody with this id in the meeting.')
    if (changed?.meta.changes !== 1) {
        if (participant.status !== 'waiting') throw new ApiError('invalid', `${participant.name} is not in the waiting room any more.`, null, 409)
        throw full()
    }

    return c.json({ participant: publicParticipant(participant) })
}

meetings.post('/:code/waiting/:id/admit', (c) => decide(c, 'admit'))
meetings.post('/:code/waiting/:id/deny', (c) => decide(c, 'deny'))

// ---- host controls -----------------------------------------------------------

meetings.patch('/:code', async (c) => {
    const code = routeCode(c)
    const body = await jsonBody(c)
    const now = Date.now()
    const db = c.env.DB
    const { meeting } = await requireHost(c, code)
    if (meeting.ended_at !== null) throw ended()

    const waitingRoom = optionalBoolean(body, 'waitingRoom')
    const locked = optionalBoolean(body, 'locked')
    const title = body.title === undefined ? undefined : optionalText(body, 'title', 100)

    const statements: D1PreparedStatement[] = [db.prepare(`
        UPDATE meetings SET
            waiting_room = COALESCE(?2, waiting_room),
            locked = COALESCE(?3, locked),
            title = CASE WHEN ?4 = 1 THEN ?5 ELSE title END
        WHERE code = ?1
    `).bind(code, waitingRoom === undefined ? null : Number(waitingRoom), locked === undefined ? null : Number(locked), title === undefined ? 0 : 1, title ?? null)]

    // No more waiting room: whoever waits comes in, oldest first, while there is room.
    if (waitingRoom === false) {
        const { results } = await db.prepare(`SELECT id FROM participants WHERE meeting_code = ?1 AND status = 'waiting' ORDER BY created_at`).bind(code).all<{ id: string }>()
        statements.push(expireStatement(db, code, now), ...results.map(({ id }) => admitStatement(db, code, id, now)))
    }

    await db.batch(statements)

    return c.json({ meeting: await meetingResponse(db, await findMeeting(db, code), now) })
})

meetings.post('/:code/end', async (c) => {
    const code = routeCode(c)
    const now = Date.now()
    const db = c.env.DB
    const { meeting } = await requireHost(c, code)
    if (meeting.ended_at !== null) throw ended()

    await db.batch([
        db.prepare(`UPDATE meetings SET ended_at = ?2, end_reason = 'ended' WHERE code = ?1 AND ended_at IS NULL`).bind(code, now),
        db.prepare('DELETE FROM signals WHERE meeting_code = ?1').bind(code),
    ])

    return c.json({ meeting: await meetingResponse(db, await findMeeting(db, code), now) })
})

meetings.post('/:code/remove/:id', async (c) => {
    const code = routeCode(c)
    const id = c.req.param('id')
    const now = Date.now()
    const db = c.env.DB
    const { meeting } = await requireHost(c, code)
    if (meeting.ended_at !== null) throw ended()

    const target = await db.prepare('SELECT * FROM participants WHERE id = ?2 AND meeting_code = ?1').bind(code, id).first<ParticipantRow>()
    if (! target) throw new ApiError('not_found', 'There is nobody with this id in the meeting.')
    if (target.role === 'host') throw invalid('The host cannot remove themselves: end the meeting or leave it.')

    await db.batch([
        db.prepare(`UPDATE participants SET status = 'removed', tab = NULL, left_at = ?3 WHERE id = ?2 AND meeting_code = ?1`).bind(code, id, now),
        db.prepare('DELETE FROM signals WHERE to_id = ?1').bind(id),
    ])

    return c.json({ participant: publicParticipant({ ...target, status: 'removed' }) })
})

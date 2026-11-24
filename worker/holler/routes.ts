import { Hono, type Context } from 'hono'
import { normalizeCode } from '../lib/codes'
import { randomToken, verifyToken } from '../lib/crypto'
import { ApiError } from '../lib/errors'
import { CLAIM_STALE_MS, HEARTBEAT_MS } from '../lib/timing'
import { jsonBody } from '../lib/validate'
import { bearerToken, participantFromToken, routeCode } from '../meetings/auth'
import { expireStatement, LIVE, LIVE_SQL, type MeetingRow, type ParticipantRow } from '../meetings/model'
import { iceServers } from './ice'
import { inCallCount, meetingView, presentCall } from './present'

/**
 * Holler's signaling routes for one meeting, the server side of
 * @packstub/holler's HttpSignaling (docs/api.md, "Holler signaling"). The
 * meeting is the call: its id is the meeting code.
 */
export const holler = new Hono<{ Bindings: Env }>()

type Ctx = Context<{ Bindings: Env }>

export const SIGNAL_TYPES = ['offer', 'answer', 'ice', 'reset', 'state'] as const
export const MAX_SIGNAL_BYTES = 64 * 1024
export const MAX_PENDING_SIGNALS = 500
const MAX_SIGNALS_PER_POLL = 100

const notAllowed = (message: string, status: 401 | 403 | 422 = 422) => new ApiError(status === 422 ? 'invalid' : 'forbidden', message, 'not_allowed', status)
const ended = () => new ApiError('ended', 'This meeting has ended.', 'ended')

/** Waiting, denied (and, except for the poll, removed) people have no business with the call. */
function assertAdmitted(me: ParticipantRow, { removedToo = true } = {}) {
    if (me.status === 'waiting' || me.status === 'denied' || (removedToo && me.status === 'removed')) {
        throw notAllowed('You are not in this meeting.', 403)
    }
}

const selectMeeting = (db: D1Database, code: string) => db.prepare('SELECT * FROM meetings WHERE code = ?1').bind(code)
const selectParticipants = (db: D1Database, code: string) => db.prepare('SELECT * FROM participants WHERE meeting_code = ?1').bind(code)

/** Runs the statements, then reads the meeting and its people in the same batch. */
async function batchThenRead(db: D1Database, code: string, statements: D1PreparedStatement[]) {
    const results = await db.batch([...statements, selectMeeting(db, code), selectParticipants(db, code)])
    const meeting = results.at(-2)?.results[0] as MeetingRow
    const participants = (results.at(-1)?.results ?? []) as ParticipantRow[]

    return { results, meeting, participants }
}

function callFor(meeting: MeetingRow, participants: ParticipantRow[], meId: string, tab: string | null, now: number) {
    const me = participants.find((p) => p.id === meId)!

    return presentCall(meeting, participants, me, tab, now)
}

function tabFrom(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value.slice(0, 32) : null
}

// ---- poll --------------------------------------------------------------------

/**
 * The one request every tab repeats. Everything happens in one D1 batch, and
 * every write in it is conditional, so a poll with nothing new writes nothing:
 *   1. expire people who went quiet,
 *   2. claim my side for this tab, or write its heartbeat (at most every 10 s),
 *   3. keep the heartbeat of a call I put on hold,
 *   4. delete the signals this tab has read (up to `after`),
 *   5. read the meeting, its people and my new signals.
 */
holler.get('/:code/holler/poll', async (c) => {
    const code = routeCode(c)
    const now = Date.now()
    const db = c.env.DB

    const claims = await verifyToken(bearerToken(c) ?? '', c.env.SESSION_SECRET)
    if (! claims || claims.m !== code) throw notAllowed('Join the meeting first.', 401)
    const meId = claims.p

    const query = c.req.query()
    let after = Math.max(0, Number.parseInt(query.after ?? '0', 10) || 0)
    const named = query.call ? normalizeCode(query.call) === code : false
    const tab = tabFrom(query.tab)
    const claim = query.claim === '1' || query.claim === 'true'
    const otherKind = query.kind !== undefined && query.kind !== '' && query.kind !== 'call'
    const claiming = named && tab !== null && claim && ! otherKind
    const nonce = randomToken(6)

    const statements: D1PreparedStatement[] = [expireStatement(db, code, now)]
    if (claiming) {
        statements.push(
            db.prepare(`
                UPDATE participants SET
                    claim_nonce = CASE WHEN tab IS NOT ?3 AND seen_at IS NOT NULL THEN ?5 ELSE claim_nonce END,
                    tab = ?3,
                    seen_at = ?4
                WHERE id = ?1 AND meeting_code = ?2 AND status IN ('ringing', 'joined')
                  AND EXISTS (SELECT 1 FROM meetings WHERE code = ?2 AND ended_at IS NULL)
                  AND (tab IS NULL OR tab = ?3 OR seen_at IS NULL OR seen_at < ?4 - ${CLAIM_STALE_MS})
                  AND NOT (tab IS ?3 AND seen_at >= ?4 - ${HEARTBEAT_MS})
            `).bind(meId, code, tab, now, nonce),
        )
        if (after > 0) {
            statements.push(db.prepare(`
                DELETE FROM signals WHERE to_id = ?1 AND id <= ?2
                  AND EXISTS (SELECT 1 FROM participants WHERE id = ?1 AND tab = ?3)
            `).bind(meId, after, tab))
        }
    }
    statements.push(db.prepare(`
        UPDATE participants SET seen_at = ?2
        WHERE id = ?1 AND status = 'on_hold' AND (seen_at IS NULL OR seen_at < ?2 - ${HEARTBEAT_MS})
    `).bind(meId, now))

    const reads = claiming
        ? [
            db.prepare(`SELECT id, meeting_code, type, payload, from_id FROM signals WHERE to_id = ?1 AND id > ?2 ORDER BY id LIMIT ${MAX_SIGNALS_PER_POLL}`).bind(meId, after),
            db.prepare('SELECT MAX(id) AS last FROM signals WHERE to_id = ?1').bind(meId),
        ]
        : []

    const results = await db.batch([...statements, selectMeeting(db, code), selectParticipants(db, code), ...reads])
    const base = statements.length
    const meeting = results[base]?.results[0] as MeetingRow | undefined
    const participants = (results[base + 1]?.results ?? []) as ParticipantRow[]
    const me = participants.find((p) => p.id === meId)
    if (! meeting) throw new ApiError('not_found', 'There is no meeting with this code.')
    if (! me) throw notAllowed('Join the meeting first.', 401)
    assertAdmitted(me, { removedToo: false })

    const isEnded = meeting.ended_at !== null
    const live = LIVE.includes(me.status)

    let current: ParticipantRow | null = null
    if (! otherKind) {
        if (named) current = (live && me.status !== 'on_hold') || isEnded || me.status === 'removed' ? me : null
        else current = me.status === 'joined' && ! isEnded ? me : null
    }

    const holdsSide = claiming && current !== null && ! isEnded && (me.status === 'ringing' || me.status === 'joined') && me.tab === tab
    let signals: Array<{ id: number, call: string, type: string, payload: unknown, from: string }> = []

    if (holdsSide) {
        const pending = (results[base + 2]?.results ?? []) as Array<{ id: number, meeting_code: string, type: string, payload: string, from_id: string }>
        if (me.claim_nonce === nonce) {
            // A fresh tab took the side over: the signals meant for the old one are skipped.
            after = Math.max(after, Number((results[base + 3]?.results[0] as { last: number | null } | undefined)?.last ?? 0))
        } else {
            signals = pending.map((s) => ({ id: s.id, call: s.meeting_code, type: s.type, payload: JSON.parse(s.payload), from: s.from_id }))
        }
    }

    const present = () => presentCall(meeting, participants, me, tab, now)

    return c.json({
        call: current ? present() : null,
        incoming: ! otherKind && ! isEnded && me.status === 'ringing' && current === null ? present() : null,
        on_hold: ! otherKind && ! isEnded && me.status === 'on_hold' ? present() : null,
        signals,
        cursor: signals.length ? signals[signals.length - 1]!.id : after,
        meeting: meetingView(meeting, participants, me, now),
    })
})

// ---- joining and leaving the call ---------------------------------------------

/** Nobody is rung in a meeting: people come in through the join link. HttpSignaling needs the route anyway. */
holler.post('/:code/holler/start', () => {
    throw notAllowed('Nobody is rung in a meeting: share the link instead.')
})

holler.post('/:code/holler/answer', async (c) => {
    const code = routeCode(c)
    const now = Date.now()
    const db = c.env.DB
    const { me, meeting } = await participantFromToken(c, code, bearerToken(c))
    assertAdmitted(me)
    if (meeting.ended_at !== null) throw ended()

    const body = await jsonBody(c).catch(() => ({} as Record<string, unknown>))
    const tab = tabFrom(body.tab)

    const { results, meeting: fresh, participants } = await batchThenRead(db, code, [
        expireStatement(db, code, now),
        db.prepare(`
            UPDATE participants SET status = 'joined', tab = ?3, seen_at = ?4, claim_nonce = NULL
            WHERE id = ?1 AND meeting_code = ?2 AND status = 'ringing'
        `).bind(me.id, code, tab, now),
        db.prepare(`
            UPDATE meetings SET answered_at = ?2
            WHERE code = ?1 AND answered_at IS NULL
              AND (SELECT COUNT(*) FROM participants WHERE meeting_code = ?1 AND status IN ('joined', 'on_hold')) >= 2
        `).bind(code, now),
    ])

    if (results[1]?.meta.changes !== 1) throw new ApiError('invalid', 'You are not being let into this call any more.', 'not_ringing', 409)

    return c.json(callFor(fresh, participants, me.id, tab, now))
})

/** Hanging up (or declining before answering): out of the meeting, which goes on for the others. */
async function leaveCall(c: Ctx) {
    const code = routeCode(c)
    const now = Date.now()
    const db = c.env.DB
    const { me } = await participantFromToken(c, code, bearerToken(c))
    assertAdmitted(me, { removedToo: false })

    const { meeting, participants } = await batchThenRead(db, code, [
        db.prepare(`
            UPDATE participants SET status = CASE status WHEN 'ringing' THEN 'declined' ELSE 'left' END, tab = NULL, left_at = ?2
            WHERE id = ?1 AND status IN ${LIVE_SQL}
        `).bind(me.id, now),
        db.prepare('DELETE FROM signals WHERE to_id = ?1').bind(me.id),
    ])

    return c.json(callFor(meeting, participants, me.id, null, now))
}

holler.post('/:code/holler/hangup', leaveCall)
holler.post('/:code/holler/decline', leaveCall)

/**
 * The page is unloading (a beacon, so the token comes as a form field): the
 * side is free for the next page at once.
 */
holler.post('/:code/holler/leave', async (c) => {
    const code = routeCode(c)
    let fields: Record<string, unknown> = {}
    const type = c.req.header('Content-Type') ?? ''
    try {
        fields = type.includes('application/json') ? await c.req.json() : await c.req.parseBody()
    } catch {}

    const token = bearerToken(c) ?? (typeof fields.token === 'string' ? fields.token : null)
    const claims = await verifyToken(token ?? '', c.env.SESSION_SECRET)
    if (! claims || claims.m !== code) throw notAllowed('Join the meeting first.', 401)

    const tab = tabFrom(fields.tab)
    if (tab) await c.env.DB.prepare('UPDATE participants SET tab = NULL WHERE id = ?1 AND tab = ?2').bind(claims.p, tab).run()

    return c.body(null, 204)
})

// ---- hold --------------------------------------------------------------------

holler.post('/:code/holler/hold', async (c) => {
    const code = routeCode(c)
    const now = Date.now()
    const db = c.env.DB
    const { me, meeting } = await participantFromToken(c, code, bearerToken(c))
    assertAdmitted(me)
    if (meeting.ended_at !== null) throw ended()

    if (me.status !== 'on_hold') {
        const { results: participants } = await selectParticipants(db, code).all<ParticipantRow>()
        if (me.status !== 'joined' || inCallCount(participants) < 2) throw notAllowed('Only a call you are in, with someone else, can be put on hold.')
    }

    // No window, no signals kept: they connect afresh when they resume.
    const { meeting: fresh, participants } = await batchThenRead(db, code, [
        db.prepare(`UPDATE participants SET status = 'on_hold', tab = NULL, seen_at = ?2 WHERE id = ?1 AND status = 'joined'`).bind(me.id, now),
        db.prepare('DELETE FROM signals WHERE to_id = ?1').bind(me.id),
    ])

    return c.json(callFor(fresh, participants, me.id, null, now))
})

holler.post('/:code/holler/resume', async (c) => {
    const code = routeCode(c)
    const now = Date.now()
    const db = c.env.DB
    const { me, meeting } = await participantFromToken(c, code, bearerToken(c))
    assertAdmitted(me)
    if (meeting.ended_at !== null) throw ended()
    if (me.status !== 'on_hold') throw notAllowed('This call is not on hold.')

    const body = await jsonBody(c).catch(() => ({} as Record<string, unknown>))
    const tab = tabFrom(body.tab)

    const { meeting: fresh, participants } = await batchThenRead(db, code, [
        db.prepare(`UPDATE participants SET status = 'joined', tab = ?2, seen_at = ?3, claim_nonce = NULL WHERE id = ?1 AND status = 'on_hold'`).bind(me.id, tab, now),
    ])

    return c.json(callFor(fresh, participants, me.id, tab, now))
})

// ---- signals -----------------------------------------------------------------

holler.post('/:code/holler/signals', async (c) => {
    const code = routeCode(c)
    const now = Date.now()
    const db = c.env.DB
    const { me, meeting } = await participantFromToken(c, code, bearerToken(c))
    assertAdmitted(me)
    if (meeting.ended_at !== null) throw ended()
    if (me.status !== 'joined') throw notAllowed('Join the call before sending signals.')

    const body = await jsonBody(c)
    const type = body.type
    if (typeof type !== 'string' || ! (SIGNAL_TYPES as readonly string[]).includes(type)) throw new ApiError('invalid', `type must be one of ${SIGNAL_TYPES.join(', ')}.`)
    if (body.payload === null || typeof body.payload !== 'object' || Array.isArray(body.payload)) throw new ApiError('invalid', 'payload must be an object.')
    const payload = JSON.stringify(body.payload)
    if (new TextEncoder().encode(payload).length > MAX_SIGNAL_BYTES) throw new ApiError('invalid', 'This signal is too large.', 'too_large', 413)

    const to = body.to === undefined || body.to === null ? null : String(body.to).slice(0, 64)

    const [pending, target, inserted] = await db.batch([
        db.prepare(`
            SELECT COUNT(*) AS n FROM signals
            WHERE to_id IN (SELECT id FROM participants WHERE meeting_code = ?1) AND from_id = ?2
        `).bind(code, me.id),
        db.prepare('SELECT COUNT(*) AS n FROM participants WHERE id = ?1 AND meeting_code = ?2 AND seat IS NOT NULL').bind(to, code),
        // To everyone in the call who has a window for it (not someone on hold), or to `to` alone,
        // and only while fewer than MAX_PENDING_SIGNALS of mine wait unread.
        db.prepare(`
            INSERT INTO signals (meeting_code, to_id, from_id, type, payload, created_at)
            SELECT ?1, p.id, ?2, ?3, ?4, ?5 FROM participants p
            WHERE p.meeting_code = ?1 AND p.id != ?2 AND p.status IN ('ringing', 'joined') AND (?6 IS NULL OR p.id = ?6)
              AND (SELECT COUNT(*) FROM signals s WHERE s.to_id IN (SELECT id FROM participants WHERE meeting_code = ?1) AND s.from_id = ?2) < ${MAX_PENDING_SIGNALS}
            ORDER BY p.seat
            RETURNING id
        `).bind(code, me.id, type, payload, now, to),
    ])

    if ((pending?.results[0] as { n: number }).n >= MAX_PENDING_SIGNALS) {
        throw new ApiError('rate_limited', 'Too many signals are waiting to be read.', 'too_many')
    }
    if (to !== null && (to === me.id || (target?.results[0] as { n: number }).n === 0)) {
        throw notAllowed('That person is not in this call.')
    }

    const ids = (inserted?.results ?? []) as Array<{ id: number }>

    return c.json({ id: ids.length ? Math.max(...ids.map((row) => row.id)) : null }, 201)
})

// ---- ICE servers -------------------------------------------------------------

holler.get('/:code/holler/ice', async (c) => {
    const code = routeCode(c)
    const { me } = await participantFromToken(c, code, bearerToken(c))
    assertAdmitted(me)

    c.header('Cache-Control', 'no-store')
    return c.json(await iceServers(c.env))
})

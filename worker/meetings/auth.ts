import type { Context } from 'hono'
import { normalizeCode } from '../lib/codes'
import { safeEqual, sha256Hex, verifyToken } from '../lib/crypto'
import { ApiError, notFound } from '../lib/errors'
import type { MeetingRow, ParticipantRow } from './model'

type Ctx = Context<{ Bindings: Env }>

/** The meeting code from the route, normalized; 404 when it cannot be one. */
export function routeCode(c: Ctx, param = 'code'): string {
    return codeFrom(c.req.param(param) ?? '')
}

export function codeFrom(raw: string): string {
    const code = normalizeCode(raw)
    if (! code) throw notFound()

    return code
}

export async function findMeeting(db: D1Database, code: string): Promise<MeetingRow> {
    const meeting = await db.prepare('SELECT * FROM meetings WHERE code = ?1').bind(code).first<MeetingRow>()
    if (! meeting) throw notFound()

    return meeting
}

export function bearerToken(c: Ctx): string | null {
    const header = c.req.header('Authorization') ?? ''
    const match = /^Bearer\s+(\S+)$/i.exec(header)

    return match?.[1] ?? null
}

const unauthorized = () => new ApiError('forbidden', 'Join the meeting first.', 'not_allowed', 401)

/** The participant a token names, with their meeting, in one D1 round trip. */
export async function participantFromToken(c: Ctx, code: string, token: string | null): Promise<{ meeting: MeetingRow, me: ParticipantRow }> {
    if (! token) throw unauthorized()

    const claims = await verifyToken(token, c.env.SESSION_SECRET)
    if (! claims || claims.m !== code) throw unauthorized()

    const [meetings, participants] = await c.env.DB.batch([
        c.env.DB.prepare('SELECT * FROM meetings WHERE code = ?1').bind(code),
        c.env.DB.prepare('SELECT * FROM participants WHERE id = ?1 AND meeting_code = ?2').bind(claims.p, code),
    ])

    const meeting = meetings?.results[0] as MeetingRow | undefined
    const me = participants?.results[0] as ParticipantRow | undefined
    if (! meeting) throw notFound()
    if (! me) throw unauthorized()

    return { meeting, me }
}

export function requireParticipant(c: Ctx, code: string) {
    return participantFromToken(c, code, bearerToken(c))
}

/**
 * The host: the meeting's hostKey in `X-Host-Key`, or the token of the
 * participant who joined with it.
 */
export async function requireHost(c: Ctx, code: string): Promise<{ meeting: MeetingRow, me: ParticipantRow | null }> {
    const hostKey = c.req.header('X-Host-Key')

    if (hostKey) {
        const meeting = await findMeeting(c.env.DB, code)
        if (! safeEqual(await sha256Hex(hostKey), meeting.host_key_hash)) throw new ApiError('forbidden', 'Only the host can do this.')

        return { meeting, me: null }
    }

    const { meeting, me } = await requireParticipant(c, code)
    if (me.role !== 'host') throw new ApiError('forbidden', 'Only the host can do this.')

    return { meeting, me }
}

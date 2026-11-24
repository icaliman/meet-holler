import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors'

/**
 * Two layers, both per client (see `clientKey`).
 *
 * In memory: fixed-window counters kept in the Worker instance. Free (no D1
 * row), so they can sit in front of every request, but Cloudflare runs many
 * instances and each has its own count: a brake on a script, not a limit.
 *
 * In D1 (`hitDurable`): one row per client and bucket, so the count is the
 * same whichever instance answers. It costs a row written per counted
 * request, so it is only for the requests that write to D1 anyway and that
 * nobody makes often: creating a meeting and joining one. Wrong passcodes are
 * counted per meeting, on the meeting itself (meetings/routes.ts).
 */
const windows = new Map<string, { count: number, resetAt: number }>()
let lastSweep = 0

export const LIMITS = {
    create: { max: 20, windowMs: 10 * 60_000 },
    join: { max: 30, windowMs: 60_000 },
    api: { max: 600, windowMs: 60_000 },
} as const

/**
 * The limits that hold across instances. `createAll` is everyone together: a
 * ceiling on how much of the day's D1 writes creating meetings can use, for
 * when the requests come from more addresses than a per-address limit can
 * tell apart. It is far above what the free plan's request budget lets real
 * people do (docs/security.md).
 */
export const DURABLE_LIMITS = {
    create: { max: 20, windowMs: 10 * 60_000 },
    createAll: { max: 300, windowMs: 60 * 60_000 },
    join: { max: 60, windowMs: 10 * 60_000 },
} as const

export function clientIp(headers: Headers): string {
    return headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/**
 * Who a request is counted against: the address for IPv4, the /64 for IPv6.
 * One home or phone has a whole /64 (2^64 addresses) to itself, so counting
 * IPv6 addresses one by one would count nothing.
 */
export function clientKey(ip: string): string {
    const address = ip.trim().toLowerCase()
    if (! address.includes(':')) return address

    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address)
    if (mapped) return mapped[1]!

    const [head = '', tail = ''] = address.split('::')
    const left = head ? head.split(':') : []
    const right = address.includes('::') && tail ? tail.split(':') : []
    const groups = address.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left

    return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '') || '0').join(':')}::/64`
}

const tooMany = (message: string, retryAfterMs: number) => {
    const error = new ApiError('rate_limited', message)
    error.retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000))

    return error
}

/** Counts one hit in this instance's memory; throws `rate_limited` past the limit. */
export function hit(bucket: keyof typeof LIMITS, ip: string, now = Date.now()): void {
    const { max, windowMs } = LIMITS[bucket]

    if (now - lastSweep > 60_000) {
        lastSweep = now
        for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key)
    }

    const key = `${bucket}:${clientKey(ip)}`
    let entry = windows.get(key)
    if (! entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs }
        windows.set(key, entry)
    }

    entry.count++
    if (entry.count > max) throw tooMany('Too many requests. Wait a moment and try again.', entry.resetAt - now)
}

/**
 * Counts one hit in D1; throws `rate_limited` past the limit. One statement:
 * the row is written only while the client is under the limit (or its window
 * has passed), so a client that is being refused costs a read and no write.
 */
export async function hitDurable(db: D1Database, bucket: keyof typeof DURABLE_LIMITS, client: string, now = Date.now(), message = 'Too many requests. Wait a few minutes and try again.'): Promise<void> {
    const { max, windowMs } = DURABLE_LIMITS[bucket]
    const key = `${bucket}:${client}`

    const counted = await db.prepare(`
        INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
        ON CONFLICT (key) DO UPDATE SET
            count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
            window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END
        WHERE window_start <= ?2 - ?3 OR count < ?4
        RETURNING count
    `).bind(key, now, windowMs, max).first<{ count: number }>()
    if (counted) return

    const current = await db.prepare('SELECT window_start FROM rate_limits WHERE key = ?1').bind(key).first<{ window_start: number }>()
    throw tooMany(message, (current?.window_start ?? now) + windowMs - now)
}

export function rateLimit(bucket: keyof typeof LIMITS): MiddlewareHandler {
    return async (c, next) => {
        hit(bucket, clientIp(c.req.raw.headers))
        await next()
    }
}

/** After `rateLimit`, so a client the instance already refuses never reaches D1. */
export function durableRateLimit(bucket: keyof typeof DURABLE_LIMITS): MiddlewareHandler<{ Bindings: Env }> {
    return async (c, next) => {
        await hitDurable(c.env.DB, bucket, clientKey(clientIp(c.req.raw.headers)))
        await next()
    }
}

/** For tests: what a new instance of the Worker starts with. */
export function resetRateLimits(): void {
    windows.clear()
}

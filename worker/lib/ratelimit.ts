import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors'

/**
 * Fixed-window counters per IP address, kept in the Worker instance's memory:
 * free (no D1 row, no KV write), but per instance, so a brake on scripts
 * rather than a global limit. What must hold globally (wrong passcodes) is
 * counted in D1 instead.
 */
const windows = new Map<string, { count: number, resetAt: number }>()
let lastSweep = 0

export const LIMITS = {
    create: { max: 20, windowMs: 10 * 60_000 },
    join: { max: 30, windowMs: 60_000 },
    api: { max: 600, windowMs: 60_000 },
} as const

export function clientIp(headers: Headers): string {
    return headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

/** Counts one hit; throws `rate_limited` past the limit. */
export function hit(bucket: keyof typeof LIMITS, ip: string, now = Date.now()): void {
    const { max, windowMs } = LIMITS[bucket]

    if (now - lastSweep > 60_000) {
        lastSweep = now
        for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key)
    }

    const key = `${bucket}:${ip}`
    let entry = windows.get(key)
    if (! entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs }
        windows.set(key, entry)
    }

    entry.count++
    if (entry.count > max) {
        const error = new ApiError('rate_limited', 'Too many requests. Wait a moment and try again.')
        error.retryAfter = Math.ceil((entry.resetAt - now) / 1000)
        throw error
    }
}

export function rateLimit(bucket: keyof typeof LIMITS): MiddlewareHandler {
    return async (c, next) => {
        hit(bucket, clientIp(c.req.raw.headers))
        await next()
    }
}

/** For tests. */
export function resetRateLimits(): void {
    windows.clear()
}

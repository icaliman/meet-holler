import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** The error codes of the API contract (docs/ARCHITECTURE.md, docs/api.md). */
export type ErrorCode =
    | 'not_found'
    | 'forbidden'
    | 'passcode_required'
    | 'passcode_wrong'
    | 'full'
    | 'locked'
    | 'ended'
    | 'not_started'
    | 'invalid'
    | 'rate_limited'

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
    not_found: 404,
    forbidden: 403,
    passcode_required: 401,
    passcode_wrong: 401,
    full: 409,
    locked: 423,
    ended: 410,
    not_started: 409,
    invalid: 422,
    rate_limited: 429,
}

/**
 * An error the API answers with `{ error: { code, message }, message, reason }`.
 * `message` and `reason` at the top level are what @packstub/holler's
 * HttpSignaling reads (`reason` is Holler's: `not_allowed`, `full`, `ended`, ...).
 */
export class ApiError extends Error {
    readonly status: ContentfulStatusCode
    /** Seconds, for `Retry-After` on `rate_limited`. */
    retryAfter: number | null = null

    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly reason: string | null = null,
        status?: ContentfulStatusCode,
    ) {
        super(message)
        this.status = status ?? STATUS[code]
    }

    body() {
        return { error: { code: this.code, message: this.message }, message: this.message, reason: this.reason ?? this.code }
    }
}

export const notFound = (message = 'There is no meeting with this code.') => new ApiError('not_found', message)
export const invalid = (message: string) => new ApiError('invalid', message)

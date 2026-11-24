import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { ApiError } from './lib/errors'
import { rateLimit } from './lib/ratelimit'
import { sameOrigin, securityHeaders } from './lib/security'
import { holler, MAX_SIGNAL_BYTES } from './holler/routes'
import { meetings } from './meetings/routes'

export type AppEnv = { Bindings: Env }

export const app = new Hono<AppEnv>()

// First, so that every answer carries the headers: errors and rate limits too.
app.use('/api/*', securityHeaders)
app.use('/api/*', sameOrigin)
app.use('/api/*', rateLimit('api'))

/**
 * No request has a reason to be big: the largest is a signal (an SDP offer),
 * everything else is a few fields. Refused from Content-Length, or while
 * reading when there is none, before anything parses it.
 */
export const MAX_BODY_BYTES = 16 * 1024
const tooLarge = () => {
    throw new ApiError('invalid', 'This request is too large.', 'too_large', 413)
}
const smallBody = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge })
// The payload's own limit, plus room for the envelope around it.
const signalBody = bodyLimit({ maxSize: MAX_SIGNAL_BYTES + 1024, onError: tooLarge })

app.use('/api/*', (c, next) => (c.req.path.endsWith('/holler/signals') ? signalBody(c, next) : smallBody(c, next)))

app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/api/meetings', meetings)
app.route('/api/meetings', holler)

app.all('/api/*', () => {
    throw new ApiError('not_found', 'There is nothing here.')
})

app.onError((error, c) => {
    if (error instanceof ApiError) {
        if (error.retryAfter !== null) c.header('Retry-After', String(error.retryAfter))
        return c.json(error.body(), error.status)
    }

    console.error(error)
    return c.json({ error: { code: 'internal', message: 'Something went wrong on our side.' }, message: 'Something went wrong on our side.', reason: 'internal' }, 500)
})

app.notFound((c) => c.json(new ApiError('not_found', 'There is nothing here.').body(), 404))

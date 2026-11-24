import { Hono } from 'hono'
import { ApiError } from './lib/errors'
import { rateLimit } from './lib/ratelimit'
import { sameOrigin, securityHeaders } from './lib/security'
import { holler } from './holler/routes'
import { meetings } from './meetings/routes'

export type AppEnv = { Bindings: Env }

export const app = new Hono<AppEnv>()

// First, so that every answer carries the headers: errors and rate limits too.
app.use('/api/*', securityHeaders)
app.use('/api/*', sameOrigin)
app.use('/api/*', rateLimit('api'))

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

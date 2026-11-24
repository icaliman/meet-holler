import { Hono } from 'hono'
import { ApiError } from './lib/errors'

export type AppEnv = { Bindings: Env }

export const app = new Hono<AppEnv>()

app.get('/api/health', (c) => c.json({ ok: true }))

app.all('/api/*', () => {
    throw new ApiError('not_found', 'There is nothing here.')
})

app.onError((error, c) => {
    if (error instanceof ApiError) return c.json(error.body(), error.status)

    console.error(error)
    return c.json({ error: { code: 'internal', message: 'Something went wrong on our side.' }, message: 'Something went wrong on our side.', reason: 'internal' }, 500)
})

app.notFound((c) => c.json(new ApiError('not_found', 'There is nothing here.').body(), 404))

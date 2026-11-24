import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('the worker', () => {
    it('answers on /api/health', async () => {
        const response = await exports.default.fetch('http://meet.test/api/health')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
    })

    it('answers an unknown API route with a JSON not_found', async () => {
        const response = await exports.default.fetch('http://meet.test/api/nope')

        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ error: { code: 'not_found' } })
    })

    it('has the D1 database migrated', async () => {
        const { env } = await import('cloudflare:workers')
        const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").all()

        expect(tables.results).toHaveLength(1)
    })
})

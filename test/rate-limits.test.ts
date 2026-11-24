import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clientKey, DURABLE_LIMITS, resetRateLimits } from '../worker/lib/ratelimit'
import { api, createMeeting, join, row } from './helpers'

beforeEach(async () => {
    resetRateLimits()
    await env.DB.prepare('DELETE FROM rate_limits').run()
})

afterEach(() => {
    vi.useRealTimers()
})

const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
}
const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))

const create = (ip: string, fields: Record<string, unknown> = {}) => api('POST', '/api/meetings', { ip, body: { visibility: 'public', ...fields } })

describe('who a request is counted against', () => {
    it('is the address for IPv4 and the /64 for IPv6', () => {
        expect(clientKey('203.0.113.9')).toBe('203.0.113.9')
        expect(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
        expect(clientKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64')
        expect(clientKey('2001:DB8:0001:0002::1')).toBe('2001:db8:1:2::/64')
        expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
        expect(clientKey('::1')).toBe('0:0:0:0::/64')
        expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9')
        expect(clientKey('2001:db8:1:3::1')).not.toBe(clientKey('2001:db8:1:2::1'))
        expect(clientKey('unknown')).toBe('unknown')
    })
})

describe('creating meetings', () => {
    it('is limited per address across Worker instances, not per instance', async () => {
        at('2027-06-01T10:00:00Z')
        const ip = '203.0.113.20'
        const { max, windowMs } = DURABLE_LIMITS.create

        for (let i = 0; i < max; i++) expect((await create(ip)).status).toBe(201)

        // Another instance of the Worker: its memory knows nothing about this address.
        resetRateLimits()
        const refused = await create(ip)
        expect(refused.status).toBe(429)
        expect(refused.body.error.code).toBe('rate_limited')
        expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
        expect(Number(refused.headers.get('Retry-After'))).toBeLessThanOrEqual(windowMs / 1000)

        // Refusals write nothing.
        const counted = await row('SELECT count FROM rate_limits WHERE key = ?', `create:${ip}`)
        resetRateLimits()
        await create(ip)
        expect(await row('SELECT count FROM rate_limits WHERE key = ?', `create:${ip}`)).toEqual(counted)

        expect((await create('203.0.113.21')).status).toBe(201)

        later(windowMs + 1000)
        resetRateLimits()
        expect((await create(ip)).status).toBe(201)
    })

    it('counts a whole IPv6 /64 as one address', async () => {
        const { max } = DURABLE_LIMITS.create
        for (let i = 0; i < max; i++) {
            resetRateLimits()
            expect((await create(`2001:db8:77:1::${(i + 1).toString(16)}`)).status).toBe(201)
        }

        resetRateLimits()
        expect((await create('2001:db8:77:1:ffff:ffff:ffff:ffff')).status).toBe(429)
        expect((await create('2001:db8:77:2::1')).status).toBe(201)
    })

    it('has a ceiling for everyone together, which refused requests do not use up', async () => {
        at('2027-06-02T10:00:00Z')
        const { max, windowMs } = DURABLE_LIMITS.createAll
        await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind('createAll:*', Date.now(), max - 1).run()

        expect((await create('203.0.113.30')).status).toBe(201)
        const refused = await create('203.0.113.31')
        expect(refused.status).toBe(429)
        expect(refused.body.error.message).toContain('meetings are being created')

        // Someone over their own limit does not count against everyone's, and a body that is refused does not either.
        await env.DB.prepare('UPDATE rate_limits SET count = 0 WHERE key = ?').bind('createAll:*').run()
        await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').bind('create:203.0.113.32', Date.now(), DURABLE_LIMITS.create.max).run()
        expect((await create('203.0.113.32')).status).toBe(429)
        expect((await create('203.0.113.33', { visibility: 'secret' })).status).toBe(422)
        expect((await row('SELECT count FROM rate_limits WHERE key = ?', 'createAll:*')).count).toBe(0)

        later(windowMs + 1000)
        await env.DB.prepare('UPDATE rate_limits SET count = ?, window_start = ? WHERE key = ?').bind(max, Date.now() - windowMs - 1, 'createAll:*').run()
        expect((await create('203.0.113.34')).status).toBe(201)
    })
})

describe('joining', () => {
    it('is limited per address across Worker instances', async () => {
        const { code } = await createMeeting()
        const ip = '203.0.113.40'
        const { max } = DURABLE_LIMITS.join

        for (let i = 0; i < max; i++) {
            if (i % 20 === 0) resetRateLimits()
            expect((await api('POST', `/api/meetings/${code}/join`, { ip, body: { name: 'x' } })).status).not.toBe(429)
        }

        resetRateLimits()
        expect((await api('POST', `/api/meetings/${code}/join`, { ip, body: { name: 'x' } })).status).toBe(429)
        expect((await join(code)).status).not.toBe(429)
    })
})

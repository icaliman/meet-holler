import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { api, createMeeting, freshIp, joined } from './helpers'

/** A raw request, for the headers and bodies the `api` helper would tidy up. */
function raw(method: string, path: string, headers: Record<string, string> = {}, body?: string) {
    return exports.default.fetch(`http://meet.test${path}`, { method, headers: { 'cf-connecting-ip': freshIp(), ...headers }, body })
}

describe('security headers on API responses', () => {
    const expectHeaders = (headers: Headers) => {
        expect(headers.get('Cache-Control')).toBe('no-store')
        expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(headers.get('Referrer-Policy')).toBe('no-referrer')
        expect(headers.get('X-Frame-Options')).toBe('DENY')
        expect(headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
        expect(headers.get('Content-Security-Policy')).toContain("default-src 'none'")
        expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    }

    it('are on a JSON answer, an error, an unknown route and the calendar file', async () => {
        const { code } = await createMeeting({ scheduledAt: new Date(Date.now() + 3600_000).toISOString() })

        expectHeaders((await api('GET', `/api/meetings/${code}`)).headers)
        expectHeaders((await api('GET', '/api/meetings/aaaaaaaaaa')).headers)
        expectHeaders((await api('GET', '/api/nothing/here')).headers)
        expectHeaders((await api('POST', `/api/meetings/${code}/end`)).headers)
        expectHeaders((await api('GET', `/api/meetings/${code}.ics`)).headers)
    })

    it('are on a rate-limited answer too', async () => {
        const ip = freshIp()
        let last = await api('POST', '/api/meetings', { ip, body: { visibility: 'public' } })
        for (let i = 0; i < 25 && last.status !== 429; i++) last = await api('POST', '/api/meetings', { ip, body: { visibility: 'public' } })

        expect(last.status).toBe(429)
        expectHeaders(last.headers)
    })

    it('never set a cookie or open the API to other origins', async () => {
        const { code } = await createMeeting()
        const answer = await api('GET', `/api/meetings/${code}`, { headers: { Origin: 'https://elsewhere.example' } })
        expect(answer.headers.get('Set-Cookie')).toBeNull()
        expect(answer.headers.get('Access-Control-Allow-Origin')).toBeNull()

        const preflight = await raw('OPTIONS', '/api/meetings', { Origin: 'https://elsewhere.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' })
        expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull()
        expect(preflight.headers.get('Access-Control-Allow-Methods')).toBeNull()
    })
})

describe('requests from another site', () => {
    const create = JSON.stringify({ visibility: 'public' })

    it('cannot create a meeting from a form or a no-cors fetch', async () => {
        // What a page on another site can send without a preflight: a "simple" POST.
        const simple = await raw('POST', '/api/meetings', { 'Content-Type': 'text/plain', Origin: 'https://elsewhere.example', 'Sec-Fetch-Site': 'cross-site' }, create)
        expect(simple.status).toBe(403)

        // An older browser that sends Origin but no fetch metadata.
        expect((await raw('POST', '/api/meetings', { 'Content-Type': 'text/plain', Origin: 'https://elsewhere.example' }, create)).status).toBe(403)
        // Fetch metadata alone (Origin stripped by something in between).
        expect((await raw('POST', '/api/meetings', { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, create)).status).toBe(403)
        // The same site but another origin (a sibling subdomain) is another origin.
        expect((await raw('POST', '/api/meetings', { 'Content-Type': 'application/json', Origin: 'http://evil.meet.test', 'Sec-Fetch-Site': 'same-site' }, create)).status).toBe(403)
    })

    it('cannot act for someone in a meeting either', async () => {
        const { code, hostKey } = await createMeeting()
        const host = await joined(code, { hostKey, name: 'Ion' })

        const end = await raw('POST', `/api/meetings/${code}/end`, { Authorization: `Bearer ${host.token}`, Origin: 'https://elsewhere.example' })
        expect(end.status).toBe(403)
        expect((await api('GET', `/api/meetings/${code}`)).body.status).toBe('open')
    })

    it('leaves the app itself, clients without an Origin and plain reads alone', async () => {
        expect((await raw('POST', '/api/meetings', { 'Content-Type': 'application/json', Origin: 'http://meet.test', 'Sec-Fetch-Site': 'same-origin' }, create)).status).toBe(201)
        expect((await raw('POST', '/api/meetings', { 'Content-Type': 'application/json' }, create)).status).toBe(201)
        // Behind a dev proxy the URL's host can differ from the page's: the Host header counts too.
        expect((await raw('POST', '/api/meetings', { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', Host: 'localhost:5173' }, create)).status).toBe(201)
        // A read changes nothing, and the browser keeps the answer from the other site anyway.
        expect((await raw('GET', '/api/health', { Origin: 'https://elsewhere.example', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(200)
    })

    it('takes JSON bodies only as application/json', async () => {
        const text = await raw('POST', '/api/meetings', { 'Content-Type': 'text/plain' }, create)
        expect(text.status).toBe(422)
        expect((await text.json<any>()).error.message).toContain('application/json')

        expect((await raw('POST', '/api/meetings', {}, create)).status).toBe(422)
        expect((await raw('POST', '/api/meetings', { 'Content-Type': 'application/json; charset=utf-8' }, create)).status).toBe(201)
    })
})

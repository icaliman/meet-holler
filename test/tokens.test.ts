import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '../worker/app'
import { base64url, signToken, TOKEN_TTL_MS, verifyToken } from '../worker/lib/crypto'
import { api, createMeeting, freshIp, joined } from './helpers'

afterEach(() => {
    vi.useRealTimers()
})

const SECRET = 'a-secret-that-is-long-enough-to-sign-with'

const poll = (code: string, token: string, tab = 't') => api('GET', `/api/meetings/${code}/holler/poll?call=${code}&tab=${tab}&claim=1`, { token })

/** A token with any payload, signed with the Worker's own secret. */
async function forged(payload: unknown, secret = env.SESSION_SECRET): Promise<string> {
    const body = base64url(new TextEncoder().encode(JSON.stringify(payload)))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

    return `${body}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))}`
}

describe('participant tokens', () => {
    it('expire a day after they were issued', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-02-01T10:00:00Z'))
        const { code, hostKey } = await createMeeting()
        const host = await joined(code, { hostKey, name: 'Ion' })

        vi.setSystemTime(new Date(Date.now() + TOKEN_TTL_MS - 60_000))
        expect((await api('GET', `/api/meetings/${code}/me`, { token: host.token })).status).toBe(200)

        vi.setSystemTime(new Date(Date.now() + 120_000))
        expect((await api('GET', `/api/meetings/${code}/me`, { token: host.token })).status).toBe(401)
        expect((await poll(code, host.token)).status).toBe(401)
        expect((await api('POST', `/api/meetings/${code}/end`, { token: host.token })).status).toBe(401)
        expect((await api('POST', `/api/meetings/${code}/holler/leave`, { body: { token: host.token, tab: 't' } })).status).toBe(401)

        // The host key is not a token: the host joins again with it.
        expect((await joined(code, { hostKey, name: 'Ion' })).participant.role).toBe('host')
    })

    it('are refused without an expiry, with a stretched one, or with anything but the claims they carry', async () => {
        const { code } = await createMeeting()
        const guest = await joined(code, { name: 'Ana' })
        const p = guest.participant.id
        const soon = Math.floor(Date.now() / 1000) + 3600

        expect((await api('GET', `/api/meetings/${code}/me`, { token: await forged({ m: code, p, x: soon }) })).status).toBe(200)
        for (const payload of [
            { m: code, p },
            { m: code, p, x: null },
            { m: code, p, x: String(soon) },
            { m: code, p, x: Number.POSITIVE_INFINITY },
            { m: code, p, x: Math.floor(Date.now() / 1000) - 1 },
            { m: code, p, x: Math.floor((Date.now() + 2 * TOKEN_TTL_MS) / 1000) },
        ]) {
            expect((await api('GET', `/api/meetings/${code}/me`, { token: await forged(payload) })).status, JSON.stringify(payload)).toBe(401)
        }
    })

    it('name one participant of one meeting: no other meeting, and no role of their own', async () => {
        const first = await createMeeting()
        const second = await createMeeting()
        const guest = await joined(first.code, { name: 'Ana' })
        const soon = Math.floor(Date.now() / 1000) + 3600

        // Another meeting's routes with this token, and this participant claimed for another meeting.
        expect((await api('GET', `/api/meetings/${second.code}/me`, { token: guest.token })).status).toBe(401)
        expect((await poll(second.code, guest.token)).status).toBe(401)
        expect((await api('GET', `/api/meetings/${second.code}/me`, { token: await forged({ m: second.code, p: guest.participant.id, x: soon }) })).status).toBe(401)

        // A role in the token means nothing: it is read from the participant's record.
        const claimed = await forged({ m: first.code, p: guest.participant.id, x: soon, role: 'host', r: 'host' })
        expect((await api('POST', `/api/meetings/${first.code}/end`, { token: claimed })).status).toBe(403)
        expect((await api('GET', `/api/meetings/${first.code}/waiting`, { token: claimed })).status).toBe(403)

        // Signed with another secret, or not at all.
        expect((await api('GET', `/api/meetings/${first.code}/me`, { token: await forged({ m: first.code, p: guest.participant.id, x: soon }, 'another-secret-that-is-long-enough-too') })).status).toBe(401)
        expect((await api('GET', `/api/meetings/${first.code}/me`, { token: `${guest.token.split('.')[0]}.` })).status).toBe(401)
    })
})

describe('the signing secret', () => {
    it('must be there and long: nothing is signed or checked with a weak one', async () => {
        for (const weak of [undefined, '', 'short', 'change-me-to-a-long-random-string']) {
            await expect(signToken({ m: 'abcdefghjk', p: 'p1' }, weak as string)).rejects.toThrow(/SESSION_SECRET/)
            await expect(verifyToken('a.b', weak as string)).rejects.toThrow(/SESSION_SECRET/)
        }
        expect(await verifyToken(await signToken({ m: 'abcdefghjk', p: 'p1' }, SECRET), SECRET)).toEqual({ m: 'abcdefghjk', p: 'p1' })
    })

    it('makes the Worker refuse to hand out tokens when it is missing', async () => {
        const { code } = await createMeeting()
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

        for (const weak of [undefined, 'short']) {
            const response = await app.fetch(new Request(`http://meet.test/api/meetings/${code}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': freshIp() },
                body: JSON.stringify({ name: 'Ana' }),
            }), { ...env, SESSION_SECRET: weak } as unknown as Env)

            expect(response.status).toBe(500)
            expect(await response.text()).not.toContain('token')
        }
        expect(errors).toHaveBeenCalled()
        errors.mockRestore()
    })
})

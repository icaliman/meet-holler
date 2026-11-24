import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_PENDING_BYTES, MAX_PENDING_SIGNALS, MAX_SIGNAL_BYTES } from '../worker/holler/routes'
import worker from '../worker/index'
import { api, createMeeting, join, joined, row, rows } from './helpers'

afterEach(() => {
    vi.useRealTimers()
})

/** A meeting with two people in the call. */
async function talking() {
    const { code, hostKey } = await createMeeting()
    const ion = await joined(code, { hostKey, name: 'Ion' })
    const ana = await joined(code, { name: 'Ana' })
    for (const person of [ion, ana]) await api('POST', `/api/meetings/${code}/holler/answer`, { token: person.token, body: { tab: `tab-${person.participant.id}` } })

    return { code, hostKey, ion, ana }
}

const send = (code: string, token: string, type: string, payload: unknown, to?: string) =>
    api('POST', `/api/meetings/${code}/holler/signals`, { token, body: to === undefined ? { type, payload } : { type, payload, to } })

describe('request bodies', () => {
    it('are refused past 16 KB before anything reads them', async () => {
        const big = await api('POST', '/api/meetings', { body: { visibility: 'public', padding: 'x'.repeat(20_000) } })
        expect(big.status).toBe(413)
        expect(big.body).toMatchObject({ error: { code: 'invalid' }, reason: 'too_large' })

        const { code } = await createMeeting()
        expect((await join(code, { name: 'Ana', padding: 'x'.repeat(20_000) })).status).toBe(413)
        expect(await row('SELECT id FROM participants WHERE meeting_code = ?', code)).toBeNull()
    })

    it('are refused when they are sent as a stream with no length, too', async () => {
        const { exports } = await import('cloudflare:workers')
        const chunk = new TextEncoder().encode(' '.repeat(8_192))
        let sent = 0
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent++ < 8) controller.enqueue(chunk)
                else controller.close()
            },
        })
        const response = await exports.default.fetch('http://meet.test/api/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.99.0.1' }, body, duplex: 'half' } as RequestInit)
        expect(response.status).toBe(413)
    })

    it('leave room for a signal of the allowed size, and no more', async () => {
        const { code, ion } = await talking()

        expect((await send(code, ion.token, 'offer', { sdp: 'x'.repeat(MAX_SIGNAL_BYTES - 100) })).status).toBe(201)

        const over = await send(code, ion.token, 'offer', { sdp: 'x'.repeat(MAX_SIGNAL_BYTES) })
        expect(over.status).toBe(413)
        expect(over.body.reason).toBe('too_large')

        expect((await send(code, ion.token, 'offer', { sdp: 'x'.repeat(200_000) })).status).toBe(413)
    })
})

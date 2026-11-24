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

describe('signals waiting to be read', () => {
    it('stop at a number per sender', async () => {
        const { code, ion, ana } = await talking()
        const insert = env.DB.prepare(`INSERT INTO signals (meeting_code, to_id, from_id, type, payload, created_at) VALUES (?, ?, ?, 'ice', '{}', ?)`)
        for (let done = 0; done < MAX_PENDING_SIGNALS; done += 100) {
            await env.DB.batch(Array.from({ length: Math.min(100, MAX_PENDING_SIGNALS - done) }, () => insert.bind(code, ana.participant.id, ion.participant.id, Date.now())))
        }

        const response = await send(code, ion.token, 'ice', {})
        expect(response.status).toBe(429)
        expect(response.body.reason).toBe('too_many')
        expect(MAX_PENDING_SIGNALS).toBeLessThanOrEqual(200)
    })

    it('stop at a size per sender, long before the number', async () => {
        const { code, ion, ana } = await talking()
        const each = MAX_SIGNAL_BYTES - 1_000
        const fit = Math.floor(MAX_PENDING_BYTES / each)

        for (let i = 0; i < fit; i++) expect((await send(code, ion.token, 'offer', { sdp: 'x'.repeat(each - 20) })).status).toBe(201)

        const over = await send(code, ion.token, 'offer', { sdp: 'x'.repeat(each - 20) })
        expect(over.status).toBe(429)
        expect(over.body.reason).toBe('too_many')
        expect((await row('SELECT COUNT(*) AS n, SUM(LENGTH(payload)) AS bytes FROM signals WHERE to_id = ?', ana.participant.id))).toMatchObject({ n: fit })

        // The other person's allowance is their own, and reading frees the sender's.
        expect((await send(code, ana.token, 'ice', {})).status).toBe(201)
        const tab = `tab-${ana.participant.id}`
        const read = await api('GET', `/api/meetings/${code}/holler/poll?call=${code}&tab=${tab}&claim=1`, { token: ana.token })
        await api('GET', `/api/meetings/${code}/holler/poll?call=${code}&tab=${tab}&claim=1&after=${read.body.cursor}`, { token: ana.token })
        expect((await send(code, ion.token, 'offer', { sdp: 'x'.repeat(each - 20) })).status).toBe(201)
    })

    it('are dropped after a minute unread, by the next signal in that meeting', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-03-01T10:00:00Z'))
        const { code, ion, ana } = await talking()
        const other = await talking()
        await send(code, ion.token, 'ice', { n: 1 })
        await send(other.code, other.ion.token, 'ice', { n: 1 })

        vi.setSystemTime(new Date(Date.now() + 61_000))
        expect((await send(code, ana.token, 'ice', { n: 2 })).status).toBe(201)

        const left = await rows<{ meeting_code: string, payload: string }>('SELECT meeting_code, payload FROM signals WHERE meeting_code IN (?, ?) ORDER BY id', code, other.code)
        // The stale one in this meeting is gone; the other meeting's is not this request's business.
        expect(left.map((s) => [s.meeting_code, s.payload])).toEqual([[other.code, '{"n":1}'], [code, '{"n":2}']])
    })
})

describe('the sweep every 15 minutes', () => {
    async function run(cron: string) {
        const ctx = createExecutionContext()
        await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron }), env, ctx)
        await waitOnExecutionContext(ctx)
    }

    it('deletes signals nobody read within a minute and leaves meetings alone', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-03-02T10:00:00Z'))
        const idle = await createMeeting()
        const { code, ion } = await talking()
        await send(code, ion.token, 'ice', { old: true })

        vi.setSystemTime(new Date(Date.now() + 2 * 86_400_000))
        await env.DB.prepare(`INSERT INTO signals (meeting_code, to_id, from_id, type, payload, created_at) VALUES (?, 'a', 'b', 'ice', '{"fresh":true}', ?)`).bind(code, Date.now()).run()
        await run('*/15 * * * *')

        expect((await rows('SELECT payload FROM signals WHERE meeting_code = ?', code)).map((s) => s.payload)).toEqual(['{"fresh":true}'])
        // Ending meetings nobody came back to is the daily run's job.
        expect((await row('SELECT ended_at FROM meetings WHERE code = ?', idle.code)).ended_at).toBeNull()

        await run('17 3 * * *')
        expect((await row('SELECT ended_at FROM meetings WHERE code = ?', idle.code)).ended_at).not.toBeNull()
    })
})

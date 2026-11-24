import { createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'
import { api, createMeeting, joined, row } from './helpers'

const DAY = 86_400_000

afterEach(() => {
    vi.useRealTimers()
})

async function runCron() {
    const ctx = createExecutionContext()
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '17 3 * * *' }), env, ctx)
    await waitOnExecutionContext(ctx)
}

describe('the daily cleanup', () => {
    it('ends a meeting nobody has been in for a day, and leaves the rest', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-07-01T10:00:00Z'))
        const empty = await createMeeting()
        const used = await createMeeting()
        const usedHost = await joined(used.code, { hostKey: used.hostKey })
        const upcoming = await createMeeting({ scheduledAt: '2027-07-05T10:00:00Z' })

        // Someone was in `used` an hour ago.
        vi.setSystemTime(new Date('2027-07-02T10:30:00Z'))
        await env.DB.prepare('UPDATE participants SET seen_at = ? WHERE id = ?').bind(Date.now() - 3_600_000, usedHost.participant.id).run()
        await runCron()

        expect((await api('GET', `/api/meetings/${empty.code}`)).body.status).toBe('ended')
        expect((await row('SELECT end_reason FROM meetings WHERE code = ?', empty.code)).end_reason).toBe('expired')
        expect((await api('GET', `/api/meetings/${used.code}`)).body.status).toBe('open')
        expect((await api('GET', `/api/meetings/${upcoming.code}`)).body.status).toBe('scheduled')
    })

    it('keeps a scheduled meeting until a day after its end', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-08-01T10:00:00Z'))
        const { code } = await createMeeting({ scheduledAt: '2027-08-03T10:00:00Z', durationMin: 60 })

        vi.setSystemTime(new Date('2027-08-04T10:59:00Z'))
        await runCron()
        expect((await api('GET', `/api/meetings/${code}`)).body.status).toBe('open')

        vi.setSystemTime(new Date('2027-08-04T11:01:00Z'))
        await runCron()
        expect((await api('GET', `/api/meetings/${code}`)).body.status).toBe('ended')
    })

    it('deletes meetings that ended a week ago, with their people', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-09-01T10:00:00Z'))
        const { code, hostKey } = await createMeeting()
        await joined(code, { hostKey })
        await api('POST', `/api/meetings/${code}/end`, { hostKey })

        vi.setSystemTime(new Date(Date.now() + 6 * DAY))
        await runCron()
        expect(await row('SELECT code FROM meetings WHERE code = ?', code)).not.toBeNull()

        vi.setSystemTime(new Date(Date.now() + 2 * DAY))
        await runCron()
        expect(await row('SELECT code FROM meetings WHERE code = ?', code)).toBeNull()
        expect(await row('SELECT id FROM participants WHERE meeting_code = ?', code)).toBeNull()
    })
})

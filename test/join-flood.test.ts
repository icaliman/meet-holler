import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_RECORDS, MAX_WAITING, PRUNE_AFTER_MS } from '../worker/lib/timing'
import { api, createMeeting, join, joined, row } from './helpers'

afterEach(() => {
    vi.useRealTimers()
})

const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(iso))
}
const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))

describe('a flood of people joining one meeting', () => {
    it('stops at twenty in the waiting room, and never keeps the host out', async () => {
        at('2027-06-03T10:00:00Z')
        const { code, hostKey } = await createMeeting({ waitingRoom: true })

        for (let i = 0; i < MAX_WAITING; i++) expect((await join(code, { name: `Guest ${i}` })).status).toBe(201)

        const refused = await join(code, { name: 'One more' })
        expect(refused.status).toBe(429)
        expect(refused.body.error).toEqual({ code: 'rate_limited', message: 'Too many people are waiting to get into this meeting. Try again in a minute.' })
        expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)

        const host = await joined(code, { hostKey, name: 'Ion' })
        expect((await api('GET', `/api/meetings/${code}/waiting`, { token: host.token })).body).toHaveLength(MAX_WAITING)

        // Guests who stopped asking make room: they are off the host's list after a minute.
        later(61_000)
        expect((await join(code, { name: 'Later' })).status).toBe(201)
    })

    it('stops at sixty records per meeting, lets the host in, and forgets people ten minutes after they left', async () => {
        at('2027-06-04T10:00:00Z')
        const { code, hostKey } = await createMeeting()
        const gone = env.DB.prepare(`INSERT INTO participants (id, meeting_code, name, role, status, seat, created_at, admitted_at, left_at) VALUES (?, ?, 'x', 'guest', ?, ?, ?, ?, ?)`)
        const statuses = ['left', 'declined', 'missed', 'dropped', 'removed', 'denied']
        await env.DB.batch(Array.from({ length: MAX_RECORDS }, (_, i) => gone.bind(`gone-${i}`, code, statuses[i % statuses.length], i, Date.now(), Date.now(), Date.now())))

        const refused = await join(code, { name: 'Ana' })
        expect(refused.status).toBe(429)
        expect(refused.body.error.message).toBe('Too many people tried to get into this meeting. Try again in a few minutes.')

        expect((await join(code, { hostKey, name: 'Ion' })).status).toBe(201)

        later(PRUNE_AFTER_MS + 1000)
        const ana = await join(code, { name: 'Ana' })
        expect(ana.status).toBe(201)
        expect((await row(`SELECT COUNT(*) AS n FROM participants WHERE meeting_code = ? AND id LIKE 'gone-%'`, code)).n).toBe(0)
        expect(ana.body.participant.state).toBe('admitted')
    })

    it('keeps people who are in the meeting or waiting, however long', async () => {
        at('2027-06-05T10:00:00Z')
        const { code, hostKey } = await createMeeting({ waitingRoom: true })
        const host = await joined(code, { hostKey, name: 'Ion' })
        const waiting = await joined(code, { name: 'Ana' })
        await api('POST', `/api/meetings/${code}/holler/answer`, { token: host.token, body: { tab: 't' } })

        for (let i = 0; i < 24; i++) {
            later(30_000)
            await api('GET', `/api/meetings/${code}/holler/poll?call=${code}&tab=t&claim=1`, { token: host.token })
            await api('GET', `/api/meetings/${code}/me`, { token: waiting.token })
        }
        await join(code, { name: 'Mihai' })

        expect((await api('GET', `/api/meetings/${code}/me`, { token: host.token })).body.participant.state).toBe('admitted')
        expect((await api('GET', `/api/meetings/${code}/me`, { token: waiting.token })).body.participant.state).toBe('waiting')
    })
})

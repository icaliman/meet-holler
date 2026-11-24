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

describe('names and titles', () => {
    it('lose characters that hide, reorder or spoof text', async () => {
        const { code, hostKey } = await createMeeting({ title: 'Plan\u202e ning\u2066 \u200bQ3\u0085', hostName: '\u200fAna\ufeff', scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })
        const meeting = (await api('GET', `/api/meetings/${code}`)).body
        expect(meeting.title).toBe('Plan ning Q3')
        expect(meeting.hostName).toBe('Ana')

        // Right-to-left override, zero-width space, soft hyphen, a tag character, a C1 control.
        const guest = await joined(code, { hostKey, name: '\u202eIon\u200b \u00adC\u{e0041}.\u009f' })
        expect(guest.participant.name).toBe('Ion C.')

        const ics = (await api('GET', `/api/meetings/${code}.ics`)).body as string
        expect(ics).toContain('SUMMARY:Plan ning Q3')
        expect(ics).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u200b\u0085]/)
    })

    it('are composed, so the same name is the same text', async () => {
        const { code } = await createMeeting()
        expect((await joined(code, { name: 'Cre\u0301mieux' })).participant.name).toBe('Cr\u00e9mieux')
    })

    it('keep what scripts and emoji need', async () => {
        const { code } = await createMeeting()
        // Zero-width non-joiner in Persian, a joined emoji with its variation selector.
        expect((await joined(code, { name: '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645' })).participant.name).toBe('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645')
        expect((await joined(code, { name: 'Ana \u{1f469}\u200d\u{1f4bb} \u2764\ufe0f' })).participant.name).toBe('Ana \u{1f469}\u200d\u{1f4bb} \u2764\ufe0f')
    })

    it('must show something', async () => {
        const { code } = await createMeeting()
        for (const name of ['\u200b\u200b', '\u200d\u200c', '\u202e\u2066', '\ufe0f', '\u00a0\u3000']) {
            const response = await join(code, { name })
            expect(response.status, JSON.stringify(name)).toBe(422)
            expect(response.body.error.message).toBe('Your name is required.')
        }
        expect((await createMeeting({ title: '\u200b\u202e' })).meeting.title).toBeNull()
    })
})

describe('passcodes on the way in', () => {
    it('are refused past 64 characters without being hashed or counted', async () => {
        const { code } = await createMeeting({ visibility: 'private', passcode: 'tulip-42' })

        const long = await join(code, { name: 'Ana', passcode: 'x'.repeat(65) })
        expect(long.status).toBe(422)
        expect((await row('SELECT pass_failures FROM meetings WHERE code = ?', code)).pass_failures).toBe(0)

        expect((await join(code, { name: 'Ana', hostKey: 'k'.repeat(300) })).status).toBe(422)
        expect((await join(code, { name: 'Ana', passcode: 'tulip-42' })).status).toBe(201)
    })
})

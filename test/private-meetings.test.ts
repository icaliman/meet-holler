import { describe, expect, it } from 'vitest'
import { api, createMeeting, join, joined } from './helpers'

const soon = () => new Date(Date.now() + 3_600_000).toISOString()

async function privateMeeting(fields: Record<string, unknown> = {}) {
    return createMeeting({ visibility: 'private', passcode: 'tulip-42', title: 'Board: the merger', hostName: 'Ana Pop', scheduledAt: soon(), durationMin: 45, ...fields })
}

/** What someone with only the link may know about a private meeting. */
const withheld = { title: null, hostName: null, participantCount: null, locked: null }

describe('a private meeting, to someone with only the link', () => {
    it('says that it exists, when it is and that it needs a passcode, and nothing else', async () => {
        const { code, hostKey } = await privateMeeting()
        await joined(code, { hostKey, name: 'Ana' })
        await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { locked: true } })

        const seen = await api('GET', `/api/meetings/${code}`)
        expect(seen.status).toBe(200)
        expect(seen.body).toEqual({
            code,
            visibility: 'private',
            requiresPasscode: true,
            waitingRoom: false,
            scheduledAt: expect.any(String),
            durationMin: 45,
            status: 'open',
            capacity: 4,
            // How this deployment carries signaling: nothing about the meeting or who is in it.
            relay: null,
            ...withheld,
        })
        expect(JSON.stringify(seen.body)).not.toContain('merger')
        expect(JSON.stringify(seen.body)).not.toContain('Ana')
    })

    it('does not say whether it is locked or full before the passcode is right', async () => {
        const { code, hostKey } = await privateMeeting({ scheduledAt: undefined })
        for (let i = 0; i < 4; i++) await joined(code, { hostKey, name: `Host ${i}` })
        await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { locked: true } })

        expect((await join(code, { name: 'Eve' })).body.error.code).toBe('passcode_required')
        expect((await join(code, { name: 'Eve', passcode: 'guess' })).body.error.code).toBe('passcode_wrong')
        expect((await join(code, { name: 'Eve', passcode: 'tulip-42' })).body.error.code).toBe('locked')
    })

    it('gets a calendar file without the title or the host', async () => {
        const { code } = await privateMeeting()

        const ics = await api('GET', `/api/meetings/${code}.ics`)
        expect(ics.status).toBe(200)
        expect(ics.body).toContain('SUMMARY:Private meeting')
        // Long lines are folded: unfold before looking for a sentence.
        expect(ics.body.replace(/\r\n /g, '')).toContain('A passcode is needed')
        expect(ics.body).not.toContain('merger')
        expect(ics.body).not.toContain('Ana Pop')
    })

    it('learns nothing more from a token of another meeting, a made-up one, or after being denied or removed', async () => {
        const { code, hostKey } = await privateMeeting({ waitingRoom: true })
        const other = await createMeeting()
        const elsewhere = await joined(other.code, { name: 'Eve' })

        expect((await api('GET', `/api/meetings/${code}`, { token: elsewhere.token })).body).toMatchObject(withheld)
        expect((await api('GET', `/api/meetings/${code}`, { token: 'made.up' })).body).toMatchObject(withheld)

        // The host opens the scheduled meeting; the guest then waits to be let in.
        await joined(code, { hostKey, name: 'Ana' })
        const guest = await joined(code, { name: 'Mihai', passcode: 'tulip-42' })
        expect((await api('GET', `/api/meetings/${code}`, { token: guest.token })).body.title).toBe('Board: the merger')
        await api('POST', `/api/meetings/${code}/waiting/${guest.participant.id}/deny`, { hostKey })
        expect((await api('GET', `/api/meetings/${code}`, { token: guest.token })).body).toMatchObject(withheld)
        expect((await api('GET', `/api/meetings/${code}.ics`, { token: guest.token })).body).toContain('SUMMARY:Private meeting')
    })
})

describe('a private meeting, to the people in it', () => {
    it('is shown in full to the host key and to someone who got in with the passcode', async () => {
        const { code, hostKey } = await privateMeeting()
        const full = { title: 'Board: the merger', hostName: 'Ana Pop', participantCount: 0, locked: false }

        expect((await api('GET', `/api/meetings/${code}`, { hostKey })).body).toMatchObject(full)

        const guest = await joined(code, { hostKey, name: 'Ana' })
        expect(guest.meeting).toMatchObject({ title: 'Board: the merger', hostName: 'Ana Pop' })
        expect((await api('GET', `/api/meetings/${code}`, { token: guest.token })).body).toMatchObject({ ...full, participantCount: 1 })
        expect((await api('GET', `/api/meetings/${code}/me`, { token: guest.token })).body.meeting).toMatchObject({ ...full, participantCount: 1 })

        const ics = await api('GET', `/api/meetings/${code}.ics`, { hostKey })
        expect(ics.body).toContain('SUMMARY:Board: the merger')
        expect(ics.body).toContain('Host: Ana Pop')
    })
})

describe('the host key on a lookup', () => {
    it('is checked: a wrong one is refused rather than ignored, on any meeting', async () => {
        const hidden = await privateMeeting()
        const open = await createMeeting({ title: 'Stand-up' })

        for (const { code } of [hidden, open]) {
            const wrong = await api('GET', `/api/meetings/${code}`, { hostKey: 'not-the-key' })
            expect(wrong.status).toBe(403)
            expect(wrong.body.error.code).toBe('forbidden')
        }
        expect((await api('GET', `/api/meetings/${open.code}`, { hostKey: hidden.hostKey })).status).toBe(403)
        expect((await api('GET', `/api/meetings/${open.code}`, { hostKey: open.hostKey })).body.title).toBe('Stand-up')
    })
})

describe('a public meeting', () => {
    it('is shown in full to anyone with the link, as before', async () => {
        const { code } = await createMeeting({ title: 'Stand-up', hostName: 'Ion', scheduledAt: soon() })

        expect((await api('GET', `/api/meetings/${code}`)).body).toMatchObject({ title: 'Stand-up', hostName: 'Ion', participantCount: 0, locked: false })
        expect((await api('GET', `/api/meetings/${code}.ics`)).body).toContain('SUMMARY:Stand-up')
    })
})

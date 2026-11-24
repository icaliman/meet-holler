import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALPHABET } from '../worker/lib/codes'
import { api, createMeeting, join, joined, row } from './helpers'

afterEach(() => {
    vi.useRealTimers()
})

describe('creating a meeting', () => {
    it('creates an instant public meeting with a code and a host key', async () => {
        const response = await api('POST', '/api/meetings', { body: { title: 'Standup', visibility: 'public', waitingRoom: false, hostName: 'Ana' } })

        expect(response.status).toBe(201)
        expect(response.body.hostKey).toMatch(/^[A-Za-z0-9_-]{32}$/)
        expect(response.body.meeting).toEqual({
            code: expect.stringMatching(new RegExp(`^[${ALPHABET}]{10}$`)),
            title: 'Standup',
            visibility: 'public',
            requiresPasscode: false,
            waitingRoom: false,
            scheduledAt: null,
            relay: null,
            durationMin: null,
            status: 'open',
            locked: false,
            participantCount: 0,
            capacity: 4,
            hostName: 'Ana',
        })
    })

    it('stores a private passcode and the host key only as hashes', async () => {
        const { code, hostKey } = await createMeeting({ visibility: 'private', passcode: 'tulip-42' })
        const stored = await row('SELECT passcode_hash, host_key_hash FROM meetings WHERE code = ?', code)

        expect(stored.passcode_hash).toMatch(/^pbkdf2-sha256\$30000\$[\w-]+\$[\w-]+$/)
        expect(stored.passcode_hash).not.toContain('tulip')
        expect(stored.host_key_hash).toMatch(/^[0-9a-f]{64}$/)
        expect(stored.host_key_hash).not.toBe(hostKey)
    })

    it('schedules a meeting with a default duration', async () => {
        const at = new Date(Date.now() + 86_400_000).toISOString()
        const { meeting } = await createMeeting({ scheduledAt: at })

        expect(meeting).toMatchObject({ scheduledAt: at, durationMin: 60, status: 'scheduled' })
    })

    it.each([
        [{ visibility: 'private' }, 'A private meeting needs a passcode.'],
        [{ visibility: 'public', passcode: '1234' }, 'A public meeting has no passcode: make it private to set one.'],
        [{ visibility: 'secret' }, 'visibility must be public or private.'],
        [{ visibility: 'private', passcode: '123' }, 'The passcode must be 4 to 64 characters.'],
        [{ title: 'x'.repeat(101) }, 'title can be at most 100 characters.'],
        [{ title: 42 }, 'title must be text.'],
        [{ waitingRoom: 'yes' }, 'waitingRoom must be true or false.'],
        [{ scheduledAt: 'tomorrow' }, 'scheduledAt must be an ISO date and time.'],
        [{ scheduledAt: '2020-01-01T10:00:00Z' }, 'scheduledAt is in the past.'],
        [{ scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 2 }, 'durationMin must be a whole number of minutes from 5 to 480.'],
        [{ scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 30.5 }, 'durationMin must be a whole number of minutes from 5 to 480.'],
    ])('refuses %j', async (body, message) => {
        const response = await api('POST', '/api/meetings', { body })

        expect(response.status).toBe(422)
        expect(response.body).toEqual({ error: { code: 'invalid', message }, message, reason: 'invalid' })
    })

    it('refuses a body that is not JSON', async () => {
        const response = await api('POST', '/api/meetings', { body: 'not json', headers: { 'Content-Type': 'application/json' } })

        expect(response.status).toBe(422)
        expect(response.body.error.code).toBe('invalid')
    })

    it('limits how many meetings one address creates', async () => {
        const ip = '203.0.113.9'
        for (let i = 0; i < 20; i++) expect((await api('POST', '/api/meetings', { body: {}, ip })).status).toBe(201)

        const response = await api('POST', '/api/meetings', { body: {}, ip })
        expect(response.status).toBe(429)
        expect(response.body.error.code).toBe('rate_limited')
        expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    })
})

describe('looking a meeting up', () => {
    it('takes the code with dashes and in any case', async () => {
        const { code } = await createMeeting({ title: 'Look' })
        const dashed = `${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`.toUpperCase()

        const response = await api('GET', `/api/meetings/${dashed}`)
        expect(response.status).toBe(200)
        expect(response.body).toMatchObject({ code, title: 'Look', status: 'open' })
    })

    it('answers not_found for an unknown or malformed code', async () => {
        expect((await api('GET', '/api/meetings/2222222222')).body.error.code).toBe('not_found')
        expect((await api('GET', '/api/meetings/0000000000')).status).toBe(404)
        expect((await api('GET', '/api/meetings/short')).status).toBe(404)
    })

    it('counts the people in the meeting, not the ones waiting', async () => {
        const { code, hostKey } = await createMeeting({ waitingRoom: true })
        await joined(code, { hostKey, name: 'Host' })
        await joined(code, { name: 'Waiting guest' })

        expect((await api('GET', `/api/meetings/${code}`)).body.participantCount).toBe(1)
    })

    it('serves a calendar file for a scheduled meeting, without the passcode', async () => {
        const start = new Date(Date.UTC(2027, 0, 15, 14, 30))
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(Date.UTC(2027, 0, 10)))
        const { code } = await createMeeting({ title: 'Plan, review; ship', visibility: 'private', passcode: 'secret-pass', scheduledAt: start.toISOString(), durationMin: 45, hostName: 'Ana' })

        const response = await api('GET', `/api/meetings/${code}.ics`)

        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
        expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="meeting-${code}.ics"`)
        const ics = response.body as string
        expect(ics).toContain('BEGIN:VCALENDAR\r\n')
        expect(ics).toContain('DTSTART:20270115T143000Z\r\n')
        expect(ics).toContain('DTEND:20270115T151500Z\r\n')
        expect(ics).toContain('SUMMARY:Plan\\, review\\; ship\r\n')
        expect(ics).toContain(`URL:http://meet.test/m/${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`)
        expect(ics).not.toContain('secret-pass')
        expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true)
    })

    it('has no calendar file for an instant meeting', async () => {
        const { code } = await createMeeting()

        expect((await api('GET', `/api/meetings/${code}.ics`)).status).toBe(404)
    })
})

describe('joining', () => {
    it('lets anyone with the link into a public meeting', async () => {
        const { code } = await createMeeting()
        const response = await join(code, { name: '  Mihai  ' })

        expect(response.status).toBe(201)
        expect(response.body.token).toMatch(/^[\w-]+\.[\w-]+$/)
        expect(response.body.participant).toEqual({ id: expect.any(String), name: 'Mihai', role: 'guest', state: 'admitted' })
        expect(response.body.meeting.participantCount).toBe(1)
    })

    it('makes whoever brings the host key the host', async () => {
        const { code, hostKey } = await createMeeting()
        const { participant } = await joined(code, { hostKey, name: 'Ana' })

        expect(participant.role).toBe('host')
    })

    it('refuses a wrong host key instead of ignoring it', async () => {
        const { code } = await createMeeting()
        const response = await join(code, { hostKey: 'not-the-key' })

        expect(response.status).toBe(403)
        expect(response.body.error.code).toBe('forbidden')
    })

    it('needs a name', async () => {
        const { code } = await createMeeting()

        expect((await join(code, { name: '   ' })).body.error).toEqual({ code: 'invalid', message: 'Your name is required.' })
        expect((await join(code, { name: 'x'.repeat(41) })).status).toBe(422)
    })

    it('gives seats in join order', async () => {
        const { code, hostKey } = await createMeeting()
        const host = await joined(code, { hostKey })
        const guest = await joined(code)

        const seats = await Promise.all([host, guest].map(({ participant }) => row('SELECT seat FROM participants WHERE id = ?', participant.id)))
        expect(seats.map((seat) => seat.seat)).toEqual([0, 1])
    })

    describe('a private meeting', () => {
        it('asks for the passcode and checks it', async () => {
            const { code } = await createMeeting({ visibility: 'private', passcode: 'tulip-42' })

            const missing = await join(code)
            expect(missing.status).toBe(401)
            expect(missing.body.error.code).toBe('passcode_required')

            const wrong = await join(code, { passcode: 'tulip-43' })
            expect(wrong.status).toBe(401)
            expect(wrong.body.error.code).toBe('passcode_wrong')

            expect((await join(code, { passcode: 'tulip-42' })).status).toBe(201)
        })

        it('lets the host in without the passcode', async () => {
            const { code, hostKey } = await createMeeting({ visibility: 'private', passcode: 'tulip-42' })

            expect((await join(code, { hostKey })).status).toBe(201)
        })

        it('stops taking passcodes after ten wrong ones, for everyone, until the window passes', async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-03-01T10:00:00Z'))
            const { code } = await createMeeting({ visibility: 'private', passcode: 'tulip-42' })

            for (let i = 0; i < 10; i++) expect((await join(code, { passcode: `guess-${i}` })).body.error.code).toBe('passcode_wrong')

            const locked = await join(code, { passcode: 'tulip-42' })
            expect(locked.status).toBe(429)
            expect(locked.body.error.code).toBe('rate_limited')
            expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(800)

            vi.setSystemTime(new Date('2027-03-01T10:16:00Z'))
            expect((await join(code, { passcode: 'tulip-42' })).status).toBe(201)
        })
    })

    describe('a scheduled meeting', () => {
        it('keeps guests out before the start until the host opens it', async () => {
            const { code, hostKey } = await createMeeting({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })

            const early = await join(code)
            expect(early.status).toBe(409)
            expect(early.body.error.code).toBe('not_started')

            await joined(code, { hostKey })
            expect((await api('GET', `/api/meetings/${code}`)).body.status).toBe('open')
            expect((await join(code)).status).toBe(201)
        })

        it('opens on its own at the start time', async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2027-04-01T09:00:00Z'))
            const { code } = await createMeeting({ scheduledAt: '2027-04-01T10:00:00Z' })

            vi.setSystemTime(new Date('2027-04-01T10:00:01Z'))
            expect((await join(code)).status).toBe(201)
        })
    })

    it('keeps guests out of a locked meeting, but not the host', async () => {
        const { code, hostKey } = await createMeeting()
        expect((await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { locked: true } })).status).toBe(200)

        const guest = await join(code)
        expect(guest.status).toBe(423)
        expect(guest.body.error.code).toBe('locked')
        expect((await join(code, { hostKey })).status).toBe(201)
    })

    it('fits four people, then says the meeting is full, host or not', async () => {
        const { code, hostKey } = await createMeeting()
        for (let i = 0; i < 4; i++) await joined(code, { name: `P${i}` })

        const fifth = await join(code)
        expect(fifth.status).toBe(409)
        expect(fifth.body.error).toEqual({ code: 'full', message: 'This meeting is full: four people are already in it.' })
        expect((await join(code, { hostKey })).body.error.code).toBe('full')
    })

    it('never lets more than four in when people join at the same moment', async () => {
        const { code } = await createMeeting()
        const results = await Promise.all(Array.from({ length: 7 }, (_, i) => join(code, { name: `P${i}` })))

        expect(results.filter((r) => r.status === 201)).toHaveLength(4)
        expect(results.filter((r) => r.status === 409)).toHaveLength(3)
        expect((await api('GET', `/api/meetings/${code}`)).body.participantCount).toBe(4)
    })

    it('frees the places of people who went quiet', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-05-01T10:00:00Z'))
        const { code } = await createMeeting()
        for (let i = 0; i < 4; i++) await joined(code)

        // Nobody answered the call (their tabs closed on the camera prompt): a minute later they are missed.
        vi.setSystemTime(new Date('2027-05-01T10:01:01Z'))
        expect((await api('GET', `/api/meetings/${code}`)).body.participantCount).toBe(0)
        expect((await join(code)).status).toBe(201)
    })

    it('refuses an ended meeting', async () => {
        const { code, hostKey } = await createMeeting()
        await api('POST', `/api/meetings/${code}/end`, { hostKey })

        const response = await join(code)
        expect(response.status).toBe(410)
        expect(response.body.error.code).toBe('ended')
    })

    it('limits joins from one address', async () => {
        const { code } = await createMeeting()
        const ip = '198.51.100.7'
        for (let i = 0; i < 30; i++) await api('POST', `/api/meetings/${code}/join`, { ip, body: { name: 'x' } })

        expect((await api('POST', `/api/meetings/${code}/join`, { ip, body: { name: 'x' } })).status).toBe(429)
    })
})

describe('the token', () => {
    it('answers /me with my participant and the meeting', async () => {
        const { code } = await createMeeting()
        const { token, participant } = await joined(code, { name: 'Mihai' })

        const me = await api('GET', `/api/meetings/${code}/me`, { token })
        expect(me.status).toBe(200)
        expect(me.body.participant).toEqual(participant)
        expect(me.body.meeting.code).toBe(code)
    })

    it('refuses no token, a tampered one, and one for another meeting', async () => {
        const first = await createMeeting()
        const second = await createMeeting()
        const { token } = await joined(first.code)
        const [payload, signature] = token.split('.')
        const forged = `${btoa(JSON.stringify({ m: first.code, p: 'someone-else' })).replace(/=+$/, '')}.${signature}`

        for (const bad of [undefined, `${payload}.AAAA`, forged, 'garbage']) {
            const response = await api('GET', `/api/meetings/${first.code}/me`, { token: bad })
            expect(response.status).toBe(401)
            expect(response.body.error.code).toBe('forbidden')
        }
        expect((await api('GET', `/api/meetings/${second.code}/me`, { token })).status).toBe(401)
    })
})

describe('the waiting room', () => {
    async function waitingMeeting() {
        const meeting = await createMeeting({ waitingRoom: true })
        const host = await joined(meeting.code, { hostKey: meeting.hostKey, name: 'Ana' })

        return { ...meeting, host }
    }

    it('lets the host straight in and puts guests in the waiting room', async () => {
        const { code, host } = await waitingMeeting()
        const guest = await joined(code, { name: 'Mihai' })

        expect(host.participant.state).toBe('admitted')
        expect(guest.participant.state).toBe('waiting')
        expect((await api('GET', `/api/meetings/${code}/me`, { token: guest.token })).body.participant.state).toBe('waiting')
    })

    it('lists the waiting guests for the host only', async () => {
        const { code, hostKey, host } = await waitingMeeting()
        const first = await joined(code, { name: 'First' })
        const second = await joined(code, { name: 'Second' })

        const list = await api('GET', `/api/meetings/${code}/waiting`, { token: host.token })
        expect(list.status).toBe(200)
        expect(list.body).toEqual([
            { id: first.participant.id, name: 'First', since: expect.any(String) },
            { id: second.participant.id, name: 'Second', since: expect.any(String) },
        ])

        expect((await api('GET', `/api/meetings/${code}/waiting`, { hostKey })).body).toHaveLength(2)
        expect((await api('GET', `/api/meetings/${code}/waiting`, { token: first.token })).status).toBe(403)
        expect((await api('GET', `/api/meetings/${code}/waiting`, { hostKey: 'wrong' })).status).toBe(403)
        expect((await api('GET', `/api/meetings/${code}/waiting`)).status).toBe(401)
    })

    it('leaves out guests who stopped polling', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2027-06-01T10:00:00Z'))
        const { code, host } = await waitingMeeting()
        const gone = await joined(code, { name: 'Gone' })
        const staying = await joined(code, { name: 'Staying' })

        vi.setSystemTime(new Date('2027-06-01T10:00:50Z'))
        await api('GET', `/api/meetings/${code}/me`, { token: staying.token })
        vi.setSystemTime(new Date('2027-06-01T10:01:05Z'))

        const list = await api('GET', `/api/meetings/${code}/waiting`, { token: host.token })
        expect(list.body.map((entry: { name: string }) => entry.name)).toEqual(['Staying'])
        expect(gone.participant.state).toBe('waiting')
    })

    it('admits a guest into the next seat', async () => {
        const { code, host } = await waitingMeeting()
        const guest = await joined(code)

        const admitted = await api('POST', `/api/meetings/${code}/waiting/${guest.participant.id}/admit`, { token: host.token })
        expect(admitted.status).toBe(200)
        expect(admitted.body.participant.state).toBe('admitted')
        expect((await api('GET', `/api/meetings/${code}/me`, { token: guest.token })).body.participant.state).toBe('admitted')
        expect((await row('SELECT seat FROM participants WHERE id = ?', guest.participant.id)).seat).toBe(1)
    })

    it('denies a guest', async () => {
        const { code, hostKey } = await waitingMeeting()
        const guest = await joined(code)

        const denied = await api('POST', `/api/meetings/${code}/waiting/${guest.participant.id}/deny`, { hostKey })
        expect(denied.body.participant.state).toBe('denied')
        expect((await api('GET', `/api/meetings/${code}/me`, { token: guest.token })).body.participant.state).toBe('denied')

        const again = await api('POST', `/api/meetings/${code}/waiting/${guest.participant.id}/admit`, { hostKey })
        expect(again.status).toBe(409)
        expect(again.body.error.code).toBe('invalid')
    })

    it('does not let anyone wait for a full meeting', async () => {
        const { code, hostKey } = await waitingMeeting()
        // The host key skips the waiting room, so it fills the meeting quickly.
        for (let i = 0; i < 3; i++) await joined(code, { hostKey })

        expect((await join(code)).body.error.code).toBe('full')
    })

    it('refuses to admit when the meeting filled up while the guest waited', async () => {
        const { code, hostKey } = await waitingMeeting()
        const guest = await joined(code)
        for (let i = 0; i < 3; i++) await joined(code, { hostKey })

        const response = await api('POST', `/api/meetings/${code}/waiting/${guest.participant.id}/admit`, { hostKey })
        expect(response.status).toBe(409)
        expect(response.body.error.code).toBe('full')
        expect((await api('GET', `/api/meetings/${code}/me`, { token: guest.token })).body.participant.state).toBe('waiting')
    })

    it('answers not_found for someone who is not in the meeting', async () => {
        const { code, hostKey } = await waitingMeeting()

        expect((await api('POST', `/api/meetings/${code}/waiting/nobody/admit`, { hostKey })).status).toBe(404)
    })

    it('admits everyone waiting, oldest first, when the host turns the waiting room off', async () => {
        const { code, hostKey } = await waitingMeeting()
        const guests = []
        for (let i = 0; i < 3; i++) guests.push(await joined(code, { name: `G${i}` }))

        const response = await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { waitingRoom: false } })
        expect(response.body.meeting).toMatchObject({ waitingRoom: false, participantCount: 4 })

        const seats = []
        for (const guest of guests) seats.push((await row('SELECT seat, status FROM participants WHERE id = ?', guest.participant.id)))
        expect(seats).toEqual([{ seat: 1, status: 'ringing' }, { seat: 2, status: 'ringing' }, { seat: 3, status: 'ringing' }])
    })
})

describe('host controls', () => {
    it('changes the title, the lock and the waiting room', async () => {
        const { code, hostKey } = await createMeeting({ title: 'Old' })
        const response = await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { title: 'New', locked: true, waitingRoom: true } })

        expect(response.status).toBe(200)
        expect(response.body.meeting).toMatchObject({ title: 'New', locked: true, waitingRoom: true })

        const cleared = await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { title: null } })
        expect(cleared.body.meeting).toMatchObject({ title: null, locked: true })
    })

    it('is for the host only', async () => {
        const { code } = await createMeeting()
        const guest = await joined(code)

        for (const [method, path] of [['PATCH', ''], ['POST', '/end'], ['POST', `/remove/${guest.participant.id}`]] as const) {
            const response = await api(method, `/api/meetings/${code}${path}`, { token: guest.token, body: {} })
            expect(response.status).toBe(403)
            expect(response.body.error.code).toBe('forbidden')
        }
    })

    it('ends the meeting for everyone', async () => {
        const { code, hostKey } = await createMeeting()
        const host = await joined(code, { hostKey })

        const response = await api('POST', `/api/meetings/${code}/end`, { token: host.token })
        expect(response.status).toBe(200)
        expect(response.body.meeting.status).toBe('ended')
        expect((await api('GET', `/api/meetings/${code}`)).body.status).toBe('ended')
        expect((await api('PATCH', `/api/meetings/${code}`, { hostKey, body: { locked: true } })).status).toBe(410)
        expect((await api('POST', `/api/meetings/${code}/end`, { hostKey })).status).toBe(410)
    })

    it('removes a participant', async () => {
        const { code, hostKey } = await createMeeting()
        const host = await joined(code, { hostKey })
        const guest = await joined(code)

        const response = await api('POST', `/api/meetings/${code}/remove/${guest.participant.id}`, { hostKey })
        expect(response.status).toBe(200)
        expect(response.body.participant.state).toBe('removed')
        expect((await api('GET', `/api/meetings/${code}/me`, { token: guest.token })).body.participant.state).toBe('removed')
        expect((await api('GET', `/api/meetings/${code}`)).body.participantCount).toBe(1)

        const self = await api('POST', `/api/meetings/${code}/remove/${host.participant.id}`, { hostKey })
        expect(self.status).toBe(422)
        expect((await api('POST', `/api/meetings/${code}/remove/nobody`, { hostKey })).status).toBe(404)
    })
})

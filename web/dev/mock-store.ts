// An in-memory stand-in for the Worker's meetings API (docs/api.md),
// for `npm run dev` only: it never ships. It follows the contract, not the Worker's code,
// so where they differ the Worker wins and this file is fixed.
//
// Seeded meetings, to look at every state without setting it up:
//   /m/xxx-ende-ddd   ended
//   /m/xxx-fuuu-uuu   full (four people in)
//   /m/xxx-sxhe-dxx   scheduled in two hours (countdown)
//   /m/xxx-pass-xxx   private, passcode 1234
//   /m/xxx-wayt-xxx   waiting room on
//   /m/xxx-xxck-xxx   locked

export interface MockParticipant {
    id: string
    name: string
    role: 'host' | 'guest'
    state: 'admitted' | 'waiting' | 'denied' | 'removed' | 'left'
    since: string
    seat: number
    /** Holler: whether they answered the call (joined), and their window. */
    joined: boolean
    tab: string | null
    seenAt: number
}

export interface MockMeeting {
    code: string
    title: string | null
    hostName: string | null
    visibility: 'public' | 'private'
    passcode: string | null
    waitingRoom: boolean
    scheduledAt: string | null
    durationMin: number | null
    opened: boolean
    ended: boolean
    locked: boolean
    hostKey: string
    participants: Map<string, MockParticipant>
    nextSeat: number
}

export interface MockRequest {
    method: string
    path: string
    query: URLSearchParams
    headers: Record<string, string | undefined>
    body: any
}

export interface MockResponse {
    status: number
    body?: unknown
    headers?: Record<string, string>
    text?: string
}

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
const CAPACITY = 4
/** Guests may come in this long before the start; earlier they see a countdown. */
const EARLY_MS = 5 * 60 * 1000

// Errors carry `message` and `reason` at the top level too, as the Worker's do, for HttpSignaling.
const fail = (status: number, code: string, message: string, reason: string = code): MockResponse => ({ status, body: { error: { code, message }, message, reason } })
const ok = (body: unknown, status = 200): MockResponse => ({ status, body })

export class MockStore {
    meetings = new Map<string, MockMeeting>()
    private ids = 0
    /** Extra routes (the Holler signaling in dev/mock-holler.ts) get a look at every request first. */
    extensions: Array<(req: MockRequest, store: MockStore) => MockResponse | null> = []

    constructor({ seed = true, now = () => Date.now() }: { seed?: boolean, now?: () => number } = {}) {
        this.now = now
        if (seed) this.seed()
    }

    now: () => number

    newId(prefix = 'p'): string {
        return `${prefix}${++this.ids}`
    }

    newCode(): string {
        let code = ''
        do {
            code = Array.from({ length: 10 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
        } while (this.meetings.has(code))

        return code
    }

    create(input: Partial<MockMeeting> & { code?: string }): MockMeeting {
        const meeting: MockMeeting = {
            code: input.code ?? this.newCode(),
            title: input.title ?? null,
            hostName: input.hostName ?? null,
            visibility: input.visibility ?? 'public',
            passcode: input.passcode ?? null,
            waitingRoom: input.waitingRoom ?? false,
            scheduledAt: input.scheduledAt ?? null,
            durationMin: input.durationMin ?? null,
            opened: false,
            ended: input.ended ?? false,
            locked: input.locked ?? false,
            hostKey: input.hostKey ?? `hk_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`,
            participants: new Map(),
            nextSeat: 0,
        }
        this.meetings.set(meeting.code, meeting)

        return meeting
    }

    addParticipant(meeting: MockMeeting, name: string, role: 'host' | 'guest', state: MockParticipant['state']): MockParticipant {
        const participant: MockParticipant = {
            id: this.newId(),
            name,
            role,
            state,
            since: new Date(this.now()).toISOString(),
            seat: -1,
            joined: false,
            tab: null,
            seenAt: this.now(),
        }
        if (state === 'admitted') participant.seat = meeting.nextSeat++
        meeting.participants.set(participant.id, participant)

        return participant
    }

    seed(): void {
        this.create({ code: 'xxxendeddd', title: 'Weekly sync', ended: true })
        const full = this.create({ code: 'xxxfuuuuuu', title: 'Design review' })
        for (const name of ['Ana', 'Mihai', 'Dana', 'Radu']) this.addParticipant(full, name, 'guest', 'admitted')
        this.create({ code: 'xxxsxhedxx', title: 'Quarterly planning', scheduledAt: new Date(this.now() + 2 * 3600_000 + 14 * 60_000).toISOString(), durationMin: 45 })
        this.create({ code: 'xxxpassxxx', title: 'Interview', visibility: 'private', passcode: '1234' })
        this.create({ code: 'xxxwaytxxx', title: 'Office hours', waitingRoom: true })
        this.create({ code: 'xxxxxckxxx', locked: true })
    }

    status(meeting: MockMeeting): 'scheduled' | 'open' | 'ended' {
        if (meeting.ended) return 'ended'
        if (meeting.opened || ! meeting.scheduledAt) return 'open'

        return new Date(meeting.scheduledAt).getTime() - EARLY_MS > this.now() ? 'scheduled' : 'open'
    }

    admitted(meeting: MockMeeting): MockParticipant[] {
        return [...meeting.participants.values()].filter((p) => p.state === 'admitted')
    }

    present(meeting: MockMeeting) {
        return {
            code: meeting.code,
            title: meeting.title,
            visibility: meeting.visibility,
            requiresPasscode: meeting.visibility === 'private',
            waitingRoom: meeting.waitingRoom,
            scheduledAt: meeting.scheduledAt,
            durationMin: meeting.durationMin,
            status: this.status(meeting),
            locked: meeting.locked,
            participantCount: this.admitted(meeting).length,
            capacity: CAPACITY,
            hostName: meeting.hostName,
        }
    }

    token(meeting: MockMeeting, participant: MockParticipant): string {
        return `mock.${meeting.code}.${participant.id}`
    }

    /** The participant a bearer token (or a `token` form field, for the leave beacon) names on this meeting. */
    auth(req: MockRequest, meeting: MockMeeting): MockParticipant | null {
        // Host routes also take the host key itself (X-Host-Key), from a page that has not joined.
        if (req.headers['x-host-key'] && req.headers['x-host-key'] === meeting.hostKey) {
            return [...meeting.participants.values()].find((p) => p.role === 'host')
                ?? { id: 'host-key', name: 'Host', role: 'host', state: 'admitted', since: '', seat: -1, joined: false, tab: null, seenAt: 0 }
        }
        const header = req.headers.authorization ?? ''
        const token = header.startsWith('Bearer ') ? header.slice(7) : (req.body?.token ?? '')
        const [, code, id] = /^mock\.([^.]+)\.(.+)$/.exec(String(token)) ?? []
        if (code !== meeting.code) return null

        return meeting.participants.get(id) ?? null
    }

    handle(req: MockRequest): MockResponse {
        for (const extension of this.extensions) {
            const response = extension(req, this)
            if (response) return response
        }

        const { method, path } = req
        if (method === 'POST' && path === '/api/meetings') return this.createMeeting(req.body ?? {})

        const match = /^\/api\/meetings\/([^/]+?)(\.ics)?(?:\/(.*))?$/.exec(path)
        if (! match) return fail(404, 'not_found', 'No such route.')
        const [, code, ics, rest = ''] = match
        const meeting = this.meetings.get(code.replace(/-/g, '').toLowerCase())
        if (! meeting) return fail(404, 'not_found', 'There is no meeting with that code.')

        if (ics) return this.calendar(meeting)
        if (method === 'GET' && rest === '') return ok(this.present(meeting))
        if (method === 'POST' && rest === 'join') return this.join(meeting, req.body ?? {})

        const me = this.auth(req, meeting)
        if (! me) return fail(401, 'forbidden', 'Join the meeting first.')
        if (method === 'GET' && rest === 'me') return ok({ participant: this.participant(me), meeting: this.present(meeting) })

        if (me.role !== 'host') return fail(403, 'forbidden', 'Only the host can do that.')
        if (meeting.ended && method !== 'GET') return fail(410, 'ended', 'This meeting has ended.')
        if (method === 'GET' && rest === 'waiting') {
            return ok([...meeting.participants.values()].filter((p) => p.state === 'waiting').map(({ id, name, since }) => ({ id, name, since })))
        }

        const waiting = /^waiting\/([^/]+)\/(admit|deny)$/.exec(rest)
        if (method === 'POST' && waiting) {
            const guest = meeting.participants.get(waiting[1])
            if (! guest) return fail(404, 'not_found', 'No such participant.')
            if (guest.state !== 'waiting') return fail(409, 'invalid', 'That guest is no longer waiting.')
            if (waiting[2] === 'admit') {
                if (this.admitted(meeting).length >= CAPACITY) return fail(409, 'full', 'The meeting is full.')
                guest.state = 'admitted'
                guest.seat = meeting.nextSeat++
            } else {
                guest.state = 'denied'
            }

            return ok({ participant: this.participant(guest) })
        }

        if (method === 'PATCH' && rest === '') {
            const { waitingRoom, locked, title } = req.body ?? {}
            if (typeof waitingRoom === 'boolean') meeting.waitingRoom = waitingRoom
            // Turning the waiting room off lets the waiting guests in, oldest first, while there is room.
            if (waitingRoom === false) {
                for (const guest of meeting.participants.values()) {
                    if (guest.state === 'waiting' && this.admitted(meeting).length < CAPACITY) {
                        guest.state = 'admitted'
                        guest.seat = meeting.nextSeat++
                    }
                }
            }
            if (typeof locked === 'boolean') meeting.locked = locked
            if (typeof title === 'string') meeting.title = title.trim() || null

            return ok({ meeting: this.present(meeting) })
        }

        if (method === 'POST' && rest === 'end') {
            meeting.ended = true

            return ok({ meeting: this.present(meeting) })
        }

        const remove = /^remove\/([^/]+)$/.exec(rest)
        if (method === 'POST' && remove) {
            const guest = meeting.participants.get(remove[1])
            if (! guest) return fail(404, 'not_found', 'That person is not in the meeting.')
            if (guest.role === 'host') return fail(422, 'invalid', 'The host cannot remove themselves.')
            guest.state = 'removed'
            guest.joined = false

            return ok({ participant: this.participant(guest) })
        }

        return fail(404, 'not_found', 'No such route.')
    }

    participant(p: MockParticipant) {
        return { id: p.id, name: p.name, role: p.role, state: p.state }
    }

    createMeeting(body: any): MockResponse {
        if (body.visibility !== 'public' && body.visibility !== 'private') return fail(422, 'invalid', 'Choose public or private.')
        if (body.visibility === 'private' && ! String(body.passcode ?? '').trim()) return fail(422, 'invalid', 'A private meeting needs a passcode.')
        if (body.scheduledAt && Number.isNaN(new Date(body.scheduledAt).getTime())) return fail(422, 'invalid', 'That date is not valid.')

        const meeting = this.create({
            title: String(body.title ?? '').trim() || null,
            hostName: String(body.hostName ?? '').trim() || null,
            visibility: body.visibility,
            passcode: body.visibility === 'private' ? String(body.passcode) : null,
            waitingRoom: Boolean(body.waitingRoom),
            scheduledAt: body.scheduledAt ?? null,
            durationMin: body.durationMin ?? null,
        })

        return ok({ meeting: this.present(meeting), hostKey: meeting.hostKey }, 201)
    }

    join(meeting: MockMeeting, body: any): MockResponse {
        const name = String(body.name ?? '').trim()
        if (! name) return fail(422, 'invalid', 'Tell us your name.')
        if (meeting.ended) return fail(410, 'ended', 'This meeting has ended.')

        if (body.hostKey && body.hostKey !== meeting.hostKey) return fail(403, 'forbidden', 'That host link is not for this meeting.')
        const isHost = Boolean(body.hostKey)
        if (! isHost) {
            if (meeting.visibility === 'private') {
                if (! body.passcode) return fail(401, 'passcode_required', 'This meeting needs a passcode.')
                if (String(body.passcode) !== meeting.passcode) return fail(401, 'passcode_wrong', 'That passcode is not right.')
            }
            if (this.status(meeting) === 'scheduled') return fail(409, 'not_started', 'This meeting has not started yet.')
            if (meeting.locked) return fail(423, 'locked', 'The host has locked this meeting.')
        }
        if (this.admitted(meeting).length >= CAPACITY) return fail(409, 'full', 'The meeting is full.')

        if (isHost) meeting.opened = true
        const waits = ! isHost && meeting.waitingRoom
        const participant = this.addParticipant(meeting, name.slice(0, 40), isHost ? 'host' : 'guest', waits ? 'waiting' : 'admitted')

        return ok({ token: this.token(meeting, participant), participant: this.participant(participant), meeting: this.present(meeting) }, 201)
    }

    calendar(meeting: MockMeeting): MockResponse {
        if (! meeting.scheduledAt) return fail(404, 'not_found', 'This meeting has no date.')
        const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
        const start = new Date(meeting.scheduledAt)
        const end = new Date(start.getTime() + (meeting.durationMin ?? 30) * 60_000)
        const text = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//meet-holler//mock//EN', 'BEGIN:VEVENT',
            `UID:${meeting.code}@meet-holler.mock`, `DTSTAMP:${stamp(new Date(this.now()))}`,
            `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
            `SUMMARY:${meeting.title ?? 'Meeting'}`, `URL:http://localhost:5173/m/${meeting.code}`,
            'END:VEVENT', 'END:VCALENDAR', '',
        ].join('\r\n')

        return {
            status: 200,
            text,
            headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${meeting.code}.ics"` },
        }
    }
}

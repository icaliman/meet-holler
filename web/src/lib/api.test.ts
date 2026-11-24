import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, createApi } from './api'
import { MockStore } from '../../dev/mock-store'
import { mockFetch } from '../../dev/mock-fetch'

describe('api client against the contract (dev mock)', () => {
    let store: MockStore
    let api: ReturnType<typeof createApi>

    beforeEach(() => {
        store = new MockStore()
        api = createApi({ fetch: mockFetch(store) })
    })

    it('creates a meeting and joins it as host', async () => {
        const { meeting, hostKey } = await api.createMeeting({ visibility: 'public', waitingRoom: true })
        expect(meeting.code).toMatch(/^[2-9a-z]{10}$/)
        expect(meeting.capacity).toBe(4)

        const joined = await api.join(meeting.code, { name: 'Ion', hostKey })
        expect(joined.participant).toMatchObject({ name: 'Ion', role: 'host', state: 'admitted' })
        expect(await api.me(meeting.code, joined.token)).toMatchObject({ role: 'host' })
    })

    it('runs the waiting room: a guest waits, the host admits', async () => {
        const { meeting, hostKey } = await api.createMeeting({ visibility: 'public', waitingRoom: true })
        const host = await api.join(meeting.code, { name: 'Ion', hostKey })
        const guest = await api.join(meeting.code, { name: 'Ana' })
        expect(guest.participant.state).toBe('waiting')

        const waiting = await api.waiting(meeting.code, host.token)
        expect(waiting.map((w) => w.name)).toEqual(['Ana'])
        await api.admit(meeting.code, waiting[0].id, host.token)
        expect((await api.me(meeting.code, guest.token)).state).toBe('admitted')
    })

    it('turns error bodies into ApiError with the code', async () => {
        await expect(api.getMeeting('nope222222')).rejects.toMatchObject({ code: 'not_found', status: 404 })
        await expect(api.join('xxxendeddd', { name: 'Ana' })).rejects.toMatchObject({ code: 'ended' })
        await expect(api.join('xxxfuuuuuu', { name: 'Ana' })).rejects.toMatchObject({ code: 'full' })
        await expect(api.join('xxxpassxxx', { name: 'Ana' })).rejects.toMatchObject({ code: 'passcode_required' })
        await expect(api.join('xxxpassxxx', { name: 'Ana', passcode: '9' })).rejects.toMatchObject({ code: 'passcode_wrong' })
        await expect(api.join('xxxxxckxxx', { name: 'Ana' })).rejects.toMatchObject({ code: 'locked' })
    })

    it('reports a request that never got an answer as network', async () => {
        const offline = createApi({ fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch })
        const error = await offline.getMeeting('abcdefghjk').catch((e) => e)
        expect(error).toBeInstanceOf(ApiError)
        expect(error.code).toBe('network')
    })

    it('sends the bearer token on host routes', async () => {
        const { meeting, hostKey } = await api.createMeeting({ visibility: 'public', waitingRoom: false })
        const host = await api.join(meeting.code, { name: 'Ion', hostKey })
        const guest = await api.join(meeting.code, { name: 'Ana' })

        await expect(api.update(meeting.code, { locked: true }, guest.token)).rejects.toMatchObject({ code: 'forbidden' })
        expect((await api.update(meeting.code, { locked: true }, host.token)).locked).toBe(true)
    })
})

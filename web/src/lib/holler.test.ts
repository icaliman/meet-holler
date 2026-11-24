import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpSignaling, RelaySignaling } from '@packstub/holler'
import { CHANNELS, clientFor, POLL, POLL_CONNECTED, relayedSignalingFor, relays, routes, signalingFor } from './holler'
import { createApi } from './api'
import { MockStore } from '../../dev/mock-store'
import { installHoller } from '../../dev/mock-holler'
import { mockFetch } from '../../dev/mock-fetch'

describe('Holler signaling for a meeting', () => {
    let store: MockStore
    let fetch: typeof globalThis.fetch
    let api: ReturnType<typeof createApi>

    beforeEach(() => {
        store = new MockStore()
        installHoller(store)
        fetch = mockFetch(store)
        api = createApi({ fetch })
    })

    async function meetingWithTwo() {
        const { meeting, hostKey } = await api.createMeeting({ visibility: 'public', waitingRoom: true })
        const host = await api.join(meeting.code, { name: 'Ion', hostKey })
        const guest = await api.join(meeting.code, { name: 'Ana' })

        return { code: meeting.code, host, guest }
    }

    it('points every route at the meeting', () => {
        expect(routes('abcdefghjk')).toMatchObject({
            poll: '/api/meetings/abcdefghjk/holler/poll',
            answer: '/api/meetings/abcdefghjk/holler/answer',
            signal: '/api/meetings/abcdefghjk/holler/signals',
            leave: '/api/meetings/abcdefghjk/holler/leave',
            ice: '/api/meetings/abcdefghjk/holler/ice',
        })
        expect(routes('abcdefghjk').invite).toBeUndefined()
    })

    it('sends the token, and hands the meeting from each poll to the room', async () => {
        const { code, host, guest } = await meetingWithTwo()
        const seen = vi.fn()
        const signaling = signalingFor(code, host.token, seen, fetch)

        const poll = await signaling.poll({ call: code, tab: 't1', claim: true })
        expect(poll.call).toMatchObject({ id: code, status: 'ringing', joined: false, role: 'caller' })
        await vi.waitFor(() => expect(seen).toHaveBeenCalled())
        expect(seen.mock.calls[0][0]).toMatchObject({ waitingRoom: true, waiting: [{ id: guest.participant.id, name: 'Ana' }] })
    })

    it('keeps a lone participant ringing, and goes active with two', async () => {
        const { code, host, guest } = await meetingWithTwo()
        await api.admit(code, guest.participant.id, host.token)
        const a = signalingFor(code, host.token, undefined, fetch)
        const b = signalingFor(code, guest.token, undefined, fetch)

        expect((await a.answer(code, 'ta')).status).toBe('ringing')
        const call = await b.answer(code, 'tb')
        expect(call.status).toBe('active')
        expect(call.peers).toEqual([expect.objectContaining({ name: 'Ion', status: 'joined', seat: 0 })])
    })

    it('delivers a signal only to the tab that holds the side', async () => {
        const { code, host, guest } = await meetingWithTwo()
        await api.admit(code, guest.participant.id, host.token)
        const a = signalingFor(code, host.token, undefined, fetch)
        const b = signalingFor(code, guest.token, undefined, fetch)
        await a.answer(code, 'ta')
        await b.answer(code, 'tb')

        await a.send(code, 'offer', { sdp: 'x' }, guest.participant.id)
        expect((await b.poll({ call: code, tab: 'other', claim: false })).signals).toEqual([])
        const got = await b.poll({ call: code, tab: 'tb', claim: true })
        expect(got.signals).toEqual([expect.objectContaining({ type: 'offer', from: host.participant.id })])
    })

    it('tells a removed guest why the call ended', async () => {
        const { code, host, guest } = await meetingWithTwo()
        await api.admit(code, guest.participant.id, host.token)
        const b = signalingFor(code, guest.token, undefined, fetch)
        await b.answer(code, 'tb')
        await api.remove(code, guest.participant.id, host.token)

        expect((await b.poll({ call: code, tab: 'tb' })).call).toMatchObject({ status: 'ended', end_reason: 'removed' })
    })

    it('refuses the signaling routes to a guest still in the waiting room', async () => {
        const { code, guest } = await meetingWithTwo()
        const b = signalingFor(code, guest.token, undefined, fetch)
        await expect(b.answer(code, 'tb')).rejects.toMatchObject({ status: 403 })
    })

    describe('relaying through the host', () => {
        const inner = (client: unknown) => client as { signaling: unknown, channelLabels: string[], pollIntervals: { active: number } }

        beforeEach(() => localStorage.clear())

        it('is on only for a meeting that says so, and off for a browser that switched it off', () => {
            expect(relays({ relay: 'host' })).toBe(true)
            expect(relays({ relay: null })).toBe(false)
            expect(relays({})).toBe(false)
            expect(relays(null)).toBe(false)

            localStorage.setItem('meet:relay', 'off')
            expect(relays({ relay: 'host' })).toBe(false)
        })

        it('leaves the client as it was without it: HttpSignaling, the app\'s channels, the old poll pace', async () => {
            const { code, host } = await meetingWithTwo()
            const client = clientFor({ code, token: host.token, fetch })

            expect(inner(client).signaling).toBeInstanceOf(HttpSignaling)
            expect(inner(client).channelLabels).toEqual(CHANNELS)
            client.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'active' } }))
            expect(inner(client).pollIntervals.active).toBe(POLL_CONNECTED)
            client.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'connecting' } }))
            expect(inner(client).pollIntervals.active).toBe(POLL.active)
            client.destroy()
        })

        it('wraps the signaling and adds its channel after the app\'s own', async () => {
            const { code, host } = await meetingWithTwo()
            const modes: string[] = []
            const client = clientFor({ code, token: host.token, fetch, relay: true, onRelayMode: (mode) => modes.push(mode) })

            expect(inner(client).signaling).toBeInstanceOf(RelaySignaling)
            expect(inner(client).channelLabels).toEqual([...CHANNELS, 'holler:relay'])
            // Not in a call: fast, like every tab that is connecting.
            client.dispatchEvent(new CustomEvent('peers', { detail: { peers: [] } }))
            expect(inner(client).pollIntervals.active).toBe(POLL.active)
            client.destroy()
        })

        it('works against a server that does not relay: it polls, and the room still gets the meeting', async () => {
            const { code, host } = await meetingWithTwo()
            const seen = vi.fn()
            const { relay } = relayedSignalingFor(code, host.token, seen, fetch)

            const poll = await relay.poll({ call: code, tab: 't1', claim: true })
            expect(poll.call).toMatchObject({ id: code, status: 'ringing' })
            expect(relay.mode).toBe('polling')
            await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1))
        })
    })
})

import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { iceServers, TURN_TTL_SECONDS } from '../worker/holler/ice'
import { api, createMeeting, joined } from './helpers'

const poll = (code: string, token: string, tab = 't') => api('GET', `/api/meetings/${code}/holler/poll?call=${code}&tab=${tab}&claim=1`, { token })
const answer = (code: string, token: string, tab = 't') => api('POST', `/api/meetings/${code}/holler/answer`, { token, body: { tab } })

describe('people who are out of the meeting', () => {
    async function three() {
        const { code, hostKey } = await createMeeting()
        const ion = await joined(code, { hostKey, name: 'Ion' })
        const ana = await joined(code, { name: 'Ana' })
        const mihai = await joined(code, { name: 'Mihai' })
        for (const person of [ion, ana, mihai]) await answer(code, person.token, `tab-${person.participant.id}`)

        return { code, hostKey, ion, ana, mihai }
    }

    it('are told they were removed, and nothing about who is still there', async () => {
        const { code, hostKey, ana } = await three()
        await api('POST', `/api/meetings/${code}/remove/${ana.participant.id}`, { hostKey })

        const view = await poll(code, ana.token, `tab-${ana.participant.id}`)
        expect(view.body.call).toMatchObject({ status: 'ended', end_reason: 'removed', peers: [], peer: null })
        expect(view.body.signals).toEqual([])
        expect(JSON.stringify(view.body)).not.toContain('Mihai')
    })

    it('get no ICE servers once they left, were removed, or the meeting ended', async () => {
        const { code, hostKey, ion, ana, mihai } = await three()
        expect((await api('GET', `/api/meetings/${code}/holler/ice`, { token: ana.token })).status).toBe(200)

        await api('POST', `/api/meetings/${code}/holler/hangup`, { token: ana.token })
        const left = await api('GET', `/api/meetings/${code}/holler/ice`, { token: ana.token })
        expect(left.status).toBe(403)
        expect(left.body.iceServers).toBeUndefined()

        await api('POST', `/api/meetings/${code}/remove/${mihai.participant.id}`, { hostKey })
        expect((await api('GET', `/api/meetings/${code}/holler/ice`, { token: mihai.token })).status).toBe(403)

        await api('POST', `/api/meetings/${code}/end`, { hostKey })
        expect((await api('GET', `/api/meetings/${code}/holler/ice`, { token: ion.token })).status).toBe(410)
    })

    it('cannot poll, signal or ask for ICE servers from the waiting room, or after being denied', async () => {
        const { code, hostKey } = await createMeeting({ waitingRoom: true })
        const host = await joined(code, { hostKey, name: 'Ion' })
        await answer(code, host.token)
        const guest = await joined(code, { name: 'Ana' })

        for (const state of ['waiting', 'denied']) {
            if (state === 'denied') await api('POST', `/api/meetings/${code}/waiting/${guest.participant.id}/deny`, { token: host.token })
            expect((await poll(code, guest.token)).status, state).toBe(403)
            expect((await answer(code, guest.token)).status, state).toBe(403)
            expect((await api('POST', `/api/meetings/${code}/holler/signals`, { token: guest.token, body: { type: 'offer', payload: {} } })).status, state).toBe(403)
            expect((await api('GET', `/api/meetings/${code}/holler/ice`, { token: guest.token })).status, state).toBe(403)
            expect((await api('GET', `/api/meetings/${code}/waiting`, { token: guest.token })).status, state).toBe(403)
            expect((await api('POST', `/api/meetings/${code}/remove/${host.participant.id}`, { token: guest.token })).status, state).toBe(403)
        }
    })
})

describe('TURN credentials', () => {
    it('are asked for a few hours, not a day', async () => {
        const fetcher = vi.fn(async () => Response.json({ iceServers: [] }))
        await iceServers({ ...env, TURN_KEY_ID: 'key', TURN_KEY_API_TOKEN: 'token' }, fetcher as unknown as typeof fetch)

        const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body)
        expect(body.ttl).toBe(TURN_TTL_SECONDS)
        expect(TURN_TTL_SECONDS).toBeLessThanOrEqual(6 * 60 * 60)
    })
})

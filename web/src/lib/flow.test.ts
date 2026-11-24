import { describe, expect, it } from 'vitest'
import { afterCall, next, rejoinBudget, type Phase } from './flow'

const lobby: Phase = { name: 'lobby' }

describe('meeting flow', () => {
    it('goes from the lobby into the room', () => {
        const joining = next(lobby, { type: 'join' })
        expect(joining).toEqual({ name: 'joining' })
        expect(next(joining, { type: 'joined', state: 'admitted' })).toEqual({ name: 'room' })
    })

    it('waits in the waiting room until admitted or denied', () => {
        const waiting = next({ name: 'joining' }, { type: 'joined', state: 'waiting' })
        expect(waiting).toEqual({ name: 'waiting' })
        expect(next(waiting, { type: 'me', state: 'waiting' })).toEqual({ name: 'waiting' })
        expect(next(waiting, { type: 'me', state: 'admitted' })).toEqual({ name: 'room' })
        expect(next(waiting, { type: 'me', state: 'denied' })).toEqual({ name: 'denied' })
    })

    it('goes back to the lobby with the reason when joining fails', () => {
        expect(next({ name: 'joining' }, { type: 'join_failed', code: 'passcode_wrong' })).toEqual({ name: 'lobby', error: 'passcode_wrong' })
        expect(next({ name: 'joining' }, { type: 'join_failed', code: 'full' })).toEqual({ name: 'lobby', error: 'full' })
        expect(next({ name: 'joining' }, { type: 'join_failed', code: 'ended' })).toEqual({ name: 'ended' })
    })

    it('leaves on request, and ignores the call ending after that', () => {
        const left = next({ name: 'room' }, { type: 'leave' })
        expect(left).toEqual({ name: 'left' })
        expect(next(left, { type: 'call_ended', reason: 'hung_up', canRejoin: false })).toEqual(left)
        expect(next(left, { type: 'meeting_ended' })).toEqual(left)
    })

    it('tells the host ending, a removal and a lost connection apart', () => {
        expect(next({ name: 'room' }, { type: 'call_ended', reason: 'ended', canRejoin: false })).toEqual({ name: 'ended' })
        expect(next({ name: 'room' }, { type: 'call_ended', reason: 'removed', canRejoin: false })).toEqual({ name: 'removed' })
        expect(next({ name: 'room' }, { type: 'call_ended', reason: 'dropped', canRejoin: false })).toEqual({ name: 'dropped' })
        expect(next({ name: 'room' }, { type: 'call_ended', reason: 'failed', canRejoin: false })).toEqual({ name: 'failed' })
    })

    it('rejoins quietly when Holler dropped the call while the meeting is open', () => {
        expect(afterCall('dropped', true)).toEqual({ name: 'joining' })
        expect(afterCall('failed', true)).toEqual({ name: 'joining' })
        expect(afterCall('ended', true)).toEqual({ name: 'ended' })
        expect(afterCall('removed', true)).toEqual({ name: 'removed' })
    })

    it('stops rejoining after a few tries in a short time', () => {
        let t = 0
        const allow = rejoinBudget(2, 1000, () => t)
        expect(allow()).toBe(true)
        expect(allow()).toBe(true)
        expect(allow()).toBe(false)
        t = 1500
        expect(allow()).toBe(true)
    })

    it('can rejoin after a drop or after leaving', () => {
        expect(next({ name: 'dropped' }, { type: 'join' })).toEqual({ name: 'joining' })
        expect(next({ name: 'left' }, { type: 'join' })).toEqual({ name: 'joining' })
    })
})

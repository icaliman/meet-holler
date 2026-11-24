// Where someone is in a meeting, from the lobby to the room and out again: a small state
// machine, kept pure so every path is tested.

import type { ErrorCode, ParticipantState } from './types'

export type Phase =
    | { name: 'lobby', error?: ErrorCode | null }
    | { name: 'joining' }
    | { name: 'waiting' }
    | { name: 'room' }
    | { name: 'denied' }
    | { name: 'removed' }
    | { name: 'left' }
    | { name: 'ended' }
    | { name: 'failed' }
    | { name: 'dropped' }

export type FlowEvent =
    | { type: 'join' }
    | { type: 'joined', state: ParticipantState }
    | { type: 'join_failed', code: ErrorCode }
    | { type: 'me', state: ParticipantState }
    | { type: 'leave' }
    | { type: 'call_ended', reason: string, canRejoin: boolean }
    | { type: 'meeting_ended' }
    | { type: 'rejoin' }

export function next(phase: Phase, event: FlowEvent): Phase {
    switch (event.type) {
        case 'join':
            return phase.name === 'lobby' || phase.name === 'dropped' || phase.name === 'left' ? { name: 'joining' } : phase

        case 'joined':
        case 'me':
            if (phase.name !== 'joining' && phase.name !== 'waiting' && phase.name !== 'room') return phase
            if (event.state === 'admitted') return { name: 'room' }
            if (event.state === 'waiting') return { name: 'waiting' }
            if (event.state === 'denied') return { name: 'denied' }
            if (event.state === 'removed') return { name: 'removed' }

            return { name: 'left' }

        case 'join_failed':
            if (phase.name !== 'joining') return phase
            if (event.code === 'ended') return { name: 'ended' }

            // Back to the lobby, which says what went wrong and what to do (a passcode, wait, try again).
            return { name: 'lobby', error: event.code }

        case 'leave':
            return phase.name === 'room' || phase.name === 'waiting' || phase.name === 'joining' ? { name: 'left' } : phase

        case 'meeting_ended':
            return phase.name === 'left' ? phase : { name: 'ended' }

        case 'call_ended':
            if (phase.name !== 'room') return phase

            return afterCall(event.reason, event.canRejoin)

        case 'rejoin':
            return { name: 'joining' }
    }
}

/**
 * What the end of the call means for this person, when they did not press Leave.
 * Holler 1.0 can hang up with `dropped` (or `failed`) on someone left alone in a meeting
 * that is still open (docs/api.md, "Holler and a lone participant"), so those rejoin
 * quietly; `canRejoin` is false once that has happened too often to be that bug.
 */
export function afterCall(reason: string, canRejoin: boolean): Phase {
    switch (reason) {
        case 'ended':
        case 'expired':
            return { name: 'ended' }
        case 'removed':
            return { name: 'removed' }
        case 'failed':
            return canRejoin ? { name: 'joining' } : { name: 'failed' }
        default:
            return canRejoin ? { name: 'joining' } : { name: 'dropped' }
    }
}

/** Allows a few quiet rejoins, not a loop: at most `max` within `windowMs`. */
export function rejoinBudget(max = 2, windowMs = 120_000, now: () => number = Date.now) {
    const times: number[] = []

    return () => {
        const t = now()
        while (times.length && t - times[0] > windowMs) times.shift()
        if (times.length >= max) return false
        times.push(t)

        return true
    }
}

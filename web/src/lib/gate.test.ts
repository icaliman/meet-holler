import { describe, expect, it } from 'vitest'
import { gate } from './gate'
import type { Meeting } from './types'

const open: Meeting = {
    code: 'abcdefghjk',
    title: null,
    visibility: 'public',
    requiresPasscode: false,
    waitingRoom: false,
    scheduledAt: null,
    durationMin: null,
    status: 'open',
    locked: false,
    participantCount: 1,
    capacity: 4,
}

describe('gate', () => {
    it('lets people into an open meeting', () => {
        expect(gate(open, false)).toBe('lobby')
    })

    it('shows the ending, the countdown, the full and the locked states', () => {
        expect(gate({ ...open, status: 'ended' }, true)).toBe('ended')
        expect(gate({ ...open, status: 'scheduled' }, false)).toBe('early')
        expect(gate({ ...open, participantCount: 4 }, false)).toBe('full')
        expect(gate({ ...open, locked: true }, false)).toBe('locked')
    })

    it('lets the host open early and past the lock', () => {
        expect(gate({ ...open, status: 'scheduled' }, true)).toBe('lobby')
        expect(gate({ ...open, locked: true }, true)).toBe('lobby')
    })

    it('keeps even the host out of a full meeting', () => {
        expect(gate({ ...open, participantCount: 4 }, true)).toBe('full')
    })
})

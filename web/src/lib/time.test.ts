import { describe, expect, it } from 'vitest'
import { fromInputs, inWords, nextSlot, remaining } from './time'

describe('time', () => {
    const now = new Date(2026, 10, 24, 10, 0, 0)

    it('breaks the time left into parts', () => {
        const r = remaining(new Date(2026, 10, 25, 12, 3, 4), now)
        expect([r.days, r.hours, r.minutes, r.seconds]).toEqual([1, 2, 3, 4])
        expect(remaining(new Date(2020, 0, 1), now).total).toBe(0)
    })

    it('says it in words', () => {
        expect(inWords(remaining(new Date(2026, 10, 24, 10, 12, 0), now))).toBe('12 minutes')
        expect(inWords(remaining(new Date(2026, 10, 24, 10, 11, 30), now))).toBe('12 minutes')
        expect(inWords(remaining(new Date(2026, 10, 24, 10, 1, 0), now))).toBe('1 minute')
        expect(inWords(remaining(new Date(2026, 10, 24, 10, 0, 20), now))).toBe('less than a minute')
        expect(inWords(remaining(new Date(2026, 10, 24, 13, 5, 0), now))).toBe('3 hours and 5 minutes')
        expect(inWords(remaining(new Date(2026, 10, 25, 12, 0, 0), now))).toBe('1 day and 2 hours')
        expect(inWords(remaining(new Date(2026, 11, 4, 10, 0, 0), now))).toBe('10 days')
    })

    it('reads the date and time inputs', () => {
        expect(fromInputs('2026-11-25', '14:30')?.getTime()).toBe(new Date(2026, 10, 25, 14, 30).getTime())
        expect(fromInputs('', '14:30')).toBeNull()
        expect(fromInputs('2026-11-25', '')).toBeNull()
    })

    it('suggests the next half hour, at least 15 minutes away', () => {
        expect(nextSlot(new Date(2026, 10, 24, 10, 5)).getTime()).toBe(new Date(2026, 10, 24, 10, 30).getTime())
        expect(nextSlot(new Date(2026, 10, 24, 10, 20)).getTime()).toBe(new Date(2026, 10, 24, 11, 0).getTime())
        expect(nextSlot(new Date(2026, 10, 24, 10, 50)).getTime()).toBe(new Date(2026, 10, 24, 11, 30).getTime())
    })
})

import { describe, expect, it } from 'vitest'
import { initials, layout, seatColour } from './layout'
import { HANG_MS, rms, silent, step } from './levels'

describe('stage layout', () => {
    it('puts you next to an empty seat with the invite when alone', () => {
        expect(layout(1, 16 / 9)).toEqual({ mode: 'grid', cols: 2, rows: 1, emptySeats: 1 })
        expect(layout(1, 9 / 16)).toEqual({ mode: 'grid', cols: 1, rows: 2, emptySeats: 1 })
    })

    it('places two side by side on wide screens and stacked on tall ones', () => {
        expect(layout(2, 1.6)).toMatchObject({ cols: 2, rows: 1 })
        expect(layout(2, 0.6)).toMatchObject({ cols: 1, rows: 2 })
    })

    it('uses the 2x2 room for three and four, keeping the free seat in view', () => {
        expect(layout(3, 1.6)).toEqual({ mode: 'grid', cols: 2, rows: 2, emptySeats: 1 })
        expect(layout(4, 0.6)).toEqual({ mode: 'grid', cols: 2, rows: 2, emptySeats: 0 })
    })

    it('gives the stage to a shared screen', () => {
        expect(layout(3, 1.6, true).mode).toBe('spotlight')
    })
})

describe('names and seats', () => {
    it('makes initials', () => {
        expect(initials('Ana Pop')).toBe('AP')
        expect(initials('mihai')).toBe('M')
        expect(initials('Ion  Maria  Căliman')).toBe('IC')
        expect(initials('  ')).toBe('?')
    })

    it('cycles seat colours as seats keep counting', () => {
        expect([0, 1, 2, 3, 4, 7].map(seatColour)).toEqual([0, 1, 2, 3, 0, 3])
    })
})

describe('speaking detection', () => {
    it('measures a silent buffer as zero and a loud one as more', () => {
        expect(rms(new Uint8Array(64).fill(128))).toBe(0)
        expect(rms(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 160 : 96)))).toBeGreaterThan(0.5)
    })

    it('turns the ring on with the voice and keeps it through a short pause', () => {
        let voice = silent
        voice = step(voice, 0.4, 100)
        voice = step(voice, 0.4, 100)
        expect(voice.speaking).toBe(true)

        for (let i = 0; i < 3; i++) voice = step(voice, 0, 100)
        expect(voice.speaking).toBe(true)

        for (let i = 0; i < Math.ceil(HANG_MS / 100) + 4; i++) voice = step(voice, 0, 100)
        expect(voice.speaking).toBe(false)
    })

    it('ignores background noise', () => {
        let voice = silent
        for (let i = 0; i < 20; i++) voice = step(voice, 0.03, 100)
        expect(voice.speaking).toBe(false)
    })
})

import { describe, expect, it } from 'vitest'
import { arrowPath, contentRect, FADE, flat, fromNormal, markOpacity, pointerOpacity, simplify, smoothPath, strokeWidth, thin, toNormal, unflat } from './geometry'

describe('where the picture sits in its tile', () => {
    it('letterboxes a wide screen in a tall tile (bars above and below)', () => {
        expect(contentRect({ w: 400, h: 600 }, { w: 1600, h: 900 })).toEqual({ x: 0, y: 187.5, w: 400, h: 225 })
    })

    it('pillarboxes a tall picture in a wide tile (bars left and right)', () => {
        expect(contentRect({ w: 1000, h: 500 }, { w: 800, h: 1000 })).toEqual({ x: 300, y: 0, w: 400, h: 500 })
    })

    it('fills the box exactly when the shapes match', () => {
        expect(contentRect({ w: 1280, h: 720 }, { w: 1920, h: 1080 })).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
    })

    it('crops with cover', () => {
        expect(contentRect({ w: 400, h: 400 }, { w: 800, h: 400 }, 'cover')).toEqual({ x: -200, y: 0, w: 800, h: 400 })
    })

    it('falls back to the whole box while the picture size is unknown', () => {
        expect(contentRect({ w: 300, h: 200 }, null)).toEqual({ x: 0, y: 0, w: 300, h: 200 })
        expect(contentRect({ w: 300, h: 200 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 300, h: 200 })
    })
})

describe('picture coordinates', () => {
    const rect = contentRect({ w: 400, h: 600 }, { w: 1600, h: 900 })

    it('maps a click on the picture to 0..1 and back', () => {
        const p = toNormal(100, 187.5 + 225 / 2, rect)!
        expect(p).toEqual({ x: 0.25, y: 0.5 })
        expect(fromNormal(p, rect)).toEqual({ x: 100, y: 300 })
    })

    it('says nothing for a click on the letterbox bars, or clamps it when asked', () => {
        expect(toNormal(100, 50, rect)).toBeNull()
        expect(toNormal(100, 50, rect, true)).toEqual({ x: 0.25, y: 0 })
    })

    it('puts a mark on the same spot of the picture in any window', () => {
        // The sharer's 1600x900 screen, seen in a wide desktop tile and a phone's tall one.
        const desktop = contentRect({ w: 1200, h: 800 }, { w: 1600, h: 900 })
        const phone = contentRect({ w: 358, h: 420 }, { w: 1600, h: 900 })
        const spot = toNormal(desktop.x + 0.7 * desktop.w, desktop.y + 0.2 * desktop.h, desktop)!
        const there = fromNormal(spot, phone)
        expect((there.x - phone.x) / phone.w).toBeCloseTo(0.7)
        expect((there.y - phone.y) / phone.h).toBeCloseTo(0.2)
    })

    it('has nothing to map onto in an empty box', () => {
        expect(toNormal(1, 1, { x: 0, y: 0, w: 0, h: 0 })).toBeNull()
    })

    it('flattens points for the wire and back', () => {
        const points = [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]
        expect(flat(points)).toEqual([0.1, 0.2, 0.3, 0.4])
        expect(unflat([0.1, 0.2, 0.3, 0.4, 0.5])).toEqual(points)
    })
})

describe('fewer points for the same line', () => {
    it('thins out points closer than the step, against the last one sent', () => {
        const points = [{ x: 0, y: 0 }, { x: 0.0005, y: 0 }, { x: 0.01, y: 0 }, { x: 0.0101, y: 0 }]
        expect(thin(points, 0.002)).toEqual([{ x: 0, y: 0 }, { x: 0.01, y: 0 }])
        expect(thin(points, 0.002, { x: 0, y: 0 })).toEqual([{ x: 0.01, y: 0 }])
    })

    it('keeps the corners of a line and drops what lies on it', () => {
        const line = Array.from({ length: 11 }, (_, i) => ({ x: i / 10, y: 0 }))
        const corner = [...line, { x: 1, y: 0.5 }, { x: 1, y: 1 }]
        expect(simplify(line, 0.001)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }])
        expect(simplify(corner, 0.001)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])
    })

    it('stays within the tolerance of a wobbly line', () => {
        const wobble = Array.from({ length: 200 }, (_, i) => ({ x: i / 200, y: 0.5 + Math.sin(i / 7) * 0.05 }))
        const simple = simplify(wobble, 0.002)
        expect(simple.length).toBeLessThan(wobble.length / 2)
        expect(simple[0]).toEqual(wobble[0])
        expect(simple[simple.length - 1]).toEqual(wobble[wobble.length - 1])
    })

    it('handles a very long stroke without recursion', () => {
        const long = Array.from({ length: 50_000 }, (_, i) => ({ x: i / 50_000, y: 0.5 + Math.sin(i / 300) * 0.2 }))
        expect(simplify(long, 0.001).length).toBeGreaterThan(2)
    })

    it('leaves short strokes alone', () => {
        expect(simplify([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.1)).toHaveLength(2)
    })
})

describe('drawing the marks', () => {
    it('draws a dot, a line and a smoothed curve', () => {
        expect(smoothPath([])).toBe('')
        expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1 2l0 0')
        expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M0 0L10 10')
        expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe('M0 0Q10 0 10 5L10 10')
    })

    it('points an arrow head at the tip', () => {
        const { shaft, head } = arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 20)
        expect(head.startsWith('M100 0')).toBe(true)
        expect(shaft).toBe('M0 0L86 0')
    })

    it('keeps the head inside a very short arrow', () => {
        const { head } = arrowPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 20)
        const xs = [...head.matchAll(/[ML](-?[\d.]+) /g)].map((m) => Number(m[1]))
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    })

    it('scales the pen with the picture, with a floor', () => {
        expect(strokeWidth('pen', 1000)).toBe(4)
        expect(strokeWidth('pen', 100)).toBe(2.5)
        expect(strokeWidth('marker', 1000)).toBeGreaterThan(strokeWidth('pen', 1000) * 4)
    })
})

describe('fading', () => {
    it('keeps a pointer while it moves, then fades it', () => {
        expect(pointerOpacity(0)).toBe(1)
        expect(pointerOpacity(FADE.pointerHold)).toBe(1)
        expect(pointerOpacity(FADE.pointerHold + FADE.pointerFade / 2)).toBeCloseTo(0.5)
        expect(pointerOpacity(FADE.pointerHold + FADE.pointerFade)).toBe(0)
    })

    it('keeps a mark while it is drawn and a few seconds after', () => {
        expect(markOpacity(null)).toBe(1)
        expect(markOpacity(FADE.markHold)).toBe(1)
        expect(markOpacity(FADE.markHold + FADE.markFade)).toBe(0)
    })

    it('uses a short cross-fade with reduced motion', () => {
        expect(markOpacity(FADE.markHold + FADE.reduced, true)).toBe(0)
        expect(pointerOpacity(FADE.pointerHold + FADE.reduced, true)).toBe(0)
    })
})

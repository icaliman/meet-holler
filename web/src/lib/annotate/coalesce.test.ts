import { describe, expect, it } from 'vitest'
import { Coalescer } from './coalesce'

/** A hand-cranked clock and frame queue. */
function frames() {
    let time = 0
    let queue: (() => void)[] = []

    return {
        now: () => time,
        schedule: (run: () => void) => {
            queue.push(run)

            return () => { queue = queue.filter((r) => r !== run) }
        },
        /** One animation frame `ms` later. */
        frame(ms = 16) {
            time += ms
            const due = queue
            queue = []
            for (const run of due) run()
        },
        get waiting() { return queue.length },
    }
}

describe('coalescing pointer moves', () => {
    it('sends only the latest value of a frame', () => {
        const f = frames()
        const sent: number[] = []
        const c = new Coalescer<number>((v) => sent.push(v), { interval: 0, now: f.now, schedule: f.schedule })
        c.push(1)
        c.push(2)
        c.push(3)
        expect(sent).toEqual([])
        f.frame()
        expect(sent).toEqual([3])
    })

    it('never sends faster than the interval, however fast the frames', () => {
        const f = frames()
        const sent: number[] = []
        const c = new Coalescer<number>((v) => sent.push(v), { interval: 33, now: f.now, schedule: f.schedule })
        // 120 Hz input for one second: about 30 messages, never more.
        for (let i = 0; i < 120; i++) {
            c.push(i)
            f.frame(1000 / 120)
        }
        expect(sent.length).toBeLessThanOrEqual(31)
        expect(sent.length).toBeGreaterThanOrEqual(25)
        expect(sent[sent.length - 1]).toBeGreaterThan(110)
    })

    it('merges batches when told how', () => {
        const f = frames()
        const sent: number[][] = []
        const c = new Coalescer<number[]>((v) => sent.push(v), { interval: 0, now: f.now, schedule: f.schedule, merge: (a, b) => [...a, ...b] })
        c.push([1])
        c.push([2, 3])
        f.frame()
        expect(sent).toEqual([[1, 2, 3]])
    })

    it('flushes at once on demand, and drops on demand', () => {
        const f = frames()
        const sent: number[] = []
        const c = new Coalescer<number>((v) => sent.push(v), { now: f.now, schedule: f.schedule })
        c.push(1)
        c.flush()
        expect(sent).toEqual([1])
        expect(f.waiting).toBe(0)
        c.push(2)
        expect(c.pending).toBe(true)
        c.drop()
        f.frame(100)
        expect(sent).toEqual([1])
        expect(c.pending).toBe(false)
    })
})

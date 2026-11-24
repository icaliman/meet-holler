import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Annotations, MAX_MARKS_PER_PERSON, type Who } from './annotations.svelte'
import { FADE } from './geometry'
import { encode, MAX_STROKE_POINTS, type Message } from './protocol'
import type { Wire, WireHandlers } from './wire'

const PEOPLE = [
    { id: 'ion', name: 'Ion', seat: 0 },
    { id: 'ana', name: 'Ana Pop', seat: 1 },
    { id: 'mihai', name: 'Mihai', seat: 2 },
]

/**
 * Three people whose wires deliver to each other at once, a frame queue for the outgoing
 * messages, and every message on the wire in `log`.
 */
function meeting({ sharer = 'ana', host = 'ion' } = {}) {
    const handlers = new Map<string, WireHandlers>()
    const log: { from: string, to: string, message: Message }[] = []
    let queue: (() => void)[] = []
    const said: string[] = []
    const timing = {
        interval: 0,
        now: () => Date.now(),
        schedule: (run: () => void) => {
            queue.push(run)

            return () => { queue = queue.filter((r) => r !== run) }
        },
    }
    const wireFor = (me: string): Wire => ({
        send(data, to) {
            for (const id of to) {
                log.push({ from: me, to: id, message: JSON.parse(data) })
                handlers.get(id)?.message(me, data)
            }
        },
        listen(h) {
            handlers.set(me, h)

            return () => handlers.delete(me)
        },
    })
    const roster = (me: string, sharing: string | null): Who[] => PEOPLE.map((p) => ({ ...p, me: p.id === me, sharing: p.id === sharing }))
    const make = (id: string) => {
        const a = new Annotations({ wire: wireFor(id), me: { id, isHost: id === host }, timing, announce: (text) => said.push(`${id}: ${text}`), reducedMotion: () => false })
        a.rosterChanged(roster(id, null))

        return a
    }
    const all = { ion: make('ion'), ana: make('ana'), mihai: make('mihai') }
    const share = (who: string | null) => {
        for (const [id, a] of Object.entries(all)) a.rosterChanged(roster(id, who))
    }
    share(sharer)

    return {
        ...all,
        log,
        said,
        /** Runs one animation frame of outgoing messages. */
        frame() {
            vi.advanceTimersByTime(16)
            const due = queue
            queue = []
            for (const run of due) run()
        },
        share,
        roster,
        /** A message as if it came from `from` over their channel. */
        forge(to: Annotations, from: string, message: object | string) {
            to.receive(from, typeof message === 'string' ? message : JSON.stringify(message))
        },
        destroy() {
            for (const a of Object.values(all)) a.destroy()
        },
    }
}

describe('the pointer on a shared screen', () => {
    let m: ReturnType<typeof meeting>

    beforeEach(() => {
        vi.useFakeTimers()
        m = meeting()
    })

    afterEach(() => {
        m.destroy()
        vi.useRealTimers()
    })

    it('shows a viewer\'s pointer to everyone, named and coloured from the roster', () => {
        m.mihai.setTool('pointer')
        m.mihai.point({ x: 0.2, y: 0.3 })
        m.mihai.point({ x: 0.4, y: 0.5 })
        expect(m.mihai.pointers).toMatchObject([{ id: 'mihai', me: true, x: 0.4, y: 0.5 }])
        expect(m.ana.pointers).toEqual([])

        m.frame()
        for (const other of [m.ana, m.ion]) {
            expect(other.pointers).toMatchObject([{ id: 'mihai', name: 'Mihai', seat: 2, me: false, x: 0.4, y: 0.5 }])
        }
        // Two moves in one frame made one message to each of the two others.
        expect(m.log.filter((l) => l.message.t === 'ptr')).toHaveLength(2)
    })

    it('says who is pointing, once in a while, not on every move', () => {
        m.mihai.setTool('pointer')
        for (let i = 0; i < 10; i++) {
            m.mihai.point({ x: i / 10, y: 0.5 })
            m.frame()
        }
        expect(m.said.filter((s) => s === 'ana: Mihai is pointing.')).toHaveLength(1)
    })

    it('takes the pointer away when it leaves the screen, and fades it when it rests', () => {
        m.mihai.setTool('pointer')
        m.mihai.point({ x: 0.5, y: 0.5 })
        m.frame()
        m.mihai.point(null)
        expect(m.ana.pointers).toEqual([])

        m.mihai.point({ x: 0.5, y: 0.5 })
        m.frame()
        expect(m.ana.pointers).toHaveLength(1)
        vi.advanceTimersByTime(FADE.pointerHold + FADE.pointerFade + 200)
        expect(m.ana.pointers).toEqual([])
    })

    it('does nothing with no tool, or with a drawing tool', () => {
        m.mihai.point({ x: 0.5, y: 0.5 })
        m.mihai.setTool('pen')
        m.mihai.point({ x: 0.5, y: 0.5 })
        m.frame()
        expect(m.log.filter((l) => l.message.t === 'ptr')).toHaveLength(0)
    })

    it('lets the sharer point at their own screen', () => {
        m.ana.setTool('pointer')
        m.ana.point({ x: 0.9, y: 0.1 })
        m.frame()
        expect(m.ion.pointers).toMatchObject([{ id: 'ana', name: 'Ana Pop' }])
    })

    it('offers no tools while nobody shares', () => {
        m.share(null)
        m.mihai.setTool('pointer')
        expect(m.mihai.tool).toBeNull()
        expect(m.mihai.canAnnotate).toBe(false)
    })
})

describe('drawing on a shared screen', () => {
    let m: ReturnType<typeof meeting>

    beforeEach(() => {
        vi.useFakeTimers()
        m = meeting()
    })

    afterEach(() => {
        m.destroy()
        vi.useRealTimers()
    })

    it('sends a pen line as it is drawn, and everyone ends up with the same line', () => {
        m.ion.setTool('pen')
        m.ion.begin({ x: 0.1, y: 0.1 })
        m.ion.extend([{ x: 0.2, y: 0.15 }, { x: 0.3, y: 0.3 }])
        m.frame()
        m.ion.extend([{ x: 0.4, y: 0.2 }])
        m.frame()
        m.ion.end()

        const mine = m.ion.marks[0]
        expect(mine).toMatchObject({ from: 'ion', tool: 'pen', seat: 0 })
        expect(mine.doneAt).not.toBeNull()
        for (const other of [m.ana, m.mihai]) {
            expect(other.marks).toHaveLength(1)
            expect(other.marks[0]).toMatchObject({ from: 'ion', seat: 0, tool: 'pen' })
            // Every point I drew reached them (the end repeats the last one).
            expect(other.marks[0].pts.slice(0, mine.pts.length)).toEqual(mine.pts)
            expect(other.marks[0].doneAt).not.toBeNull()
        }
        expect(m.said).toContain('ana: Ion is drawing.')
    })

    it('drops a hand at rest and points on a straight line', () => {
        m.ion.setTool('pen')
        m.ion.begin({ x: 0, y: 0.5 })
        m.ion.extend(Array.from({ length: 50 }, (_, i) => ({ x: (i + 1) / 100, y: 0.5 })))
        m.ion.extend([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }])
        m.frame()
        m.ion.end()
        // The straight line arrives as its two ends (plus the repeated last point of the end).
        expect(m.ana.marks[0].pts.length).toBeLessThanOrEqual(6)
    })

    it('replaces an arrow\'s tip as it moves, and keeps its tail', () => {
        m.mihai.setTool('arrow')
        m.mihai.begin({ x: 0.1, y: 0.1 })
        m.mihai.extend([{ x: 0.3, y: 0.3 }])
        m.mihai.extend([{ x: 0.5, y: 0.4 }])
        m.frame()
        expect(m.ana.marks[0].pts).toEqual([0.1, 0.1, 0.5, 0.4])
        m.mihai.extend([{ x: 0.6, y: 0.6 }])
        m.mihai.end()
        expect(m.ana.marks[0]).toMatchObject({ tool: 'arrow', pts: [0.1, 0.1, 0.6, 0.6] })
        expect(m.ana.marks[0].doneAt).not.toBeNull()
    })

    it('splits a long frame into messages of 64 points', () => {
        m.ion.setTool('marker')
        m.ion.begin({ x: 0, y: 0 })
        // A zigzag that simplification cannot flatten.
        m.ion.extend(Array.from({ length: 150 }, (_, i) => ({ x: (i + 1) / 160, y: i % 2 ? 0.2 : 0 })))
        m.frame()
        const toAna = m.log.filter((l) => l.to === 'ana' && l.message.t === 'stroke')
        expect(toAna.every((l) => l.message.t === 'stroke' && l.message.pts.length <= 128)).toBe(true)
        expect(m.ana.marks[0].pts.length / 2).toBe(151)
    })

    it('fades finished marks after a few seconds, everywhere', () => {
        m.ion.setTool('pen')
        m.ion.begin({ x: 0.1, y: 0.1 })
        m.ion.end()
        vi.advanceTimersByTime(FADE.markHold)
        expect(m.ana.marks).toHaveLength(1)
        vi.advanceTimersByTime(FADE.markFade + 200)
        expect(m.ana.marks).toHaveLength(0)
        expect(m.ion.marks).toHaveLength(0)
    })

    it('finishes a stroke whose author went quiet', () => {
        m.ion.setTool('pen')
        m.ion.begin({ x: 0.1, y: 0.1 })
        vi.advanceTimersByTime(FADE.strokeIdle + FADE.markHold + FADE.markFade + 500)
        expect(m.ana.marks).toHaveLength(0)
    })

    it('stops growing a stroke at the cap', () => {
        m.ion.setTool('pen')
        m.ion.begin({ x: 0, y: 0 })
        for (let batch = 0; batch < 40; batch++) {
            m.ion.extend(Array.from({ length: 50 }, (_, i) => ({ x: Math.random(), y: (batch * 50 + i) % 2 ? 1 : 0 })))
            m.frame()
        }
        m.ion.end()
        expect(m.ion.marks[0].pts.length / 2).toBeLessThanOrEqual(MAX_STROKE_POINTS)
        expect(m.ana.marks[0].pts.length / 2).toBeLessThanOrEqual(MAX_STROKE_POINTS)
    })

    it('keeps at most 30 marks per person, the oldest going first', () => {
        m.ion.setTool('pen')
        for (let i = 0; i < MAX_MARKS_PER_PERSON + 5; i++) {
            m.ion.begin({ x: i / 100, y: 0.5 })
            m.ion.end()
        }
        expect(m.ion.marks).toHaveLength(MAX_MARKS_PER_PERSON)
        expect(m.ana.marks).toHaveLength(MAX_MARKS_PER_PERSON)
        expect(m.ana.marks[0].pts[0]).toBe(0.05)
    })

    it('starts over when the share changes hands, and drops the marks of people who left', () => {
        m.ion.setTool('pen')
        m.ion.begin({ x: 0.1, y: 0.1 })
        m.ion.end()
        m.mihai.rosterChanged(m.roster('mihai', 'ana').filter((p) => p.id !== 'ion'))
        expect(m.mihai.marks).toHaveLength(0)

        m.share('mihai')
        expect(m.ana.marks).toHaveLength(0)
        expect(m.ion.tool).toBeNull()
    })
})

describe('clearing marks', () => {
    let m: ReturnType<typeof meeting>

    beforeEach(() => {
        vi.useFakeTimers()
        m = meeting({ host: 'ion' })
        for (const who of [m.ion, m.mihai, m.ana]) {
            who.setTool('pen')
            who.begin({ x: 0.5, y: 0.5 })
            who.end()
        }
    })

    afterEach(() => {
        m.destroy()
        vi.useRealTimers()
    })

    it('lets a viewer clear their own marks only', () => {
        expect(m.mihai.canClearAll).toBe(false)
        m.mihai.clear()
        for (const a of [m.ion, m.ana, m.mihai]) expect(a.marks.map((x) => x.from).sort()).toEqual(['ana', 'ion'])
    })

    it('lets the sharer clear everyone\'s', () => {
        m.ana.clear()
        for (const a of [m.ion, m.ana, m.mihai]) expect(a.marks).toEqual([])
        expect(m.said).toContain('mihai: Ana Pop cleared all marks.')
    })

    it('lets the host clear everyone\'s', () => {
        expect(m.ion.canClearAll).toBe(true)
        m.ion.clear()
        for (const a of [m.ion, m.ana, m.mihai]) expect(a.marks).toEqual([])
    })

    it('treats a viewer asking to clear all as clearing their own', () => {
        m.forge(m.ana, 'mihai', { v: 1, t: 'clear', s: 'ana', all: true })
        expect(m.ana.marks.map((x) => x.from).sort()).toEqual(['ana', 'ion'])
    })
})

describe('the sharer\'s switch', () => {
    let m: ReturnType<typeof meeting>

    beforeEach(() => {
        vi.useFakeTimers()
        m = meeting()
    })

    afterEach(() => {
        m.destroy()
        vi.useRealTimers()
    })

    it('stops the others pointing and drawing, and takes their marks away', () => {
        m.mihai.setTool('pen')
        m.mihai.begin({ x: 0.1, y: 0.1 })
        m.mihai.end()
        m.ion.setTool('pointer')

        m.ana.setOpen(false)
        for (const a of [m.ion, m.mihai]) {
            expect(a.open).toBe(false)
            expect(a.canAnnotate).toBe(false)
            expect(a.tool).toBeNull()
            expect(a.marks).toEqual([])
        }
        expect(m.said).toContain('ion: Ana Pop turned off pointing and drawing on their screen.')
        m.mihai.setTool('pen')
        expect(m.mihai.tool).toBeNull()
        // The sharer can still draw.
        expect(m.ana.canAnnotate).toBe(true)
    })

    it('is respected on the receiving side even when a viewer ignores it', () => {
        m.ana.setOpen(false)
        m.forge(m.ion, 'mihai', { v: 1, t: 'stroke', s: 'ana', id: 9, tool: 'pen', pts: [0.1, 0.1], end: true })
        m.forge(m.ion, 'mihai', { v: 1, t: 'ptr', s: 'ana', x: 0.5, y: 0.5 })
        expect(m.ion.marks).toEqual([])
        expect(m.ion.pointers).toEqual([])
    })

    it('is only taken from the sharer', () => {
        m.forge(m.ion, 'mihai', { v: 1, t: 'cfg', s: 'ana', open: false })
        m.forge(m.ion, 'mihai', { v: 1, t: 'cfg', s: 'mihai', open: false })
        expect(m.ion.open).toBe(true)
    })

    it('reaches someone whose channel opens later (a late joiner, a reload)', () => {
        m.ana.setOpen(false)
        m.log.length = 0
        m.ion.open = true
        m.ana.connected('ion')
        m.mihai.connected('ion')
        expect(m.log).toEqual([{ from: 'ana', to: 'ion', message: { v: 1, t: 'cfg', s: 'ana', open: false } }])
        expect(m.ion.open).toBe(false)
    })

    it('keeps a setting that arrives before the news that they share', () => {
        // Reloaded: the channel is open again, but the roster does not say Ana shares yet.
        m.share(null)
        m.forge(m.ion, 'ana', { v: 1, t: 'cfg', s: 'ana', open: false })
        expect(m.ion.open).toBe(true)
        m.ion.rosterChanged(m.roster('ion', 'ana'))
        expect(m.ion.open).toBe(false)
        expect(m.ion.canAnnotate).toBe(false)
    })

    it('forgets an early setting that is too old', () => {
        m.share(null)
        m.forge(m.ion, 'ana', { v: 1, t: 'cfg', s: 'ana', open: false })
        vi.advanceTimersByTime(20_000)
        m.ion.rosterChanged(m.roster('ion', 'ana'))
        expect(m.ion.open).toBe(true)
    })

    it('starts open on every new share', () => {
        m.ana.setOpen(false)
        m.share(null)
        m.share('ana')
        expect(m.ion.open).toBe(true)
    })
})

describe('what comes in from the others', () => {
    let m: ReturnType<typeof meeting>

    beforeEach(() => {
        vi.useFakeTimers()
        m = meeting()
    })

    afterEach(() => {
        m.destroy()
        vi.useRealTimers()
    })

    it('ignores people who are not in the meeting, and my own messages', () => {
        m.forge(m.ion, 'stranger', { v: 1, t: 'ptr', s: 'ana', x: 0.5, y: 0.5 })
        m.forge(m.ion, 'ion', { v: 1, t: 'ptr', s: 'ana', x: 0.5, y: 0.5 })
        expect(m.ion.pointers).toEqual([])
    })

    it('ignores marks meant for another share', () => {
        m.forge(m.ion, 'mihai', { v: 1, t: 'ptr', s: 'mihai', x: 0.5, y: 0.5 })
        expect(m.ion.pointers).toEqual([])
    })

    it('ignores garbage and never takes a name from a message', () => {
        m.forge(m.ion, 'mihai', '{"v":1,"t":"ptr"')
        m.forge(m.ion, 'mihai', { v: 1, t: 'ptr', s: 'ana', x: 0.5, y: 0.5, name: '<img src=x onerror=alert(1)>' })
        expect(m.ion.pointers).toMatchObject([{ id: 'mihai', name: 'Mihai' }])
    })

    it('does not let a stroke change tool or grow after it ended', () => {
        m.forge(m.ion, 'mihai', { v: 1, t: 'stroke', s: 'ana', id: 1, tool: 'pen', pts: [0.1, 0.1], end: false })
        m.forge(m.ion, 'mihai', { v: 1, t: 'stroke', s: 'ana', id: 1, tool: 'arrow', pts: [0, 0, 1, 1], end: false })
        expect(m.ion.marks[0]).toMatchObject({ tool: 'pen', pts: [0.1, 0.1] })
        m.forge(m.ion, 'mihai', { v: 1, t: 'stroke', s: 'ana', id: 1, tool: 'pen', pts: [0.2, 0.2], end: true })
        m.forge(m.ion, 'mihai', { v: 1, t: 'stroke', s: 'ana', id: 1, tool: 'pen', pts: [0.9, 0.9], end: false })
        expect(m.ion.marks[0].pts).toEqual([0.1, 0.1, 0.2, 0.2])
    })

    it('accepts a message that is exactly what encode writes', () => {
        m.ion.receive('mihai', encode({ v: 1, t: 'ptr', s: 'ana', x: 0.25, y: 0.75 }))
        expect(m.ion.pointers).toMatchObject([{ x: 0.25, y: 0.75 }])
    })
})

// The pointer and marks on a shared screen (#6) as Svelte state: what I point at and draw goes
// out over the wire, what the others send comes in checked against the roster. The layer and
// the toolbar read it; nothing here touches the DOM.

import { announce as announceToScreenReader } from '../ui/announce.svelte'
import { Coalescer, type CoalesceOptions } from './coalesce'
import { FADE, flat, markOpacity, pointerOpacity, simplify, thin, unflat, type Point } from './geometry'
import { decode, displayName, encode, MAX_POINTS_PER_MESSAGE, MAX_STROKE_POINTS, type DrawTool, type Message } from './protocol'
import type { Wire } from './wire'

export type Tool = 'pointer' | DrawTool

/** Who is in the meeting, as far as annotations care: a subset of the room's Person. */
export interface Who {
    id: string
    name: string
    seat: number
    me: boolean
    sharing: boolean
    /**
     * The Worker names them the host (`role` in the poll's `peers`). Never from a message:
     * absent or false, their "clear all" as host is not honoured.
     */
    host?: boolean
}

export interface Mark {
    key: string
    from: string
    seat: number
    tool: DrawTool
    /** Flat `[x0, y0, x1, y1, …]` on the picture (0..1). */
    pts: number[]
    /** When it was finished (null while it is being drawn). */
    doneAt: number | null
    /** When it last grew: a stroke whose author goes quiet is finished for them. */
    touchedAt: number
}

export interface PointerSpot {
    id: string
    name: string
    seat: number
    me: boolean
    x: number
    y: number
    at: number
}

export interface AnnotationsOptions {
    wire: Wire
    me: { id: string, isHost: boolean }
    announce?: (text: string) => void
    now?: () => number
    /** Frame scheduling for the outgoing messages (tests pass their own). */
    timing?: Pick<CoalesceOptions<unknown>, 'now' | 'schedule' | 'interval'>
    reducedMotion?: () => boolean
}

/** Marks one person can have on the screen at once; the oldest goes first. */
export const MAX_MARKS_PER_PERSON = 30
/** One announcement per person and kind ("Ana is pointing.") in this long. */
const ANNOUNCE_EVERY_MS = 8000
/**
 * A sharer's `cfg` can arrive before the roster says they share (the data channel is direct,
 * the sharing flag comes through the polled signaling): it is kept this long for that moment.
 */
const EARLY_CONFIG_MS = 15_000
/** Movement smaller than this (share of the picture) is not sent while drawing. */
const MIN_STEP = 0.0015
/** How far a simplified stroke may stray from what was drawn (share of the picture). */
const SIMPLIFY = 0.0006

const TOOL_NAMES: Record<Tool, string> = { pointer: 'Pointer', pen: 'Pen', arrow: 'Arrow', marker: 'Highlighter' }

/** Keyboard shortcuts for the tools while a screen is shared (Escape puts the tool down). */
export const TOOL_KEYS: Record<string, Tool> = { p: 'pointer', d: 'pen', a: 'arrow', h: 'marker' }

interface Drawing {
    id: number
    tool: DrawTool
    tail: Point
    /** The last point sent: the next batch is simplified against it. */
    last: Point
    count: number
    full: boolean
}

export class Annotations {
    tool = $state<Tool | null>(null)
    marks = $state.raw<Mark[]>([])
    pointers = $state.raw<PointerSpot[]>([])
    /** The sharer lets the others point and draw (their `cfg`). */
    open = $state(true)
    sharerId = $state<string | null>(null)
    people = $state.raw<Who[]>([])
    /** Moves on while something is fading, so the layer can redraw opacities. */
    clock = $state(0)

    private readonly wire: Wire
    private readonly me: { id: string, isHost: boolean }
    private readonly say: (text: string) => void
    private readonly now: () => number
    private readonly reduced: () => boolean
    private readonly pointerOut: Coalescer<Point | null>
    private readonly strokeOut: Coalescer<{ points: Point[], end: boolean }>
    private readonly unlisten: () => void
    private drawing: Drawing | null = null
    private nextId = 1
    private ticker: ReturnType<typeof setInterval> | null = null
    private announced = new Map<string, number>()
    private earlyConfig = new Map<string, { open: boolean, at: number }>()

    constructor(options: AnnotationsOptions) {
        this.wire = options.wire
        this.me = options.me
        this.say = options.announce ?? announceToScreenReader
        this.now = options.now ?? (() => Date.now())
        this.reduced = options.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
        const timing = options.timing ?? {}
        this.pointerOut = new Coalescer<Point | null>((p) => this.sendPointer(p), { ...timing })
        this.strokeOut = new Coalescer<{ points: Point[], end: boolean }>((batch) => this.sendStroke(batch.points, batch.end), {
            ...timing,
            // An arrow only needs its latest tip; a pen line needs every point.
            merge: (a, b) => (this.drawing?.tool === 'arrow'
                ? { points: b.points.length ? b.points : a.points, end: a.end || b.end }
                : { points: [...a.points, ...b.points], end: a.end || b.end }),
        })
        this.unlisten = this.wire.listen({
            message: (from, data) => this.receive(from, data),
            open: (peerId) => this.connected(peerId),
        })
    }

    get iShare(): boolean {
        return this.sharerId !== null && this.sharerId === this.me.id
    }

    /** I may point and draw on the screen being shared now. */
    get canAnnotate(): boolean {
        return this.sharerId !== null && (this.iShare || this.open)
    }

    /** The sharer and the host clear everyone's marks; the others clear their own. */
    get canClearAll(): boolean {
        return this.iShare || this.me.isHost
    }

    get sharerName(): string {
        return displayName(this.people.find((p) => p.id === this.sharerId)?.name)
    }

    get hasMarks(): boolean {
        return this.canClearAll ? this.marks.length > 0 : this.marks.some((m) => m.from === this.me.id)
    }

    /** The roster changed: follow who shares, forget people who left. */
    rosterChanged(people: Who[]): void {
        this.people = people
        const sharer = people.find((p) => p.sharing)?.id ?? null
        if (sharer !== this.sharerId) {
            this.sharerId = sharer
            this.reset()
            this.open = true
            if (this.iShare) this.broadcast({ v: 1, t: 'cfg', s: this.me.id, open: true })
            // Their setting may have come over the data channel before the news that they share.
            const early = sharer ? this.earlyConfig.get(sharer) : undefined
            if (early && this.now() - early.at < EARLY_CONFIG_MS) this.open = early.open
            this.earlyConfig.clear()

            return
        }
        const ids = new Set(people.map((p) => p.id))
        if (this.marks.some((m) => ! ids.has(m.from))) this.marks = this.marks.filter((m) => ids.has(m.from))
        if (this.pointers.some((p) => ! ids.has(p.id))) this.pointers = this.pointers.filter((p) => ids.has(p.id))
    }

    setTool(tool: Tool | null): void {
        if (tool && ! this.canAnnotate) return
        if (this.tool === tool) return
        if (this.tool === 'pointer') this.point(null)
        if (this.drawing) this.end()
        this.tool = tool
        this.say(tool ? `${TOOL_NAMES[tool]} on. ${tool === 'pointer' ? 'Move over the shared screen to point.' : 'Draw on the shared screen.'}` : 'Pointing and drawing off.')
    }

    /** My pointer at a spot on the picture, or null when it leaves. */
    point(p: Point | null): void {
        if (! this.sharerId) return
        if (p && (this.tool !== 'pointer' || ! this.canAnnotate)) return
        const mine = this.pointers.find((s) => s.me)
        if (! p) {
            if (! mine) return
            this.pointers = this.pointers.filter((s) => ! s.me)
            this.pointerOut.drop()
            this.sendPointer(null)

            return
        }
        const me = this.people.find((s) => s.me)
        const spot: PointerSpot = { id: this.me.id, name: displayName(me?.name), seat: me?.seat ?? 0, me: true, x: p.x, y: p.y, at: this.now() }
        this.pointers = mine ? this.pointers.map((s) => (s.me ? spot : s)) : [...this.pointers, spot]
        this.pointerOut.push(p)
        this.tick()
    }

    /** Starts a stroke with the current tool at a spot on the picture. */
    begin(p: Point): void {
        if (! this.canAnnotate || ! this.tool || this.tool === 'pointer') return
        if (this.drawing) this.end()
        const me = this.people.find((s) => s.me)
        const id = this.nextId++
        this.drawing = { id, tool: this.tool, tail: p, last: p, count: 1, full: false }
        const mark: Mark = { key: `${this.me.id}:${id}`, from: this.me.id, seat: me?.seat ?? 0, tool: this.tool, pts: this.tool === 'arrow' ? [p.x, p.y, p.x, p.y] : [p.x, p.y], doneAt: null, touchedAt: this.now() }
        this.marks = this.limit([...this.marks, mark], this.me.id)
        this.sendStroke([p], false, true)
        this.tick()
    }

    /** The stroke goes on through these points (an arrow: its tip moves to the last one). */
    extend(points: Point[]): void {
        const d = this.drawing
        if (! d || ! points.length) return
        if (d.tool === 'arrow') {
            this.strokeOut.push({ points: [points[points.length - 1]], end: false })

            return
        }
        if (d.full) return
        this.strokeOut.push({ points, end: false })
    }

    end(): void {
        if (! this.drawing) return
        this.strokeOut.push({ points: [], end: true })
        this.strokeOut.flush()
        const key = `${this.me.id}:${this.drawing.id}`
        this.drawing = null
        this.marks = this.marks.map((m) => (m.key === key ? { ...m, doneAt: this.now() } : m))
    }

    /** Clears everyone's marks (the sharer, the host) or my own. */
    clear(): void {
        if (! this.sharerId) return
        if (this.drawing) this.end()
        const all = this.canClearAll
        this.marks = all ? [] : this.marks.filter((m) => m.from !== this.me.id)
        this.broadcast({ v: 1, t: 'clear', s: this.sharerId, all, ...(all && this.me.isHost ? { host: true } : {}) })
        this.say(all ? 'Cleared all marks.' : 'Cleared your marks.')
    }

    /** The sharer lets the others point and draw, or stops them. */
    setOpen(open: boolean): void {
        if (! this.iShare || this.open === open) return
        this.open = open
        if (! open) this.dropOthers()
        this.broadcast({ v: 1, t: 'cfg', s: this.me.id, open })
        this.say(open ? 'The others can point and draw on your screen.' : 'Only you can point and draw on your screen now.')
    }

    /** A message from a peer, straight off the wire. */
    receive(from: string, raw: unknown): void {
        const message = decode(raw)
        if (! message || from === this.me.id) return
        const who = this.people.find((p) => p.id === from && ! p.me)
        if (! who) return
        if (message.t === 'cfg' && message.s === from && from !== this.sharerId) {
            this.earlyConfig.set(from, { open: message.open, at: this.now() })

            return
        }
        if (! this.sharerId || message.s !== this.sharerId) return
        const fromSharer = from === this.sharerId
        const name = displayName(who.name)

        switch (message.t) {
            case 'cfg':
                if (! fromSharer || this.open === message.open) return
                this.open = message.open
                if (! message.open) {
                    this.dropOthers()
                    if (this.tool) {
                        if (this.drawing) this.end()
                        this.point(null)
                        this.tool = null
                    }
                }
                this.say(message.open ? `${name} lets everyone point and draw on their screen.` : `${name} turned off pointing and drawing on their screen.`)

                return
            case 'ptr': {
                if (! fromSharer && ! this.open) return
                if (message.x === null || message.y === null) {
                    this.pointers = this.pointers.filter((p) => p.id !== from)

                    return
                }
                const spot: PointerSpot = { id: from, name, seat: who.seat, me: false, x: message.x, y: message.y, at: this.now() }
                const known = this.pointers.some((p) => p.id === from)
                this.pointers = known ? this.pointers.map((p) => (p.id === from ? spot : p)) : [...this.pointers, spot]
                if (! known) this.announceOnce(from, 'pointing', `${name} is pointing.`)
                this.tick()

                return
            }
            case 'stroke': {
                if (! fromSharer && ! this.open) return
                const key = `${from}:${message.id}`
                const existing = this.marks.find((m) => m.key === key)
                const now = this.now()
                if (existing?.doneAt != null) return
                if (! existing) {
                    const mark: Mark = { key, from, seat: who.seat, tool: message.tool, pts: message.pts, doneAt: message.end ? now : null, touchedAt: now }
                    this.marks = this.limit([...this.marks, mark], from)
                    this.announceOnce(from, 'drawing', `${name} is drawing.`)
                } else {
                    if (existing.tool !== message.tool) return
                    const pts = message.tool === 'arrow'
                        ? message.pts
                        : existing.pts.length >= MAX_STROKE_POINTS * 2 ? existing.pts : [...existing.pts, ...message.pts].slice(0, MAX_STROKE_POINTS * 2)
                    this.marks = this.marks.map((m) => (m.key === key ? { ...m, pts, touchedAt: now, doneAt: message.end ? now : null } : m))
                }
                this.tick()

                return
            }
            case 'clear':
                // `host` in the message is only a claim: it counts when the roster, which comes
                // from the Worker, says the sender is the host.
                if (message.all && (fromSharer || (message.host === true && who.host === true))) {
                    if (this.drawing) this.end()
                    this.marks = []
                    this.say(`${name} cleared all marks.`)
                } else {
                    this.marks = this.marks.filter((m) => m.from !== from)
                }
        }
    }

    /** The channel to a peer opened: a sharer tells them the setting for the share. */
    connected(peerId: string): void {
        if (this.iShare) this.wire.send(encode({ v: 1, t: 'cfg', s: this.me.id, open: this.open }), [peerId])
    }

    /** Opacity of a mark or pointer now, for the layer. */
    markOpacity(mark: Mark): number {
        return markOpacity(mark.doneAt === null ? null : this.clock - mark.doneAt, this.reduced())
    }

    pointerOpacity(spot: PointerSpot): number {
        return pointerOpacity(this.clock - spot.at, this.reduced())
    }

    destroy(): void {
        this.unlisten()
        this.pointerOut.drop()
        this.strokeOut.drop()
        if (this.ticker) clearInterval(this.ticker)
        this.ticker = null
    }

    private reset(): void {
        this.drawing = null
        this.pointerOut.drop()
        this.strokeOut.drop()
        this.marks = []
        this.pointers = []
        this.tool = null
    }

    private dropOthers(): void {
        const keep = (id: string) => id === this.sharerId
        this.marks = this.marks.filter((m) => keep(m.from))
        this.pointers = this.pointers.filter((p) => keep(p.id))
    }

    private limit(marks: Mark[], from: string): Mark[] {
        const theirs = marks.filter((m) => m.from === from)
        if (theirs.length <= MAX_MARKS_PER_PERSON) return marks
        const drop = new Set(theirs.slice(0, theirs.length - MAX_MARKS_PER_PERSON).map((m) => m.key))

        return marks.filter((m) => ! drop.has(m.key))
    }

    private others(): string[] {
        return this.people.filter((p) => ! p.me).map((p) => p.id)
    }

    private broadcast(message: Message): void {
        const to = this.others()
        if (to.length) this.wire.send(encode(message), to)
    }

    private sendPointer(p: Point | null): void {
        if (! this.sharerId) return
        this.broadcast({ v: 1, t: 'ptr', s: this.sharerId, x: p?.x ?? null, y: p?.y ?? null })
    }

    /** Sends a batch of the stroke being drawn, simplified, in messages of at most 64 points. */
    private sendStroke(points: Point[], end: boolean, first = false): void {
        const d = this.drawing
        if (! d || ! this.sharerId) return
        const s = this.sharerId
        const key = `${this.me.id}:${d.id}`

        if (d.tool === 'arrow') {
            const tip = points[points.length - 1] ?? d.last
            d.last = tip
            const pts = [d.tail.x, d.tail.y, tip.x, tip.y]
            this.marks = this.marks.map((m) => (m.key === key ? { ...m, pts, touchedAt: this.now() } : m))
            this.broadcast({ v: 1, t: 'stroke', s, id: d.id, tool: 'arrow', pts, end })

            return
        }

        let fresh = first ? points : thin(points, MIN_STEP, d.last)
        if (! first && fresh.length) fresh = simplify([d.last, ...fresh], SIMPLIFY).slice(1)
        fresh = fresh.slice(0, Math.max(0, MAX_STROKE_POINTS - (first ? 0 : d.count)))
        if (! first) d.count += fresh.length
        if (d.count >= MAX_STROKE_POINTS) d.full = true
        if (! fresh.length && ! end) return
        if (fresh.length) {
            d.last = fresh[fresh.length - 1]
            const add = flat(fresh)
            if (! first) this.marks = this.marks.map((m) => (m.key === key ? { ...m, pts: [...m.pts, ...add], touchedAt: this.now() } : m))
        }
        if (! fresh.length) {
            // Nothing new, just the end: repeat the last point so the message is valid on its own.
            fresh = [d.last]
        }
        for (let i = 0; i < fresh.length; i += MAX_POINTS_PER_MESSAGE) {
            const chunk = fresh.slice(i, i + MAX_POINTS_PER_MESSAGE)
            const last = i + MAX_POINTS_PER_MESSAGE >= fresh.length
            this.broadcast({ v: 1, t: 'stroke', s, id: d.id, tool: d.tool, pts: flat(chunk), end: end && last })
        }
    }

    private announceOnce(from: string, kind: string, text: string): void {
        const key = `${from}:${kind}`
        const now = this.now()
        if (now - (this.announced.get(key) ?? -Infinity) < ANNOUNCE_EVERY_MS) return
        this.announced.set(key, now)
        this.say(text)
    }

    /** Keeps the clock moving while anything is on screen, and lets faded things go. */
    private tick(): void {
        this.clock = this.now()
        if (this.ticker) return
        this.ticker = setInterval(() => this.sweep(), 100)
    }

    private sweep(): void {
        const now = this.now()
        this.clock = now
        const reduced = this.reduced()
        const marks = this.marks
            .map((m) => (m.doneAt === null && m.from !== this.me.id && now - m.touchedAt > FADE.strokeIdle ? { ...m, doneAt: now } : m))
            .filter((m) => markOpacity(m.doneAt === null ? null : now - m.doneAt, reduced) > 0)
        if (marks.length !== this.marks.length || marks.some((m, i) => m !== this.marks[i])) this.marks = marks
        const pointers = this.pointers.filter((p) => pointerOpacity(now - p.at, reduced) > 0)
        if (pointers.length !== this.pointers.length) this.pointers = pointers
        if (! this.marks.length && ! this.pointers.length && this.ticker) {
            clearInterval(this.ticker)
            this.ticker = null
        }
    }
}

/** The points of a mark, for drawing. */
export function markPoints(mark: Mark): Point[] {
    return unflat(mark.pts)
}

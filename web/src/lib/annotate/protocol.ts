// The wire format of the pointer and marks on a shared screen (#6), version 1.
// docs/annotations.md describes it for people; this file is the source of truth.
//
// Everything a peer sends is untrusted: `decode` drops anything that is not exactly one of the
// shapes below and clamps every number, so the rest of the app only ever sees valid messages.
// No message carries a name, a colour or any text: those come from the roster.

export const VERSION = 1

/** A message longer than this (in UTF-16 units, about bytes for this ASCII format) is dropped unread. */
export const MAX_MESSAGE_LENGTH = 4096
/** Points in one `stroke` message: a frame of drawing, never more. */
export const MAX_POINTS_PER_MESSAGE = 64
/** Points in a whole stroke; more are ignored, the stroke just stops growing. */
export const MAX_STROKE_POINTS = 1500
/** Decimal places kept on a coordinate: 1/10000 of the screen is under a pixel on a 4K share. */
const PRECISION = 1e4

export type DrawTool = 'pen' | 'arrow' | 'marker'
export const DRAW_TOOLS: readonly DrawTool[] = ['pen', 'arrow', 'marker']

/** The pointer at (x, y), or `x: null` once it left the screen. */
export interface PointerMessage { v: 1, t: 'ptr', s: string, x: number | null, y: number | null }

/**
 * Part of a stroke: `pts` is a flat list `[x0, y0, x1, y1, …]`. For `pen` and `marker` each
 * message adds its points to the stroke `id`; for `arrow` it always carries the two ends,
 * tail first, and replaces them. `end` marks the last message of the stroke.
 */
export interface StrokeMessage { v: 1, t: 'stroke', s: string, id: number, tool: DrawTool, pts: number[], end: boolean }

/** Clears the sender's marks, or everyone's with `all` (honoured from the sharer and the host only). */
export interface ClearMessage { v: 1, t: 'clear', s: string, all: boolean, host?: boolean }

/** The sharer's setting for their share: whether the others may point and draw on it. */
export interface ConfigMessage { v: 1, t: 'cfg', s: string, open: boolean }

export type Message = PointerMessage | StrokeMessage | ClearMessage | ConfigMessage

const ID = /^[A-Za-z0-9_-]{1,64}$/

/** A coordinate from the wire: a finite number clamped into 0..1 and rounded, or null if it is not a number. */
export function coordinate(value: unknown): number | null {
    if (typeof value !== 'number' || ! Number.isFinite(value)) return null

    return Math.round(Math.min(1, Math.max(0, value)) * PRECISION) / PRECISION
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && ID.test(value)
}

function points(value: unknown, tool: DrawTool): number[] | null {
    if (! Array.isArray(value) || value.length % 2 !== 0) return null
    if (tool === 'arrow' ? value.length !== 4 : value.length === 0 || value.length > MAX_POINTS_PER_MESSAGE * 2) return null
    const out: number[] = []
    for (const v of value) {
        const c = coordinate(v)
        if (c === null) return null
        out.push(c)
    }

    return out
}

/** Reads one message from a peer; null for anything malformed, oversized, of another version or unknown. */
export function decode(raw: unknown): Message | null {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) return null
    let data: unknown
    try {
        data = JSON.parse(raw)
    } catch {
        return null
    }
    if (! data || typeof data !== 'object' || Array.isArray(data)) return null
    const m = data as Record<string, unknown>
    if (m.v !== VERSION || ! isId(m.s)) return null

    switch (m.t) {
        case 'ptr': {
            if (m.x === null && m.y === null) return { v: 1, t: 'ptr', s: m.s, x: null, y: null }
            const x = coordinate(m.x)
            const y = coordinate(m.y)

            return x === null || y === null ? null : { v: 1, t: 'ptr', s: m.s, x, y }
        }
        case 'stroke': {
            if (! Number.isSafeInteger(m.id) || (m.id as number) < 0 || (m.id as number) > 0x7fffffff) return null
            if (! DRAW_TOOLS.includes(m.tool as DrawTool)) return null
            const pts = points(m.pts, m.tool as DrawTool)
            if (! pts) return null

            return { v: 1, t: 'stroke', s: m.s, id: m.id as number, tool: m.tool as DrawTool, pts, end: m.end === true }
        }
        case 'clear':
            return { v: 1, t: 'clear', s: m.s, all: m.all === true, ...(m.host === true ? { host: true } : {}) }
        case 'cfg':
            return typeof m.open === 'boolean' ? { v: 1, t: 'cfg', s: m.s, open: m.open } : null
    }

    return null
}

/** Writes a message for the wire, with coordinates rounded so a frame of drawing stays small. */
export function encode(message: Message): string {
    if (message.t === 'ptr') {
        return JSON.stringify({ ...message, x: message.x === null ? null : coordinate(message.x), y: message.y === null ? null : coordinate(message.y) })
    }
    if (message.t === 'stroke') {
        return JSON.stringify({ ...message, pts: message.pts.map((v) => coordinate(v) ?? 0) })
    }

    return JSON.stringify(message)
}

/** Control characters, bidi overrides and isolates, zero-width characters and the BOM. */
function hidden(code: number): boolean {
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f)
        || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff
}

/**
 * A name as the pointer's tag shows it: no control or invisible formatting characters
 * (which could flip the text direction), single spaces, at most 40 characters. Names come
 * from the meeting's roster, never from a message; this is a second line of defence.
 */
export function displayName(name: unknown): string {
    if (typeof name !== 'string') return 'Someone'
    const clean = [...name.replace(/\s+/g, ' ')].filter((c) => ! hidden(c.codePointAt(0) ?? 0)).join('').trim()
    const chars = [...clean]

    return chars.length ? (chars.length > 40 ? `${chars.slice(0, 39).join('')}…` : clean) : 'Someone'
}

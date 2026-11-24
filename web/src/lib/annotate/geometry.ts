// Where a shared screen's picture sits inside its tile, and the maths of marks drawn on it.
// Marks travel in the picture's own space (0..1 across its width and height), so every
// viewer sees them on the same spot whatever the size of their window or tile.

export interface Point { x: number, y: number }
export interface Size { w: number, h: number }
export interface Rect { x: number, y: number, w: number, h: number }

/**
 * The rectangle the picture fills inside a box, for `object-fit: contain` (letterboxed, the
 * default for a shared screen) or `cover` (cropped). Unknown media size: the whole box.
 */
export function contentRect(box: Size, media: Size | null, fit: 'contain' | 'cover' = 'contain'): Rect {
    if (! media || media.w <= 0 || media.h <= 0 || box.w <= 0 || box.h <= 0) return { x: 0, y: 0, w: Math.max(0, box.w), h: Math.max(0, box.h) }
    const scale = fit === 'contain' ? Math.min(box.w / media.w, box.h / media.h) : Math.max(box.w / media.w, box.h / media.h)
    const w = media.w * scale
    const h = media.h * scale

    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h }
}

/**
 * A point in the box (pixels from its top left) as a point on the picture (0..1). Outside the
 * picture (on the letterbox bars) it is null, or clamped to the nearest edge with `clamp`.
 */
export function toNormal(px: number, py: number, rect: Rect, clamp = false): Point | null {
    if (rect.w <= 0 || rect.h <= 0) return null
    const x = (px - rect.x) / rect.w
    const y = (py - rect.y) / rect.h
    if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }

    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
}

/** A point on the picture (0..1) in pixels of the box. */
export function fromNormal(p: Point, rect: Rect): Point {
    return { x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h }
}

export function flat(points: Point[]): number[] {
    return points.flatMap((p) => [p.x, p.y])
}

export function unflat(values: number[]): Point[] {
    const out: Point[] = []
    for (let i = 0; i + 1 < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] })

    return out
}

/** Drops points closer than `min` to the last one kept: a hand at rest sends nothing. */
export function thin(points: Point[], min: number, last: Point | null = null): Point[] {
    const out: Point[] = []
    let prev = last
    for (const p of points) {
        if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < min) continue
        out.push(p)
        prev = p
    }

    return out
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = dx * dx + dy * dy
    if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))

    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Ramer-Douglas-Peucker: the fewest points that stay within `epsilon` of the line drawn.
 * Keeps the first and the last point. Iterative, so a long stroke cannot overflow the stack.
 */
export function simplify(points: Point[], epsilon: number): Point[] {
    if (points.length < 3) return points.slice()
    const keep = new Uint8Array(points.length)
    keep[0] = 1
    keep[points.length - 1] = 1
    const stack: [number, number][] = [[0, points.length - 1]]
    while (stack.length) {
        const [from, to] = stack.pop()!
        let far = -1
        let farthest = epsilon
        for (let i = from + 1; i < to; i++) {
            const d = distanceToSegment(points[i], points[from], points[to])
            if (d > farthest) {
                farthest = d
                far = i
            }
        }
        if (far < 0) continue
        keep[far] = 1
        stack.push([from, far], [far, to])
    }

    return points.filter((_, i) => keep[i])
}

const r = (n: number) => Math.round(n * 10) / 10

/**
 * An SVG path through the points (in pixels), smoothed: straight to the first midpoint, then a
 * quadratic curve through each midpoint with the point itself as control, so corners round off
 * without overshooting what was drawn. One point is a dot (a zero-length line with round caps).
 */
export function smoothPath(points: Point[]): string {
    if (! points.length) return ''
    const [first] = points
    if (points.length === 1) return `M${r(first.x)} ${r(first.y)}l0 0`
    if (points.length === 2) return `M${r(first.x)} ${r(first.y)}L${r(points[1].x)} ${r(points[1].y)}`
    let d = `M${r(first.x)} ${r(first.y)}`
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i]
        const next = points[i + 1]
        d += `Q${r(p.x)} ${r(p.y)} ${r((p.x + next.x) / 2)} ${r((p.y + next.y) / 2)}`
    }
    const last = points[points.length - 1]

    return `${d}L${r(last.x)} ${r(last.y)}`
}

/** An arrow from `tail` to `tip` (pixels): the shaft, and the head as a closed triangle `size` long. */
export function arrowPath(tail: Point, tip: Point, size: number): { shaft: string, head: string } {
    const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x)
    const length = Math.hypot(tip.x - tail.x, tip.y - tail.y)
    const s = Math.min(size, length * 0.6)
    const spread = Math.PI / 7
    const left = { x: tip.x - s * Math.cos(angle - spread), y: tip.y - s * Math.sin(angle - spread) }
    const right = { x: tip.x - s * Math.cos(angle + spread), y: tip.y - s * Math.sin(angle + spread) }
    // The shaft stops inside the head, so its round cap does not poke through the point.
    const base = { x: tip.x - s * 0.7 * Math.cos(angle), y: tip.y - s * 0.7 * Math.sin(angle) }

    return {
        shaft: `M${r(tail.x)} ${r(tail.y)}L${r(base.x)} ${r(base.y)}`,
        head: `M${r(tip.x)} ${r(tip.y)}L${r(left.x)} ${r(left.y)}L${r(right.x)} ${r(right.y)}Z`,
    }
}

/** How wide a tool draws on a picture `width` pixels wide: proportional, so marks look the same to everyone. */
export function strokeWidth(tool: 'pen' | 'arrow' | 'marker', width: number): number {
    const [share, min] = tool === 'marker' ? [0.022, 10] : tool === 'arrow' ? [0.005, 3] : [0.004, 2.5]

    return Math.max(min, width * share)
}

/** Timings of what fades, in milliseconds. */
export const FADE = {
    /** A pointer stays this long after it stops moving, then fades. */
    pointerHold: 1500,
    pointerFade: 400,
    /** A finished mark stays this long, then fades. */
    markHold: 4000,
    markFade: 800,
    /** With reduced motion a fade is a quick cross-fade, nothing that moves. */
    reduced: 120,
    /** A stroke whose author went quiet this long counts as finished. */
    strokeIdle: 5000,
}

/** Opacity of a pointer `age` ms after it last moved; 0 means it can go. */
export function pointerOpacity(age: number, reduced = false): number {
    const fade = reduced ? FADE.reduced : FADE.pointerFade
    if (age <= FADE.pointerHold) return 1

    return Math.max(0, 1 - (age - FADE.pointerHold) / fade)
}

/** Opacity of a mark `age` ms after it was finished (null: still being drawn); 0 means it can go. */
export function markOpacity(age: number | null, reduced = false): number {
    if (age === null || age <= FADE.markHold) return 1
    const fade = reduced ? FADE.reduced : FADE.markFade

    return Math.max(0, 1 - (age - FADE.markHold) / fade)
}

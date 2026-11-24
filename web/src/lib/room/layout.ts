// How the stage is laid out for 1 to 4 people (docs/design.md, "Layout of the meeting").

export interface Layout {
    mode: 'grid' | 'spotlight'
    cols: number
    rows: number
    /** Dashed "room for one more" seats drawn after the people. */
    emptySeats: number
}

/**
 * `people` counts me too; `aspect` is the stage's width / height; `spotlight` is true while
 * someone shares a screen (it takes the stage and the cameras go to a strip).
 */
export function layout(people: number, aspect: number, spotlight = false): Layout {
    const n = Math.max(1, Math.min(4, people))
    const wide = aspect >= 1

    if (spotlight) return { mode: 'spotlight', cols: 1, rows: 1, emptySeats: 0 }

    // Alone: you, and an empty seat with the invite link next to you.
    if (n === 1) return wide ? { mode: 'grid', cols: 2, rows: 1, emptySeats: 1 } : { mode: 'grid', cols: 1, rows: 2, emptySeats: 1 }
    if (n === 2) return wide ? { mode: 'grid', cols: 2, rows: 1, emptySeats: 0 } : { mode: 'grid', cols: 1, rows: 2, emptySeats: 0 }

    // Three keeps the fourth seat in view: room for one more.
    return { mode: 'grid', cols: 2, rows: 2, emptySeats: 4 - n }
}

/** Initials for a tile without video: "Ana Pop" -> "AP", "mihai" -> "M". */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (! words.length) return '?'
    const letters = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]]

    return letters.map((w) => [...w][0]?.toUpperCase() ?? '').join('')
}

/** The seat colour (0 to 3) for a participant's seat number, which keeps counting as people come and go. */
export function seatColour(seat: number): number {
    return ((seat % 4) + 4) % 4
}

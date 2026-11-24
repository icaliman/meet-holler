import { describe, expect, it } from 'vitest'
import { coordinate, decode, displayName, encode, MAX_MESSAGE_LENGTH, MAX_POINTS_PER_MESSAGE, type Message } from './protocol'

const raw = (value: unknown) => JSON.stringify(value)

describe('annotation messages', () => {
    it('round-trips every kind of message', () => {
        const messages: Message[] = [
            { v: 1, t: 'ptr', s: 'p1', x: 0.25, y: 0.75 },
            { v: 1, t: 'ptr', s: 'p1', x: null, y: null },
            { v: 1, t: 'stroke', s: 'p1', id: 3, tool: 'pen', pts: [0.1, 0.2, 0.3, 0.4], end: false },
            { v: 1, t: 'stroke', s: 'p1', id: 4, tool: 'arrow', pts: [0, 0, 1, 1], end: true },
            { v: 1, t: 'stroke', s: 'p1', id: 5, tool: 'marker', pts: [0.5, 0.5], end: true },
            { v: 1, t: 'clear', s: 'p1', all: false },
            { v: 1, t: 'clear', s: 'p1', all: true, host: true },
            { v: 1, t: 'cfg', s: 'p1', open: false },
        ]
        for (const message of messages) expect(decode(encode(message))).toEqual(message)
    })

    it('rounds coordinates to four decimals on the way out', () => {
        expect(encode({ v: 1, t: 'ptr', s: 'a', x: 0.123456789, y: 0.5 })).toBe('{"v":1,"t":"ptr","s":"a","x":0.1235,"y":0.5}')
    })

    it('clamps coordinates into the picture', () => {
        expect(decode(raw({ v: 1, t: 'ptr', s: 'a', x: -3, y: 7 }))).toEqual({ v: 1, t: 'ptr', s: 'a', x: 0, y: 1 })
        expect(decode(raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'pen', pts: [2, -1], end: true }))).toMatchObject({ pts: [1, 0] })
    })

    it('drops what is not a valid message', () => {
        const bad: unknown[] = [
            null, 42, {}, 'not json', '[]', 'null',
            raw({ v: 2, t: 'ptr', s: 'a', x: 0, y: 0 }),
            raw({ v: 1, t: 'nope', s: 'a' }),
            raw({ v: 1, t: 'ptr', x: 0, y: 0 }),
            raw({ v: 1, t: 'ptr', s: '<img src=x>', x: 0, y: 0 }),
            raw({ v: 1, t: 'ptr', s: 'a', x: '0.5', y: 0.5 }),
            raw({ v: 1, t: 'ptr', s: 'a', x: 0.5 }),
            raw({ v: 1, t: 'stroke', s: 'a', id: -1, tool: 'pen', pts: [0, 0], end: true }),
            raw({ v: 1, t: 'stroke', s: 'a', id: 1.5, tool: 'pen', pts: [0, 0], end: true }),
            raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'laser', pts: [0, 0], end: true }),
            raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'pen', pts: [0, 0, 1], end: true }),
            raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'pen', pts: [], end: true }),
            raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'pen', pts: [0, null], end: true }),
            raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'arrow', pts: [0, 0, 1, 1, 1, 1], end: true }),
            raw({ v: 1, t: 'cfg', s: 'a', open: 'yes' }),
        ]
        for (const value of bad) expect(decode(value)).toBeNull()
    })

    it('refuses oversized messages and strokes, unread', () => {
        expect(decode('x'.repeat(MAX_MESSAGE_LENGTH + 1))).toBeNull()
        const pts = Array.from({ length: (MAX_POINTS_PER_MESSAGE + 1) * 2 }, () => 0.5)
        expect(decode(raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'pen', pts, end: false }))).toBeNull()
        expect(decode(raw({ v: 1, t: 'stroke', s: 'a', id: 1, tool: 'pen', pts: pts.slice(2), end: false }))).not.toBeNull()
    })

    it('a full message of points still fits under the size cap', () => {
        const pts = Array.from({ length: MAX_POINTS_PER_MESSAGE * 2 }, () => 0.123456)
        const text = encode({ v: 1, t: 'stroke', s: 'Qm9pX3a1c2ZkQm9pX3a1c2Zk', id: 0x7fffffff, tool: 'marker', pts, end: true })
        expect(text.length).toBeLessThan(MAX_MESSAGE_LENGTH)
        expect(decode(text)).not.toBeNull()
    })

    it('ignores fields it does not know and keeps only booleans that are true', () => {
        expect(decode(raw({ v: 1, t: 'clear', s: 'a', all: 'yes', host: 1, html: '<b>' }))).toEqual({ v: 1, t: 'clear', s: 'a', all: false })
    })

    it('reads a coordinate only from a finite number', () => {
        expect(coordinate(Number.NaN)).toBeNull()
        expect(coordinate(Infinity)).toBeNull()
        expect(coordinate('1')).toBeNull()
        expect(coordinate(0.99999)).toBe(1)
    })
})

describe('names on pointer tags', () => {
    it('strips control and direction-changing characters and squeezes spaces', () => {
        expect(displayName('  Ana\n\tPop ')).toBe('Ana Pop')
        expect(displayName(`Ion${String.fromCodePoint(0x202e)}gnp.exe`)).toBe('Iongnp.exe')
        expect(displayName(`Mi${String.fromCodePoint(0x200b)}hai`)).toBe('Mihai')
    })

    it('caps long names and gives a stand-in for empty ones', () => {
        expect([...displayName('a'.repeat(80))]).toHaveLength(40)
        expect(displayName('')).toBe('Someone')
        expect(displayName('\u0000')).toBe('Someone')
        expect(displayName(undefined)).toBe('Someone')
    })

    it('leaves markup as text: the tag is rendered escaped, never as HTML', () => {
        expect(displayName('<b>Ana</b>')).toBe('<b>Ana</b>')
    })
})

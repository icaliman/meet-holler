import { describe, expect, it } from 'vitest'
import { ALPHABET, formatCode, newCode, normalizeCode } from '../worker/lib/codes'
import { hashPasscode, safeEqual, signToken, verifyPasscode, verifyToken } from '../worker/lib/crypto'

describe('meeting codes', () => {
    it('are ten characters from the unambiguous alphabet', () => {
        const codes = Array.from({ length: 500 }, newCode)

        for (const code of codes) expect(code).toMatch(new RegExp(`^[${ALPHABET}]{10}$`))
        expect(new Set(codes).size).toBe(500)
        expect(ALPHABET).not.toMatch(/[01ilo]/)
    })

    it('use every character of the alphabet', () => {
        const seen = new Set(Array.from({ length: 200 }, newCode).join(''))

        expect(seen.size).toBe(ALPHABET.length)
    })

    it('are read back from what people type', () => {
        expect(normalizeCode('ABC-DEFG-HJK')).toBe('abcdefghjk')
        expect(normalizeCode(' abc defg hjk ')).toBe('abcdefghjk')
        expect(normalizeCode('abcdefghj')).toBeNull()
        expect(normalizeCode('abcdefghjo')).toBeNull()
        expect(formatCode('abcdefghjk')).toBe('abc-defg-hjk')
    })
})

describe('passcodes', () => {
    it('hash with a random salt and verify', async () => {
        const first = await hashPasscode('tulip-42', 1000)
        const second = await hashPasscode('tulip-42', 1000)

        expect(first).not.toBe(second)
        expect(await verifyPasscode('tulip-42', first)).toBe(true)
        expect(await verifyPasscode('tulip-43', first)).toBe(false)
        expect(await verifyPasscode('tulip-42', 'plain')).toBe(false)
    })
})

describe('tokens', () => {
    it('round-trip and refuse another secret or a changed payload', async () => {
        const token = await signToken({ m: 'abcdefghjk', p: 'p1' }, 'secret')

        expect(await verifyToken(token, 'secret')).toEqual({ m: 'abcdefghjk', p: 'p1' })
        expect(await verifyToken(token, 'other')).toBeNull()
        expect(await verifyToken(`x${token}`, 'secret')).toBeNull()
        expect(await verifyToken(`${token}.x`, 'secret')).toBeNull()
    })

    it('compare in constant time', () => {
        expect(safeEqual('abc', 'abc')).toBe(true)
        expect(safeEqual('abc', 'abd')).toBe(false)
        expect(safeEqual('abc', 'abcd')).toBe(false)
    })
})

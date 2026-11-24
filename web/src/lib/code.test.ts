import { describe, expect, it } from 'vitest'
import { check, extractCode, format, hostUrl, isCode, meetingUrl, normalize } from './code'

describe('meeting codes', () => {
    it('formats as abc-defg-hij, also while typing', () => {
        expect(format('abcdefghjk')).toBe('abc-defg-hjk')
        expect(format('ABC-DEFG-HJK')).toBe('abc-defg-hjk')
        expect(format('abcd')).toBe('abc-d')
        expect(format('ab')).toBe('ab')
        expect(format('abcdefghjkmnp')).toBe('abc-defg-hjk')
    })

    it('normalizes dashes, spaces and case away', () => {
        expect(normalize(' Abc-Defg hjk ')).toBe('abcdefghjk')
    })

    it('knows a code from what is not one', () => {
        expect(isCode('abc-defg-hjk')).toBe(true)
        expect(isCode('abcdefghjk')).toBe(true)
        expect(isCode('abc-defg-hj')).toBe(false)
        expect(isCode('abc-defg-hjo')).toBe(false)
    })

    it('finds the code in a pasted link', () => {
        expect(extractCode('https://meet.xlite.dev/abc-defg-hjk')).toBe('abcdefghjk')
        expect(extractCode('https://meet.xlite.dev/abc-defg-hjk#host=secret')).toBe('abcdefghjk')
        expect(extractCode('meet.xlite.dev/abcdefghjk')).toBe('abcdefghjk')
        expect(extractCode('  abc defg hjk ')).toBe('abcdefghjk')
        expect(extractCode('https://meet.xlite.dev/')).toBeNull()
        expect(extractCode('')).toBeNull()
    })

    it('says what is wrong in words', () => {
        expect(check('')).toMatch(/Type the code/)
        expect(check('abc-defg')).toBe('A code has 10 letters and numbers. This one has 7.')
        expect(check('abc-defg-hj0')).toBe('Codes never use "0". Check the letter or number in your invite.')
        expect(check('abc-defg-h!k')).toMatch(/only has letters and numbers/)
        expect(check('abc-defg-hjk')).toBeNull()
    })

    it('builds the links people share', () => {
        expect(meetingUrl('abcdefghjk', 'https://meet.xlite.dev')).toBe('https://meet.xlite.dev/abc-defg-hjk')
        expect(hostUrl('abcdefghjk', 'k/y', 'https://meet.xlite.dev')).toBe('https://meet.xlite.dev/abc-defg-hjk#host=k%2Fy')
    })
})

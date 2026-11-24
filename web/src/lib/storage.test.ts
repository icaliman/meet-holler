import { beforeEach, describe, expect, it } from 'vitest'
import { forgetHostKey, hostKeyFor, rememberHostKey, takeHostFragment } from './storage'

describe('a host link', () => {
    beforeEach(() => {
        localStorage.clear()
        history.replaceState(null, '', '/')
    })

    it('hands over its key and leaves the address bar, without storing anything', () => {
        rememberHostKey('abcdefghjk', 'the-real-key')
        history.replaceState(null, '', '/m/abc-defg-hjk?x=1#host=from%2Fa-link')

        expect(takeHostFragment()).toBe('from/a-link')
        expect(location.hash).toBe('')
        expect(location.pathname + location.search).toBe('/m/abc-defg-hjk?x=1')
        // A link is a claim until the server has checked it: the key this browser already has stays.
        expect(hostKeyFor('abcdefghjk')).toBe('the-real-key')
    })

    it('is nothing when there is no key in it, or one that cannot be read', () => {
        expect(takeHostFragment()).toBeNull()

        history.replaceState(null, '', '/m/abc-defg-hjk#main')
        expect(takeHostFragment()).toBeNull()
        expect(location.hash).toBe('#main')

        history.replaceState(null, '', '/m/abc-defg-hjk#host=%E0%A4%A')
        expect(takeHostFragment()).toBeNull()
        expect(location.hash).toBe('')

        history.replaceState(null, '', `/m/abc-defg-hjk#host=${'k'.repeat(500)}`)
        expect(takeHostFragment()).toBeNull()
    })

    it('can be forgotten for one meeting', () => {
        rememberHostKey('abcdefghjk', 'one')
        rememberHostKey('zzzzzzzzzz', 'two')
        forgetHostKey('abcdefghjk')

        expect(hostKeyFor('abcdefghjk')).toBeNull()
        expect(hostKeyFor('zzzzzzzzzz')).toBe('two')
    })
})

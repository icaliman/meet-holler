import { describe, expect, it } from 'vitest'
import { PASSCODE_MAX_FAILURES } from '../worker/lib/timing'
import { createMeeting, join, row } from './helpers'

describe('wrong passcodes', () => {
    it('stop at ten however many guesses arrive at the same moment', async () => {
        const { code } = await createMeeting({ visibility: 'private', passcode: 'tulip-42' })

        const guesses = await Promise.all(Array.from({ length: 30 }, (_, i) => join(code, { passcode: `guess-${i}` })))
        expect(guesses.filter((g) => g.body.error.code === 'passcode_wrong')).toHaveLength(PASSCODE_MAX_FAILURES)
        expect(guesses.filter((g) => g.status === 429)).toHaveLength(30 - PASSCODE_MAX_FAILURES)

        expect((await join(code, { passcode: 'tulip-42' })).status).toBe(429)
        expect((await row('SELECT pass_failures FROM meetings WHERE code = ?', code)).pass_failures).toBe(PASSCODE_MAX_FAILURES)
    })

    it('are not what a right passcode counts as, even when the join then fails', async () => {
        const { code } = await createMeeting({ visibility: 'private', passcode: 'tulip-42' })

        // Four get in, the rest are told the meeting is full: none of them guessed wrong.
        const results = await Promise.all(Array.from({ length: 8 }, () => join(code, { passcode: 'tulip-42' })))
        expect(results.filter((r) => r.status === 201)).toHaveLength(4)
        expect(results.filter((r) => r.body?.error?.code === 'full')).toHaveLength(4)
        for (let i = 0; i < 12; i++) expect((await join(code, { passcode: 'tulip-42' })).body.error.code).toBe('full')
        expect((await row('SELECT pass_failures FROM meetings WHERE code = ?', code)).pass_failures).toBe(0)

        expect((await join(code, { passcode: 'nope' })).body.error.code).toBe('passcode_wrong')
        expect((await row('SELECT pass_failures FROM meetings WHERE code = ?', code)).pass_failures).toBe(1)
    })
})

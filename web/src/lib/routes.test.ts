import { describe, expect, it } from 'vitest'
import { match } from './routes'

describe('routes', () => {
    it('maps paths to pages', () => {
        expect(match('/')).toEqual({ name: 'home' })
        expect(match('/abc-defg-hjk')).toEqual({ name: 'meeting', code: 'abcdefghjk' })
        expect(match('/ABCDEFGHJK')).toEqual({ name: 'meeting', code: 'abcdefghjk' })
        expect(match('/abc-defg-hjk/ready')).toEqual({ name: 'ready', code: 'abcdefghjk' })
        expect(match('/abc-defg-hjk/other')).toEqual({ name: 'missing' })
        expect(match('/about')).toEqual({ name: 'missing' })
    })
})

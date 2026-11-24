import { describe, expect, it } from 'vitest'
import { durationLabel, suggestPasscode, toInput, validate, type ScheduleValues } from './schedule'

const now = new Date(2026, 10, 24, 10, 0)
const base: ScheduleValues = {
    title: '',
    date: '2026-11-25',
    time: '14:30',
    durationMin: 30,
    visibility: 'public',
    passcode: '',
    waitingRoom: false,
    hostName: '',
}

describe('schedule form rules', () => {
    it('accepts a time in the future', () => {
        expect(validate(base, now)).toEqual({})
    })

    it('refuses a missing or past time, in words', () => {
        expect(validate({ ...base, time: '' }, now).when).toBe('Pick a date and a time.')
        expect(validate({ ...base, date: '2026-11-23' }, now).when).toMatch(/already passed/)
    })

    it('asks a private meeting for a passcode of 4 or more', () => {
        expect(validate({ ...base, visibility: 'private' }, now).passcode).toMatch(/needs a passcode/)
        expect(validate({ ...base, visibility: 'private', passcode: '12' }, now).passcode).toMatch(/at least 4/)
        expect(validate({ ...base, visibility: 'private', passcode: '1234' }, now)).toEqual({})
    })

    it('builds the API body, leaving out what is empty', () => {
        const input = toInput({ ...base, title: '  Sync ', visibility: 'private', passcode: ' 4321 ', waitingRoom: true })
        expect(input).toMatchObject({ title: 'Sync', visibility: 'private', passcode: '4321', waitingRoom: true, durationMin: 30 })
        expect(input.scheduledAt).toBe(new Date(2026, 10, 25, 14, 30).toISOString())
        expect(toInput(base).title).toBeUndefined()
        expect(toInput(base).passcode).toBeUndefined()
    })

    it('suggests six digit passcodes', () => {
        expect(suggestPasscode(() => 0)).toBe('100000')
        expect(suggestPasscode(() => 0.999999)).toMatch(/^\d{6}$/)
    })

    it('labels durations', () => {
        expect(durationLabel(45)).toBe('45 minutes')
        expect(durationLabel(60)).toBe('1 hour')
        expect(durationLabel(90)).toBe('1 h 30 min')
        expect(durationLabel(120)).toBe('2 hours')
    })
})

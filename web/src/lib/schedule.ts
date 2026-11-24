// The schedule form's rules, apart from the component so they can be tested.

import type { CreateMeetingInput, Visibility } from './types'
import { fromInputs } from './time'

export interface ScheduleValues {
    title: string
    date: string
    time: string
    durationMin: number
    visibility: Visibility
    passcode: string
    waitingRoom: boolean
    hostName: string
}

export type ScheduleErrors = Partial<Record<'title' | 'when' | 'passcode', string>>

export const DURATIONS = [15, 30, 45, 60, 90, 120]

export function validate(values: ScheduleValues, now: Date = new Date()): ScheduleErrors {
    const errors: ScheduleErrors = {}
    const when = fromInputs(values.date, values.time)

    if (values.title.trim().length > 80) errors.title = 'Keep the title under 80 characters.'
    if (! when) errors.when = 'Pick a date and a time.'
    else if (when.getTime() < now.getTime() - 60_000) errors.when = 'That time has already passed. Pick a time from now on.'
    else if (when.getTime() > now.getTime() + 366 * 86400_000) errors.when = 'Pick a date within the next year.'

    if (values.visibility === 'private') {
        const code = values.passcode.trim()
        if (! code) errors.passcode = 'A private meeting needs a passcode. Make one up, or use the suggested one.'
        else if (code.length < 4) errors.passcode = 'Use at least 4 characters, so it is hard to guess.'
        else if (code.length > 32) errors.passcode = 'Keep it under 32 characters.'
    }

    return errors
}

export function toInput(values: ScheduleValues): CreateMeetingInput {
    const when = fromInputs(values.date, values.time)

    return {
        title: values.title.trim() || undefined,
        visibility: values.visibility,
        passcode: values.visibility === 'private' ? values.passcode.trim() : undefined,
        waitingRoom: values.waitingRoom,
        scheduledAt: when?.toISOString(),
        durationMin: values.durationMin,
        hostName: values.hostName.trim() || undefined,
    }
}

/** A number in [0, 1) from the browser's cryptographic source: a passcode is a secret, and Math.random can be predicted. */
function secureRandom(): number {
    return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
}

/** A passcode that is easy to read out: six digits, no leading zero. */
export function suggestPasscode(random: () => number = secureRandom): string {
    return String(100000 + Math.floor(random() * 900000))
}

export function durationLabel(min: number): string {
    if (min < 60) return `${min} minutes`
    const h = Math.floor(min / 60)
    const m = min % 60

    return m ? `${h} h ${m} min` : `${h} hour${h > 1 ? 's' : ''}`
}

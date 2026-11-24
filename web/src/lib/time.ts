// Dates and countdowns, in the words the UI uses.

export interface Remaining {
    total: number
    days: number
    hours: number
    minutes: number
    seconds: number
}

export function remaining(target: Date | string, now: Date | number = Date.now()): Remaining {
    const total = Math.max(0, new Date(target).getTime() - new Date(now).getTime())
    const s = Math.floor(total / 1000)

    return {
        total,
        days: Math.floor(s / 86400),
        hours: Math.floor((s % 86400) / 3600),
        minutes: Math.floor((s % 3600) / 60),
        seconds: s % 60,
    }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "12 minutes", "3 hours and 5 minutes", "2 days": for "This meeting opens in …". */
export function inWords(r: Remaining): string {
    if (r.days > 0) return r.hours > 0 && r.days < 3 ? `${plural(r.days, 'day')} and ${plural(r.hours, 'hour')}` : plural(r.days, 'day')
    if (r.hours > 0) return r.minutes > 0 ? `${plural(r.hours, 'hour')} and ${plural(r.minutes, 'minute')}` : plural(r.hours, 'hour')
    if (r.minutes > 0) return plural(r.minutes + (r.seconds > 0 ? 1 : 0), 'minute')
    if (r.seconds > 0) return 'less than a minute'

    return 'a moment'
}

/** "Tuesday, 25 November at 14:30", in the reader's own locale and time zone. */
export function longDate(value: string | Date, locale?: string): string {
    const date = new Date(value)
    const day = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

    return `${day} at ${time}`
}

/** The reader's time zone, for "Times are in Europe/Bucharest". */
export function timeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone'
    } catch {
        return 'your time zone'
    }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** yyyy-mm-dd for an `<input type="date">`, in local time. */
export function dateInputValue(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** hh:mm for an `<input type="time">`, in local time. */
export function timeInputValue(date: Date): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A local date and time from the two inputs, or null when either is missing or invalid. */
export function fromInputs(date: string, time: string): Date | null {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    const t = /^(\d{2}):(\d{2})$/.exec(time)
    if (! d || ! t) return null
    const result = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]))

    return Number.isNaN(result.getTime()) ? null : result
}

/** The next half hour from now that is at least 15 minutes away: a sensible default for the schedule form. */
export function nextSlot(now: Date = new Date()): Date {
    const slot = new Date(now)
    slot.setSeconds(0, 0)
    slot.setMinutes(slot.getMinutes() < 30 ? 30 : 60)
    if (slot.getTime() - now.getTime() < 15 * 60 * 1000) slot.setMinutes(slot.getMinutes() + 30)

    return slot
}

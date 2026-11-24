import { formatCode } from '../lib/codes'
import type { MeetingRow } from './model'

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** RFC 5545 text: backslash, semicolon, comma and newlines escaped. */
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 octets are folded: CRLF and a space. */
function fold(line: string): string {
    const bytes = new TextEncoder().encode(line)
    if (bytes.length <= 75) return line

    const parts: string[] = []
    let current = ''
    let size = 0
    for (const char of line) {
        const length = new TextEncoder().encode(char).length
        if (size + length > (parts.length ? 74 : 75)) {
            parts.push(current)
            current = ''
            size = 0
        }
        current += char
        size += length
    }
    parts.push(current)

    return parts.join('\r\n ')
}

/**
 * A calendar file for a scheduled meeting. Never carries the passcode, and
 * with `withheld` (a private meeting, asked for with only the link) neither
 * the title nor the host's name.
 */
export function meetingIcs(meeting: MeetingRow, origin: string, now: number, withheld = false): string {
    const start = meeting.scheduled_at ?? now
    const end = start + (meeting.duration_min ?? 60) * 60_000
    const link = `${origin}/m/${formatCode(meeting.code)}`
    const title = withheld ? 'Private meeting' : meeting.title ?? 'Meeting'
    const description = [
        `Join: ${link}`,
        `Code: ${formatCode(meeting.code)}`,
        meeting.visibility === 'private' ? 'A passcode is needed: ask the host.' : null,
        meeting.host_name && ! withheld ? `Host: ${meeting.host_name}` : null,
    ].filter(Boolean).join('\n')

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//meet-holler//meetings//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${meeting.code}@meet-holler`,
        `DTSTAMP:${stamp(now)}`,
        `DTSTART:${stamp(start)}`,
        `DTEND:${stamp(end)}`,
        `SUMMARY:${escape(title)}`,
        `DESCRIPTION:${escape(description)}`,
        `URL:${link}`,
        `LOCATION:${escape(link)}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ]

    return lines.map(fold).join('\r\n') + '\r\n'
}

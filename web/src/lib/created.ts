// What this tab just created, for the "ready" page: the passcode is never sent back by the
// API, so the page that made the meeting keeps it to show once. Session storage, so a
// reload of the ready page still has it, and closing the tab forgets it.

import type { Meeting } from './types'

export interface Created {
    meeting: Meeting
    passcode: string | null
}

const KEY = 'holler:created'

export function rememberCreated(created: Created): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(created))
    } catch {
        // Storage is off: the ready page will just not show the passcode.
    }
}

export function createdFor(code: string): Created | null {
    try {
        const value = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Created | null

        return value?.meeting.code === code ? value : null
    } catch {
        return null
    }
}

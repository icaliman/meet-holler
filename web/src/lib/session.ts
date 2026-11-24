// The participant this tab is in a meeting as: the token from /join, kept in sessionStorage
// so a reload stays the same person and every tab is its own participant (docs/api.md, Auth).

import type { Participant } from './types'

export interface Session {
    token: string
    participant: Participant
}

const key = (code: string) => `holler:session:${code}`

export function sessionFor(code: string): Session | null {
    try {
        const value = JSON.parse(sessionStorage.getItem(key(code)) ?? 'null') as Session | null

        return value?.token ? value : null
    } catch {
        return null
    }
}

export function rememberSession(code: string, session: Session): void {
    try {
        sessionStorage.setItem(key(code), JSON.stringify(session))
    } catch {
        // Storage is off: a reload asks to join again.
    }
}

export function forgetSession(code: string): void {
    try {
        sessionStorage.removeItem(key(code))
    } catch {
        // Nothing to forget.
    }
}

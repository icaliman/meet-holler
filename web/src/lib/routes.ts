// The app's pages, from a path. Pure, so it is easy to test; router.svelte.ts keeps it current.

import { isCode, normalize } from './code'

export type Route =
    | { name: 'home' }
    | { name: 'ready', code: string }
    | { name: 'meeting', code: string }
    | { name: 'missing' }

export function match(pathname: string): Route {
    let parts = pathname.split('/').filter(Boolean)
    if (parts.length === 0) return { name: 'home' }
    // /m/abc-defg-hjk is the same meeting (the Worker's .ics links use it).
    if (parts[0] === 'm' && parts.length > 1) parts = parts.slice(1)

    if (isCode(parts[0])) {
        const code = normalize(parts[0])
        if (parts.length === 1) return { name: 'meeting', code }
        if (parts.length === 2 && parts[1] === 'ready') return { name: 'ready', code }
    }

    return { name: 'missing' }
}

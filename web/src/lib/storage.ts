// What this browser remembers, and nothing else: the host keys of meetings made here,
// the name you join with, and the devices you picked. Every access is guarded, since
// storage can be missing or throw (private windows, blocked site data).

const HOST_KEYS = 'holler:host-keys'
const NAME = 'holler:name'
const THEME = 'holler:theme'

function read<T>(key: string, fallback: T): T {
    try {
        const raw = globalThis.localStorage?.getItem(key)

        return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T)
    } catch {
        return fallback
    }
}

function write(key: string, value: unknown): void {
    try {
        if (value === null || value === undefined) globalThis.localStorage?.removeItem(key)
        else globalThis.localStorage?.setItem(key, JSON.stringify(value))
    } catch {
        // Storage is off: the app still works, it just forgets.
    }
}

export function hostKeyFor(code: string): string | null {
    return read<Record<string, string>>(HOST_KEYS, {})[code] ?? null
}

export function rememberHostKey(code: string, hostKey: string): void {
    const keys = read<Record<string, string>>(HOST_KEYS, {})
    keys[code] = hostKey
    // Keep the newest 50: an old meeting's key is of no use once it has ended.
    const entries = Object.entries(keys).slice(-50)
    write(HOST_KEYS, Object.fromEntries(entries))
}

export function savedName(): string {
    return read<string>(NAME, '')
}

export function rememberName(name: string): void {
    write(NAME, name.trim() || null)
}

export type ThemeChoice = 'auto' | 'light' | 'dark'

export function savedTheme(): ThemeChoice {
    const value = read<string>(THEME, 'auto')

    return value === 'light' || value === 'dark' ? value : 'auto'
}

export function rememberTheme(theme: ThemeChoice): void {
    write(THEME, theme === 'auto' ? null : theme)
}

/** A `#host=<key>` fragment from a host link: remembered, then taken out of the address bar. */
export function claimHostFragment(code: string, location: Location = globalThis.location): boolean {
    const match = /(?:^#|&)host=([^&]+)/.exec(location?.hash ?? '')
    if (! match) return false

    rememberHostKey(code, decodeURIComponent(match[1]))
    try {
        history.replaceState(history.state, '', location.pathname + location.search)
    } catch {
        // Not in a browser: nothing to tidy.
    }

    return true
}

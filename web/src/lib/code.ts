// Meeting codes: ten characters from an alphabet without look-alikes (no 0/o/1/l/i),
// shown as abc-defg-hij; the dashes are cosmetic and optional on input.

export const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const CODE_LENGTH = 10

const allowed = new Set(CODE_ALPHABET)

/** The bare code: lowercase, without dashes or spaces. Look-alikes stay in, so `check()` can name them. */
export function normalize(input: string): string {
    return input.toLowerCase().replace(/[\s\-_.]/g, '')
}

/** abc-defg-hij, also for a code that is not complete yet (as someone types). */
export function format(input: string): string {
    const bare = normalize(input).slice(0, CODE_LENGTH)
    const parts = [bare.slice(0, 3), bare.slice(3, 7), bare.slice(7, 10)].filter(Boolean)

    return parts.join('-')
}

export function isCode(input: string): boolean {
    const bare = normalize(input)

    return bare.length === CODE_LENGTH && [...bare].every((c) => allowed.has(c))
}

/**
 * What someone pasted or typed into "Join with a code": a code, with or without dashes,
 * or a whole meeting link (https://meet.xlite.dev/abc-defg-hij). Returns the bare code,
 * or null when there is none in it.
 */
export function extractCode(input: string): string | null {
    const text = input.trim()
    if (! text) return null

    let candidate = text
    if (/^https?:\/\//i.test(text) || text.includes('/')) {
        try {
            const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, 'x.invalid/')}`)
            candidate = url.pathname.split('/').filter(Boolean)[0] ?? ''
        } catch {
            return null
        }
    }

    return isCode(candidate) ? normalize(candidate) : null
}

/** Why a typed code is not a code, in words; null when it is one. */
export function check(input: string): string | null {
    const text = input.trim()
    if (! text) return 'Type the code from your invite, or paste the link.'
    if (extractCode(text)) return null

    const bare = normalize(text.includes('/') ? (text.split('/').filter(Boolean).pop() ?? '') : text)
    const odd = [...new Set([...bare].filter((c) => ! allowed.has(c)))]
    if (odd.length) {
        const lookAlikes = odd.filter((c) => '01oli'.includes(c))
        if (lookAlikes.length === odd.length) {
            return `Codes never use ${lookAlikes.map((c) => `"${c}"`).join(' or ')}. Check the letter or number in your invite.`
        }

        return 'A code only has letters and numbers. Check it against your invite.'
    }

    return `A code has ${CODE_LENGTH} letters and numbers. This one has ${bare.length}.`
}

/** The link people share: https://meet.xlite.dev/abc-defg-hij */
export function meetingUrl(code: string, origin = globalThis.location?.origin ?? ''): string {
    return `${origin}/${format(code)}`
}

/** The link that makes whoever opens it the host, from any device: the key is in the fragment, so it never reaches a server log. */
export function hostUrl(code: string, hostKey: string, origin = globalThis.location?.origin ?? ''): string {
    return `${meetingUrl(code, origin)}#host=${encodeURIComponent(hostKey)}`
}

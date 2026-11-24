/** No 0/o, 1/l/i: a code read aloud or copied by hand survives. */
export const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const CODE_LENGTH = 10

const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`)
// The largest multiple of the alphabet's length under 256: bytes above it are
// thrown away, so every character is equally likely.
const LIMIT = 256 - (256 % ALPHABET.length)

/** A new meeting code, crypto-random (about 49.5 bits). */
export function newCode(): string {
    let code = ''
    while (code.length < CODE_LENGTH) {
        for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
            if (byte >= LIMIT) continue
            code += ALPHABET[byte % ALPHABET.length]
            if (code.length === CODE_LENGTH) break
        }
    }

    return code
}

/** The code as stored, from what someone typed or pasted (dashes, spaces, any case), or null. */
export function normalizeCode(input: string): string | null {
    const code = input.toLowerCase().replace(/[\s-]/g, '')

    return CODE_PATTERN.test(code) ? code : null
}

/** abc-defg-hjk, for people. */
export function formatCode(code: string): string {
    return `${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7)}`
}

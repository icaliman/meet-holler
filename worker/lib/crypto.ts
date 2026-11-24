const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64url(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array | null {
    if (! /^[A-Za-z0-9_-]*$/.test(text)) return null
    try {
        const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
        return Uint8Array.from(binary, (char) => char.charCodeAt(0))
    } catch {
        return null
    }
}

export function randomToken(bytes: number): string {
    return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Hex(text: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))

    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compares two strings without leaking where they differ through timing. */
export function safeEqual(a: string, b: string): boolean {
    const left = encoder.encode(a)
    const right = encoder.encode(b)
    let diff = left.length ^ right.length
    for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)

    return diff === 0
}

// ---- passcodes ---------------------------------------------------------------

/**
 * PBKDF2-SHA256 iterations. The free plan gives a request 10 ms of CPU and
 * 100k iterations take about 12 ms; wrong guesses are also capped per meeting
 * (see meetings/passcode.ts), which is what really stops a guesser.
 */
export const PASSCODE_ITERATIONS = 30_000

async function pbkdf2(passcode: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)

    return new Uint8Array(bits)
}

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, never the passcode itself. */
export async function hashPasscode(passcode: string, iterations = PASSCODE_ITERATIONS): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const hash = await pbkdf2(passcode, salt, iterations)

    return `pbkdf2-sha256$${iterations}$${base64url(salt)}$${base64url(hash)}`
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
    const [scheme, iterations, salt, hash] = stored.split('$')
    const saltBytes = fromBase64url(salt ?? '')
    if (scheme !== 'pbkdf2-sha256' || ! saltBytes || ! hash || ! Number(iterations)) return false

    return safeEqual(base64url(await pbkdf2(passcode, saltBytes, Number(iterations))), hash)
}

// ---- participant tokens ------------------------------------------------------

export type TokenClaims = { m: string, p: string }

/**
 * A token works for a day. The participant's record is what really decides
 * (left, removed and forgotten people are refused whatever their token says);
 * the expiry bounds what a token copied out of a browser is worth, and no
 * meeting of four lasts a day. Someone still there after that joins again.
 */
export const TOKEN_TTL_MS = 24 * 60 * 60_000

const MIN_SECRET_LENGTH = 32
/** The value in .dev.vars.example: fine on a laptop, never a secret. */
const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string'

/**
 * SESSION_SECRET signs every token, so a missing or guessable one is every
 * participant and every host of every meeting. Without this check a Worker
 * deployed without the secret would sign with the text "undefined".
 */
function assertSecret(secret: unknown): asserts secret is string {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH || secret === PLACEHOLDER_SECRET) {
        throw new Error(`SESSION_SECRET is missing, too short or still the example value: set a random secret of at least ${MIN_SECRET_LENGTH} characters (wrangler secret put SESSION_SECRET).`)
    }
}

const keys = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string): Promise<CryptoKey> {
    assertSecret(secret)
    let key = keys.get(secret)
    if (! key) {
        key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
        keys.set(secret, key)
    }

    return key
}

/**
 * `<payload>.<signature>`, both base64url: the meeting, the participant and
 * when it expires (`x`, seconds), signed with SESSION_SECRET. No role: that is
 * read from the participant's record on every request.
 */
export async function signToken(claims: TokenClaims, secret: string, now = Date.now()): Promise<string> {
    const payload = base64url(encoder.encode(JSON.stringify({ m: claims.m, p: claims.p, x: Math.floor((now + TOKEN_TTL_MS) / 1000) })))
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)))

    return `${payload}.${base64url(signature)}`
}

/** The claims of a token that is signed by us and has not expired; null for anything else. */
export async function verifyToken(token: string, secret: string, now = Date.now()): Promise<TokenClaims | null> {
    assertSecret(secret)
    const [payload, signature, extra] = token.split('.')
    if (! payload || ! signature || extra !== undefined) return null

    const signatureBytes = fromBase64url(signature)
    if (! signatureBytes) return null
    if (! await crypto.subtle.verify('HMAC', await hmacKey(secret), signatureBytes, encoder.encode(payload))) return null

    try {
        const bytes = fromBase64url(payload)
        const claims = bytes ? JSON.parse(decoder.decode(bytes)) : null
        if (typeof claims?.m !== 'string' || typeof claims?.p !== 'string') return null
        // An expiry we would have issued: a whole number of seconds, not passed, not further away than a token lives.
        if (! Number.isSafeInteger(claims.x) || claims.x * 1000 <= now || claims.x * 1000 > now + TOKEN_TTL_MS + 60_000) return null

        return { m: claims.m, p: claims.p }
    } catch {
        return null
    }
}

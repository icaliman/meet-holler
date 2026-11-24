import type { Context } from 'hono'
import { invalid } from './errors'

/**
 * The JSON body as an object; `invalid` for anything else, and for JSON sent
 * as another content type: only `application/json` makes a browser ask before
 * it lets another site send the request (lib/security.ts).
 */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
    if (! /^application\/json\s*(;|$)/i.test(c.req.header('Content-Type') ?? '')) throw invalid('Send the body as application/json.')

    let body: unknown
    try {
        body = await c.req.json()
    } catch {
        throw invalid('The request body must be JSON.')
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalid('The request body must be a JSON object.')

    return body as Record<string, unknown>
}

/**
 * Characters that show nothing but change what the text around them looks
 * like or lets it hide: direction overrides and isolates (a name that reads
 * backwards, or swallows the label next to it), zero-width spaces and joiners
 * of words, soft hyphens, fillers that render as blanks, and the tag
 * characters. Kept: the zero-width joiner and non-joiner (Persian, Indic
 * scripts and emoji need them) and variation selectors (emoji).
 */
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb]|[\u{e0000}-\u{e0fff}]/gu
/** What is left of a text that shows nothing: joiners, variation selectors, spaces. */
const SHOWS_NOTHING = /^[\u200c\u200d\ufe00-\ufe0f\s]*$/u

/**
 * Text people typed, as it is stored and shown to others: control characters
 * become spaces, invisible formatting goes, whitespace is collapsed and
 * trimmed, and the result is composed (NFC) so the same name is the same
 * text. A text that would show nothing is empty.
 */
export function clean(value: string): string {
    const text = value
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(INVISIBLE, '')
        .replace(/\s+/g, ' ')
        .trim()
        .normalize('NFC')

    return SHOWS_NOTHING.test(text) ? '' : text
}

export function optionalText(body: Record<string, unknown>, field: string, max: number): string | null {
    const value = body[field]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') throw invalid(`${field} must be text.`)
    const text = clean(value)
    if (text.length > max) throw invalid(`${field} can be at most ${max} characters.`)

    return text === '' ? null : text
}

export function requiredText(body: Record<string, unknown>, field: string, max: number, label = field): string {
    const text = optionalText(body, field, max)
    if (text === null) throw invalid(`${label} is required.`)

    return text
}

export function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
    const value = body[field]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'boolean') throw invalid(`${field} must be true or false.`)

    return value
}

/** No passcode is longer than 64 characters and no hostKey than 32: anything past this is not one, and is not worth hashing. */
export const MAX_SECRET_LENGTH = 128

/** A secret typed by a person: kept as typed (no trimming inside), only the ends trimmed. */
export function optionalSecret(body: Record<string, unknown>, field: string, max = MAX_SECRET_LENGTH): string | null {
    const value = body[field]
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string') throw invalid(`${field} must be text.`)
    const secret = value.trim()
    if (secret.length > max) throw invalid(`${field} can be at most ${max} characters.`)

    return secret || null
}

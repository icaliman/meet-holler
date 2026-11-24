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

/** Control characters out, whitespace collapsed and trimmed. */
function clean(value: string): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
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

/** A secret typed by a person: kept as typed (no trimming inside), only the ends trimmed. */
export function optionalSecret(body: Record<string, unknown>, field: string): string | null {
    const value = body[field]
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string') throw invalid(`${field} must be text.`)

    return value.trim() || null
}

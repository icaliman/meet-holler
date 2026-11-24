// The one typed client for the Worker's JSON API (docs/ARCHITECTURE.md, "HTTP API").
// Every screen goes through it; nothing else calls fetch on /api.

import type {
    CreateMeetingInput,
    CreatedMeeting,
    ErrorCode,
    JoinInput,
    JoinResult,
    Meeting,
    MeetingPatch,
    Participant,
    WaitingGuest,
} from './types'

/** A failed request: `code` is the API's word for it (`network` when the request never got an answer). */
export class ApiError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly status = 0,
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

type Fetch = typeof fetch

export interface ApiOptions {
    base?: string
    fetch?: Fetch
}

export function createApi({ base = '', fetch: fetchFn }: ApiOptions = {}) {
    const doFetch: Fetch = fetchFn ?? ((...args) => globalThis.fetch(...args))

    async function request<T>(method: string, path: string, { body, token }: { body?: unknown, token?: string } = {}): Promise<T> {
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        if (token) headers.Authorization = `Bearer ${token}`

        let response: Response
        try {
            response = await doFetch(`${base}${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
            })
        } catch {
            throw new ApiError('network', 'We could not reach the server. Check your connection and try again.')
        }

        const text = await response.text()
        let data: any = null
        try {
            data = text ? JSON.parse(text) : null
        } catch {
            data = null
        }

        if (! response.ok) {
            const code = (data?.error?.code as ErrorCode | undefined) ?? fallbackCode(response.status)
            throw new ApiError(code, data?.error?.message ?? `Request failed (${response.status}).`, response.status)
        }

        return data as T
    }

    const m = (code: string) => `/api/meetings/${encodeURIComponent(code)}`

    return {
        createMeeting: (input: CreateMeetingInput) => request<CreatedMeeting>('POST', '/api/meetings', { body: input }),
        getMeeting: (code: string) => request<Meeting>('GET', m(code)),
        icsUrl: (code: string) => `${base}${m(code)}.ics`,
        join: (code: string, input: JoinInput) => request<JoinResult>('POST', `${m(code)}/join`, { body: input }),
        me: (code: string, token: string) => request<Participant>('GET', `${m(code)}/me`, { token }),
        waiting: (code: string, token: string) => request<WaitingGuest[]>('GET', `${m(code)}/waiting`, { token }),
        admit: (code: string, id: string, token: string) => request<unknown>('POST', `${m(code)}/waiting/${encodeURIComponent(id)}/admit`, { token }),
        deny: (code: string, id: string, token: string) => request<unknown>('POST', `${m(code)}/waiting/${encodeURIComponent(id)}/deny`, { token }),
        update: (code: string, patch: MeetingPatch, token: string) => request<Meeting>('PATCH', m(code), { body: patch, token }),
        end: (code: string, token: string) => request<unknown>('POST', `${m(code)}/end`, { token }),
        remove: (code: string, id: string, token: string) => request<unknown>('POST', `${m(code)}/remove/${encodeURIComponent(id)}`, { token }),
    }
}

function fallbackCode(status: number): ErrorCode {
    if (status === 404) return 'not_found'
    if (status === 403 || status === 401) return 'forbidden'
    if (status === 410) return 'ended'
    if (status === 429) return 'rate_limited'
    if (status === 409) return 'full'

    return 'invalid'
}

export type Api = ReturnType<typeof createApi>

export const api = createApi()

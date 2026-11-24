// The one typed client for the Worker's JSON API (docs/ARCHITECTURE.md, "HTTP API").
// Every screen goes through it; nothing else calls fetch on /api.

import type {
    CreateMeetingInput,
    CreatedMeeting,
    ErrorCode,
    JoinInput,
    JoinResult,
    Me,
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

/** Who a host route is for: the host's participant token, or the host key itself (a page that has not joined). */
export type HostAuth = string | { hostKey: string }

export interface ApiOptions {
    base?: string
    fetch?: Fetch
}

export function createApi({ base = '', fetch: fetchFn }: ApiOptions = {}) {
    const doFetch: Fetch = fetchFn ?? ((...args) => globalThis.fetch(...args))

    async function request<T>(method: string, path: string, { body, token }: { body?: unknown, token?: HostAuth } = {}): Promise<T> {
        const headers: Record<string, string> = { Accept: 'application/json' }
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        if (typeof token === 'string') headers.Authorization = `Bearer ${token}`
        else if (token?.hostKey) headers['X-Host-Key'] = token.hostKey

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
        me: (code: string, token: string) => request<Me>('GET', `${m(code)}/me`, { token }),
        waiting: (code: string, auth: HostAuth) => request<WaitingGuest[]>('GET', `${m(code)}/waiting`, { token: auth }),
        admit: (code: string, id: string, auth: HostAuth) => request<{ participant: Participant }>('POST', `${m(code)}/waiting/${encodeURIComponent(id)}/admit`, { token: auth }),
        deny: (code: string, id: string, auth: HostAuth) => request<{ participant: Participant }>('POST', `${m(code)}/waiting/${encodeURIComponent(id)}/deny`, { token: auth }),
        update: (code: string, patch: MeetingPatch, auth: HostAuth) => request<{ meeting: Meeting }>('PATCH', m(code), { body: patch, token: auth }),
        end: (code: string, auth: HostAuth) => request<{ meeting: Meeting }>('POST', `${m(code)}/end`, { token: auth }),
        remove: (code: string, id: string, auth: HostAuth) => request<{ participant: Participant }>('POST', `${m(code)}/remove/${encodeURIComponent(id)}`, { token: auth }),
    }
}

function fallbackCode(status: number): ErrorCode {
    if (status === 404) return 'not_found'
    if (status === 403 || status === 401) return 'forbidden'
    if (status === 410) return 'ended'
    if (status === 423) return 'locked'
    if (status === 429) return 'rate_limited'

    return 'invalid'
}

export type Api = ReturnType<typeof createApi>

export const api = createApi()

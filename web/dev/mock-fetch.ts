// A fetch that answers from a MockStore in the same process: for tests.

import type { MockStore } from './mock-store'

export function mockFetch(store: MockStore): typeof fetch {
    return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(String(input), 'http://localhost')
        const headers: Record<string, string> = {}
        new Headers(init.headers).forEach((value, key) => { headers[key] = value })
        let body: any = null
        if (typeof init.body === 'string') body = JSON.parse(init.body)
        else if (init.body instanceof FormData) body = Object.fromEntries(init.body as any)

        const response = store.handle({ method: init.method ?? 'GET', path: url.pathname, query: url.searchParams, headers, body })
        const text = response.text ?? JSON.stringify(response.body ?? {})

        return new Response(text, { status: response.status, headers: response.headers })
    }) as typeof fetch
}

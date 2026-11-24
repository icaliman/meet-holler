// A Vite plugin that answers /api/* from MockStore during `npm run dev`, with a little latency
// so busy states are visible. Never part of the build.

import type { Plugin } from 'vite'
import { MockStore, type MockRequest } from './mock-store'

export function mockApi({ latency = 250 }: { latency?: number } = {}): Plugin {
    const store = new MockStore()

    return {
        name: 'meet-holler-mock-api',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url ?? '/', 'http://localhost')
                if (! url.pathname.startsWith('/api/')) return next()

                const raw = await new Promise<string>((resolve) => {
                    let data = ''
                    req.on('data', (chunk) => { data += chunk })
                    req.on('end', () => resolve(data))
                })
                let body: any = null
                const type = String(req.headers['content-type'] ?? '')
                try {
                    if (type.includes('application/json') && raw) body = JSON.parse(raw)
                    else if (raw) body = Object.fromEntries(new URLSearchParams(raw))
                } catch {
                    body = null
                }
                // A multipart beacon (the leave route): pick the plain fields out of it.
                if (type.includes('multipart/form-data') && raw) {
                    body = {}
                    for (const [, name, value] of raw.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)) body[name] = value
                }

                const request: MockRequest = {
                    method: req.method ?? 'GET',
                    path: url.pathname,
                    query: url.searchParams,
                    headers: req.headers as Record<string, string | undefined>,
                    body,
                }

                // Polls answer at once; the rest wait a little, like a real network.
                if (! url.pathname.endsWith('/poll')) await new Promise((r) => setTimeout(r, latency))
                const response = store.handle(request)
                res.statusCode = response.status
                for (const [key, value] of Object.entries(response.headers ?? {})) res.setHeader(key, value)
                if (response.text !== undefined) {
                    res.end(response.text)
                } else {
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(response.body ?? {}))
                }
            })
        },
    }
}

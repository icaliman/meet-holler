import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors'

/**
 * On every API answer. The API serves JSON (and one calendar file) to the app
 * on its own origin and to nobody else: nothing is cached, nothing is framed
 * or sniffed into another type, and if a browser ever showed an answer as a
 * page it could load and run nothing. No CORS headers are ever sent, so other
 * origins cannot read an answer. HSTS comes from Cloudflare (docs/security.md).
 * The pages themselves get their headers from web/public/_headers.
 */
export const API_HEADERS: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
    await next()
    for (const [name, value] of Object.entries(API_HEADERS)) c.res.headers.set(name, value)
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Requests that change something must come from the app's own pages. A page
 * on another site can make a visitor's browser send a "simple" POST without
 * asking first (a form, a no-cors fetch), from the visitor's address: enough
 * to create meetings through other people's browsers. Browsers say where such
 * a request comes from (`Origin`, and `Sec-Fetch-Site` in current ones), so
 * anything that names another origin is refused. A client that sends neither
 * (curl, a script) is not a browser being used against its owner, and is let
 * through to the usual checks.
 */
export const sameOrigin: MiddlewareHandler = async (c, next) => {
    if (! SAFE_METHODS.has(c.req.method)) {
        const origin = c.req.header('Origin')
        const site = c.req.header('Sec-Fetch-Site')

        if ((origin !== undefined && ! isOwnOrigin(origin, c.req.url, c.req.header('Host'))) || site === 'cross-site') {
            throw new ApiError('forbidden', 'This request did not come from the app.', 'not_allowed')
        }
    }

    await next()
}

/** The request's own origin, or the host the browser asked for (a dev proxy keeps `Host` and changes the URL). */
function isOwnOrigin(origin: string, url: string, host: string | undefined): boolean {
    let parsed: URL
    try {
        parsed = new URL(origin)
    } catch {
        // `null` (a sandboxed frame, a redirect across origins) and anything unreadable.
        return false
    }

    return parsed.origin === new URL(url).origin || (host !== undefined && parsed.host === host.toLowerCase())
}

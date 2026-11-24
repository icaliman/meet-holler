type IceServer = { urls: string | string[], username?: string, credential?: string }

const TURN_TTL_SECONDS = 24 * 60 * 60

/**
 * What the browsers connect through: STUN always, and short-lived Cloudflare
 * Realtime TURN credentials when the TURN_KEY_ID / TURN_KEY_API_TOKEN secrets
 * are set (one subrequest per call start). A TURN service that does not
 * answer leaves STUN alone rather than failing the call.
 */
export async function iceServers(env: Env, fetcher: typeof fetch = fetch): Promise<{ iceServers: IceServer[], iceTransportPolicy: 'all' }> {
    const servers: IceServer[] = env.STUN_URL ? [{ urls: env.STUN_URL }] : []

    if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
        try {
            const response = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
            })
            if (response.ok) {
                const data = await response.json<{ iceServers?: IceServer | IceServer[] }>()
                for (const server of [data.iceServers ?? []].flat()) {
                    // Port 53 is blocked by browsers and only makes them wait for a timeout.
                    const urls = [server.urls].flat().filter((url) => ! /:53(\?|$)/.test(url))
                    if (urls.length) servers.push({ ...server, urls })
                }
            } else {
                console.warn(`TURN credentials: ${response.status}`)
            }
        } catch (error) {
            console.warn('TURN credentials failed', error)
        }
    }

    return { iceServers: servers, iceTransportPolicy: 'all' }
}

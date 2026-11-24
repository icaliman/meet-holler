// Optional secrets `wrangler types` cannot know about (only SESSION_SECRET is
// required, in wrangler.jsonc): Cloudflare Realtime TURN, for restrictive networks.
interface Env {
    TURN_KEY_ID?: string
    TURN_KEY_API_TOKEN?: string
}

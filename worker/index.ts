import { app } from './app'
import { cleanup, sweepSignals } from './cron'

const SWEEP_CRON = '*/15 * * * *'

export default {
    fetch: app.fetch,

    // Two cron triggers (wrangler.jsonc): the daily cleanup, and a sweep of unread signals every 15 minutes.
    async scheduled(controller, env, ctx) {
        ctx.waitUntil(controller.cron === SWEEP_CRON ? sweepSignals(env) : cleanup(env))
    },
} satisfies ExportedHandler<Env>

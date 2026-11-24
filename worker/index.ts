import { app } from './app'
import { cleanup } from './cron'

export default {
    fetch: app.fetch,

    async scheduled(_controller, env, ctx) {
        ctx.waitUntil(cleanup(env))
    },
} satisfies ExportedHandler<Env>

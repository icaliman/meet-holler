import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// The tests run inside workerd against a real (local) D1 database, migrated
// from migrations/ before each test file (test/setup.ts).
export default defineConfig(async () => {
    const migrations = await readD1Migrations('./migrations')

    return {
        plugins: [
            cloudflareTest({
                wrangler: { configPath: './wrangler.jsonc' },
                miniflare: {
                    // RELAY_SIGNALING: the tests turn relaying on per meeting, whatever a developer's .dev.vars says.
                    bindings: { SESSION_SECRET: 'test-session-secret', TEST_MIGRATIONS: migrations, RELAY_SIGNALING: 'off' },
                },
            }),
        ],
        test: {
            include: ['test/**/*.test.ts'],
            setupFiles: ['./test/setup.ts'],
            // workerd warns about event listeners that return a value; holler-js's arrow-function listeners do, harmlessly.
            onConsoleLog: (log: string) => ! log.includes('An event handler returned'),
        },
    }
})

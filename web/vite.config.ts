import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { mockApi } from './dev/mock-api'

// `npm run dev` answers /api/* from an in-memory mock (dev/), so the whole UI runs without the Worker.
// MOCK=0 turns it off and proxies /api to a Worker on :8787 (`wrangler dev`) instead.
const useMock = process.env.MOCK !== '0'

export default defineConfig({
    plugins: [svelte(), useMock ? mockApi() : null],
    server: {
        port: 5173,
        proxy: useMock ? undefined : { '/api': 'http://localhost:8787' },
    },
    build: {
        outDir: 'dist',
        target: 'es2022',
    },
    resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./tests/setup.ts'],
        include: ['src/**/*.test.ts', 'dev/**/*.test.ts'],
    },
})

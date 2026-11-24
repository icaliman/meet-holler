// Builds the Svelte app into web/dist, which wrangler serves as static assets.
// Until web/ has a package.json there is nothing to build: a placeholder page
// keeps `wrangler dev` working (the assets directory must exist).
// `--assets-only` (used by `npm run dev`) never builds, it only makes sure web/dist exists.
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const assetsOnly = process.argv.includes('--assets-only')

if (! assetsOnly && existsSync('web/package.json')) {
    execSync('npm --prefix web run build', { stdio: 'inherit' })
} else if (! existsSync('web/dist/index.html')) {
    mkdirSync('web/dist', { recursive: true })
    writeFileSync('web/dist/index.html', '<!doctype html><meta charset="utf-8"><title>meet-holler</title><p>The app is not built yet: <code>npm run build</code>.</p>\n')
    console.log('web/dist/index.html not found: wrote a placeholder')
}

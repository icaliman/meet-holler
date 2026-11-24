# meet-holler

Video meetings in the browser, on the Cloudflare free plan. Start one in a click or schedule it for later, share a short link, and talk with up to four people: video, screen sharing, a laser pointer and drawing on the shared screen. Public or private, with an optional waiting room.

Live at **https://meet.xlite.dev** (coming soon).

Built on [`@packstub/holler`](https://github.com/packstub/holler-js) (the WebRTC engine), Svelte 5, a Cloudflare Worker and D1.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

## Development

Node 22 or newer.

```bash
npm install
cp .dev.vars.example .dev.vars    # then put a random SESSION_SECRET in it: openssl rand -base64 32
npm run db:migrate:local          # the local D1 database
npm run dev                       # the Worker and the built app on http://localhost:8787
```

| Script | Does |
| --- | --- |
| `npm run dev` | `wrangler dev`: the API and whatever is in `web/dist` |
| `npm run build` | builds the Svelte app into `web/dist` (once `web/` exists) |
| `npm test` | the Worker's tests, inside workerd against a local D1 |
| `npm run typecheck` | the Worker's TypeScript, and that `worker-configuration.d.ts` matches `wrangler.jsonc` (`npm run types` regenerates it) |
| `npm run deploy` | build and `wrangler deploy` |

The API is described in [docs/api.md](docs/api.md). What the server and a meeting's host can see, and the risks accepted on purpose, are in [docs/security.md](docs/security.md); to report a vulnerability, see [SECURITY.md](SECURITY.md).

## Free-plan budget

Everything runs on the Cloudflare free plan: 100,000 Worker requests a day, D1 100,000 rows written and 5 million read. The app's pages are static assets and cost nothing; the cost is the polling that relays WebRTC signaling. Polling every 3 seconds once a call is connected, that is about **80 participant-hours a day**: roughly 80 half-hour calls between two people, or 39 half-hour meetings of four, or 20 one-hour meetings of four. Requests run out first; D1 writes and reads stay well under their limits. The numbers and how they were measured are in [docs/api.md](docs/api.md#free-plan-budget).

## License

MIT

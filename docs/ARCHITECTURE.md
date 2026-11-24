# Architecture

One Cloudflare Worker serves everything: the Svelte single-page app (Workers static assets) and a JSON API backed by D1. No media passes through it: the browsers talk to each other over WebRTC (a mesh, so a meeting holds **up to 4 people**), and the Worker only relays signaling that `@packstub/holler` polls over HTTP. It must run on the **free** Workers plan.

```
worker/        Hono API + holler signaling on D1            (TypeScript)
migrations/    D1 migrations (wrangler d1 migrations)
web/           Svelte 5 + Vite SPA, builds to web/dist      (TypeScript)
wrangler.jsonc Worker config: assets = web/dist, D1 binding DB, cron trigger
docs/          this file, api.md, design.md
```

Directory ownership keeps parallel PRs apart: `worker/`, `migrations/`, `wrangler.jsonc`, CI belong to the backend; `web/` to the UI.

## Product

- **Instant meeting**: one click, a short code, you are in the lobby.
- **Scheduled meeting**: title, date and time, duration; link plus `.ics` download; joining before the start shows a countdown, the host can always open it.
- **Public**: anyone with the link can join. **Private**: the link plus a passcode the host sets.
- **Waiting room** (optional, either visibility): guests wait until the host admits or denies them; host can toggle it live and lock the meeting.
- No accounts. A guest gives a display name. The creator gets a secret `hostKey`, kept in localStorage and carried in the host link, which makes them host from any device.
- **Remote control v1 = pointer + annotations**: while someone shares their screen, everyone can show a laser pointer and draw ephemeral marks on it, sent over a Holler data channel ([annotations.md](annotations.md)). A browser cannot inject input on another machine, so real remote control is out of scope.
- Capacity: 4 per meeting (holler-js mesh). Say it plainly in the UI when full.

## Meeting codes

Ten characters from `23456789abcdefghjkmnpqrstuvwxyz` (no 0/o/1/l/i), crypto-random, shown as `abc-defg-hij`; the dashes are cosmetic and optional on input. Retry on collision (unique index).

## HTTP API (JSON)

All `/api/*`. Errors: `{ "error": { "code": "not_found" | "forbidden" | "passcode_required" | "passcode_wrong" | "full" | "locked" | "ended" | "invalid" | "rate_limited", "message": "..." } }` with a matching status.

| Route | Auth | What |
| --- | --- | --- |
| `POST /api/meetings` | none | `{ title?, visibility: 'public'\|'private', passcode?, waitingRoom: boolean, scheduledAt?: ISO, durationMin?, hostName? }` → `{ meeting, hostKey }` |
| `GET /api/meetings/:code` | none | public info: `{ code, title, visibility, requiresPasscode, waitingRoom, scheduledAt, durationMin, status: 'scheduled'\|'open'\|'ended', locked, participantCount, capacity: 4 }` |
| `GET /api/meetings/:code.ics` | none | calendar file for a scheduled meeting |
| `POST /api/meetings/:code/join` | none | `{ name, passcode?, hostKey? }` → `{ token, participant: { id, name, role: 'host'\|'guest', state: 'admitted'\|'waiting' } }` |
| `GET /api/meetings/:code/me` | Bearer token | my participant (a waiting guest polls this until `admitted` or `denied`) |
| `GET /api/meetings/:code/waiting` | host | waiting guests `[{ id, name, since }]` |
| `POST /api/meetings/:code/waiting/:id/admit` and `/deny` | host | |
| `PATCH /api/meetings/:code` | host | `{ waitingRoom?, locked?, title? }` |
| `POST /api/meetings/:code/end` | host | ends the meeting for everyone |
| `POST /api/meetings/:code/remove/:id` | host | remove a participant |
| `/api/meetings/:code/holler/*` | Bearer token, admitted only | the Holler signaling routes (below) |

The token is an HMAC-signed value (`SESSION_SECRET`, a Worker secret) naming meeting and participant; no server-side session table needed for auth, but participants live in D1.

### Holler signaling on D1

`@packstub/holler`'s `HttpSignaling` is configured with `routes` pointing at `/api/meetings/:code/holler/...`. The server contract (poll, signal, hold, leave, ice) is documented in `plugins/holler/docs/endpoints.md` of the packstub workspace and in the holler-js README ("The signaling interface"). A meeting is **one Holler call** whose id is the meeting code: joining = `answer`/`start` semantics for an admitted participant, `seat` = join order (0..3), `peers` lists the others, a call "ends" when the host ends it or the last person leaves. Signals live in a D1 table with an autoincrement cursor and are deleted once delivered or after a minute.

### Free-plan budget (design constraint, not an afterthought)

Free plan: 100k Worker requests/day, D1 100k row writes and 5M row reads/day. Polling is the cost. Rules: poll only while in a meeting or waiting; slow down (e.g. 1 s while negotiating, 3-5 s once media is connected, since media does not need signaling); one D1 `batch` per poll; write heartbeats rarely; static assets are free and do not count. A daily cleanup cron removes ended meetings and stale signals; a second one sweeps unread signals every 15 minutes. Document the honest numbers (meetings/day at a given length) in the README.

Optionally, the host's browser is the only one that polls and relays signaling to the guests over WebRTC data channels (`RELAY_SIGNALING`, off by default): [relay-signaling.md](relay-signaling.md).

STUN only by default (`stun:stun.cloudflare.com:3478`); an optional TURN (Cloudflare Realtime TURN) through secrets, served by the `ice` route, for restrictive networks.

## Design brief

A distinctive, modern look, not a Zoom or Meet clone: a confident visual identity (own palette, type, motion, a memorable logo mark), light and dark, great on phones. Home: the three things people want, in this order: **Start a meeting**, **Join with a code**, **Schedule**. Zero jargon, no sign-up wall, every state (waiting, full, ended, camera blocked, no mic) explained in one friendly sentence with the next step. Accessible (focus rings, labels, contrast, reduced motion). The agent owning `web/` writes `docs/design.md` (tokens, components, rules) first.

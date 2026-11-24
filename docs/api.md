# API

The Worker's JSON API, everything under `/api/*`. [ARCHITECTURE.md](ARCHITECTURE.md) has the contract in short; this page is the detail the app is built against. Where the two differ, the difference is listed under [Changes to the contract](#changes-to-the-contract).

- [Conventions](#conventions)
- [Meetings](#meetings)
- [Joining and the waiting room](#joining-and-the-waiting-room)
- [Host controls](#host-controls)
- [Holler signaling](#holler-signaling)
- [Free-plan budget](#free-plan-budget)

## Conventions

**Bodies** are JSON (`Content-Type: application/json`) both ways, except the `.ics` file and the `leave` beacon (form data).

**Times** are ISO 8601 strings in UTC (`2026-12-01T15:00:00.000Z`).

**Meeting codes** are ten characters from `23456789abcdefghjkmnpqrstuvwxyz`. The API always returns the plain form (`abcdefghjk`); show it as `abc-defg-hjk`. Every route takes the code with or without dashes, in any case.

**Errors** look like this, with a matching HTTP status:

```json
{ "error": { "code": "full", "message": "This meeting is full: four people are already in it." }, "message": "…", "reason": "full" }
```

`message` and `reason` at the top level repeat the error for `@packstub/holler`'s `HttpSignaling`, which reads those two (`reason` is Holler's on the signaling routes: `not_allowed`, `not_ringing`, `too_large`, `too_many`, `ended`, `full`). The app reads `error.code`.

| `code` | Status | When |
| --- | --- | --- |
| `invalid` | 422 | a field is missing or wrong (the message names it) |
| `not_found` | 404 | no meeting with this code, no such participant |
| `forbidden` | 401 / 403 | 401: no token, or a token that does not check out; 403: the token is fine but not allowed here (not the host, not admitted, removed) |
| `passcode_required` | 401 | a private meeting and no passcode was sent |
| `passcode_wrong` | 401 | the passcode does not match |
| `locked` | 423 | the host locked the meeting: nobody new gets in |
| `full` | 409 | four people are in the meeting |
| `not_started` | 409 | a scheduled meeting before its start time that the host has not opened yet |
| `ended` | 410 | the host ended the meeting (or it expired) |
| `rate_limited` | 429 | too many requests from this address, or too many wrong passcodes for this meeting; `Retry-After` says how many seconds to wait |

**Auth.** Joining returns a `token`. Send it as `Authorization: Bearer <token>` on every route that needs it. The token is HMAC-signed (`SESSION_SECRET`) and names one participant of one meeting; keep it in `sessionStorage` so each tab is its own participant.

The host is whoever joins with the meeting's `hostKey`. Host routes accept either the host's token (`Authorization: Bearer`) or the key itself (`X-Host-Key: <hostKey>`), so host controls also work from a page that has not joined.

**Rate limits** (per IP address, per Worker instance, so they are a brake, not a wall): creating meetings 20 per 10 minutes, joining 30 per minute, everything else 600 per minute. Wrong passcodes are counted per meeting in D1: after 10 in 15 minutes the meeting answers `rate_limited` to every passcode until the window passes.

## Meetings

### The meeting object

What `GET /api/meetings/:code` returns, and `meeting` in other answers:

```json
{
    "code": "k7m2pq9xtd",
    "title": "Design review",
    "visibility": "private",
    "requiresPasscode": true,
    "waitingRoom": true,
    "scheduledAt": "2026-12-01T15:00:00.000Z",
    "durationMin": 45,
    "status": "scheduled",
    "locked": false,
    "participantCount": 0,
    "capacity": 4,
    "hostName": "Ana"
}
```

- `status`: `scheduled` (a scheduled meeting before its start time, until the host opens it by joining), `open`, or `ended`.
- `scheduledAt` and `durationMin` are `null` for an instant meeting.
- `participantCount` counts the people in the meeting (admitted, whether or not their video is up yet), not the ones in the waiting room.
- `title` and `hostName` may be `null`.

### `POST /api/meetings`

Create a meeting. No auth.

```json
{ "title": "Design review", "visibility": "private", "passcode": "tulip-42", "waitingRoom": true, "scheduledAt": "2026-12-01T15:00:00Z", "durationMin": 45, "hostName": "Ana" }
```

| Field | Rules |
| --- | --- |
| `title` | optional, up to 100 characters |
| `visibility` | `public` (default) or `private` |
| `passcode` | required for `private` (4 to 64 characters), refused for `public` |
| `waitingRoom` | boolean, default `false` |
| `scheduledAt` | optional ISO time: a scheduled meeting. Not more than 5 minutes in the past, not more than a year ahead |
| `durationMin` | optional, 5 to 480, default 60 for a scheduled meeting; ignored without `scheduledAt` |
| `hostName` | optional, up to 60 characters: shown in the `.ics` file and on the join page |

→ `201 { "meeting": {…}, "hostKey": "…" }`

`hostKey` is shown once and never again (the server keeps only its SHA-256). Keep it in `localStorage` and put it in the host link (`/m/<code>?host=<hostKey>`, or however the app routes it).

The passcode is stored as a PBKDF2-SHA256 hash with a random salt (30,000 iterations: the free plan allows 10 ms of CPU per request).

### `GET /api/meetings/:code`

The meeting object. No auth. `404 not_found` for an unknown code; an ended meeting answers `200` with `status: "ended"`.

### `GET /api/meetings/:code.ics`

A calendar file (`text/calendar`, `attachment; filename="meeting-<code>.ics"`) for a scheduled meeting: title, start, end, the join link (`<origin>/m/<abc-defg-hjk>`, the app's meeting route) and, for a private meeting, a line saying a passcode is needed (never the passcode). `404` for an instant meeting.

## Joining and the waiting room

### `POST /api/meetings/:code/join`

```json
{ "name": "Mihai", "passcode": "tulip-42", "hostKey": null }
```

- `name`: 1 to 40 characters after trimming.
- `passcode`: for a private meeting. Not needed with a valid `hostKey`.
- `hostKey`: makes this participant the host. A wrong `hostKey` is `403 forbidden` (it is never silently ignored).

→ `201`

```json
{
    "token": "…",
    "participant": { "id": "Qm9pX3a1c2Zk", "name": "Mihai", "role": "guest", "state": "waiting" },
    "meeting": { … }
}
```

`state` is `admitted` (go ahead and start Holler) or `waiting` (the meeting has a waiting room: poll `/me`).

The checks, in order: the meeting exists (`not_found`), has not ended (`ended`), the passcode (`passcode_required`, `passcode_wrong`, `rate_limited`), then for guests only: started (`not_started`) and not locked (`locked`); then for everyone: room for one more (`full`). The host passes the passcode, start-time and lock checks, but not the capacity. Joining as host opens a scheduled meeting early.

Every join makes a new participant. Someone who left and comes back joins again (a reload does not need to: the token in `sessionStorage` still works, see [Reconnecting](#reconnecting-after-a-reload)).

### `GET /api/meetings/:code/me`

Bearer token. → `{ "participant": { id, name, role, state }, "meeting": {…} }`

A waiting guest polls this every 3–5 seconds until `state` changes. The states:

| `state` | Meaning |
| --- | --- |
| `waiting` | in the waiting room |
| `admitted` | in the meeting (start Holler, or it is running) |
| `denied` | the host said no |
| `removed` | the host removed them |
| `left` | they hung up, or went quiet for too long |

A waiting guest who stops polling for a minute drops off the host's list (they are still `waiting` if they come back).

### `GET /api/meetings/:code/waiting`

Host. → `[{ "id": "…", "name": "Mihai", "since": "2026-12-01T15:02:11.000Z" }]`, oldest first, only guests that polled in the last minute.

The host's Holler poll carries the same list (see [`meeting` in the poll](#meeting-in-the-poll)), so the app can skip this route while the host is in the call.

### `POST /api/meetings/:code/waiting/:id/admit` and `/deny`

Host. → `{ "participant": {…} }`. Admitting into a full meeting is `409 full`; admitting or denying someone who is no longer waiting is `409 invalid`.

## Host controls

All of these are host-only (`403 forbidden` otherwise) and answer `410 ended` once the meeting has ended.

### `PATCH /api/meetings/:code`

```json
{ "waitingRoom": false, "locked": true, "title": "Design review (v2)" }
```

Every field optional. → `{ "meeting": {…} }`. Turning the waiting room off admits the guests waiting in it, oldest first, while there is room.

### `POST /api/meetings/:code/end`

Ends the meeting for everyone. → `{ "meeting": {…} }`. Every participant's next Holler poll returns the call as ended with `end_reason: "ended"`, so `CallClient` emits `ended` with that reason.

### `POST /api/meetings/:code/remove/:id`

Removes a participant (not the host themselves: `422 invalid`). → `{ "participant": {…} }`. Their next poll returns the call ended with `end_reason: "removed"`; their `/me` says `removed`; joining again works unless the meeting is locked (the app may want to lock it first).

## Holler signaling

A meeting is one Holler call whose `id` is the meeting code. `@packstub/holler`'s `CallClient` talks to it through `HttpSignaling`; nothing else in the app needs these routes. All of them need an admitted participant's token (`403` for a waiting, denied or removed one).

### Setting up the client

```js
import { CallClient, HttpSignaling } from '@packstub/holler'

const base = `/api/meetings/${code}/holler`
const signaling = new HttpSignaling({
    routes: {
        poll: `${base}/poll`,
        store: `${base}/start`,       // required by HttpSignaling; a meeting rings nobody, so it answers 422
        answer: `${base}/answer`,
        decline: `${base}/decline`,
        hangup: `${base}/hangup`,
        signal: `${base}/signals`,
        leave: `${base}/leave`,
        hold: `${base}/hold`,
        resume: `${base}/resume`,
        ice: `${base}/ice`,
    },
    headers: { Authorization: `Bearer ${token}` },
    beaconFields: { token },          // the leave beacon cannot send headers
})

const client = new CallClient({
    signaling,
    iceServers: () => signaling.configuration().then((rtc) => rtc.iceServers),
    maxParticipants: 4,
    poll: { idle: 5000, active: 1000, hidden: 15000 },
    channels: ['annotations'],        // the pointer and drawings (issue #6)
})

client.resumeCall(code, { answer: true })   // join the meeting's call
window.addEventListener('pagehide', () => client.leave())
```

`resumeCall(code, { answer: true })` polls with the code, finds the call ringing this participant, and answers it: camera prompt, then `connecting`. Leave out `invite` and `people` routes: a meeting adds people through the join link, so `canInvite()` is false.

**Slow the poll down once the media flows** (this is most of the budget): signaling is only needed to connect and to notice people coming and going.

```js
client.addEventListener('statechange', ({ detail: { state } }) => {
    client.pollIntervals.active = state === 'active' ? 3000 : 1000
})
```

### The call, as each participant sees it

The `call` object is Holler's (holler-js README, "The signaling interface"), with these meeting rules:

| Field | In a meeting |
| --- | --- |
| `id` | the meeting code |
| `kind` | `"call"` |
| `status` | `ringing` while fewer than two people are in the call, `active` with two or more, `ended` once the host ended the meeting |
| `end_reason` | `ended` (the host ended it), `expired` (the daily cleanup ended a meeting everyone left), `removed` (the host removed me) |
| `role` | `caller` for the host, `callee` for everyone else |
| `seat` | join order (admission order for the waiting room), starting at 0; only the order matters: between two people the lower seat makes the offer |
| `joined` | whether I answered and am in the call |
| `peers` | everyone else in the call (`ringing` = admitted, still on the camera prompt; `joined`; `on_hold`), plus people who left in the last minute (`left`, `declined`, `missed`, `dropped`) so clients see them go |
| `answered_at` | when the call first had two people |

Why `ringing` while alone: Holler ends a call that drops below two people, and a client alone in an `active` call would decide its peer is lost and hang up after 15 seconds. A meeting outlives its people, so a lone participant sees the call as `ringing` (state `calling` or `connecting`), which keeps the client waiting quietly; the app shows "Waiting for others" from an empty `peers` list. See the known issue under [Holler and a lone participant](#holler-and-a-lone-participant).

The call never ends because people leave: it ends when the host ends the meeting. Someone who hangs up leaves the meeting (`/me` says `left`); they rejoin through `POST /join`.

### Routes

All under `/api/meetings/:code/holler`, with the token.

| Method | Route | Body | Does |
| --- | --- | --- | --- |
| `GET` | `/poll?after=&call=&tab=&claim=1` | | `{ call, incoming, on_hold, signals, cursor, meeting }`, see below |
| `POST` | `/answer` | `{ tab }` | an admitted participant joins the call; `409 not_ringing` if they are not ringing (already in, left, removed) |
| `POST` | `/decline` | | leave before answering (same as hangup) |
| `POST` | `/hangup` | | leave the meeting; it goes on for the others |
| `POST` | `/signals` | `{ type, payload, to? }` | queue a signal for one participant (`to`) or everyone else in the call; `201 { id }` |
| `POST` | `/leave` | form `tab`, `token` (or JSON) | the page is unloading: frees my side for the next page at once; `204` |
| `POST` | `/hold` | | step out of the call without leaving it (`on_hold`) |
| `POST` | `/resume` | `{ tab }` | back from hold |
| `GET` | `/ice` | | `{ iceServers, iceTransportPolicy }`, never cached |
| `POST` | `/start` | | `422 not_allowed`: nobody is rung in a meeting |

Signals: `type` is one of `offer`, `answer`, `ice`, `reset`, `state`; `payload` an object up to 64 KB (`413 too_large`); at most 500 of my signals unread at once (`429 too_many`). `to` must be someone in the call (`422 not_allowed`). A signal to everyone goes to every participant who is `ringing` or `joined` (not `on_hold`: they connect afresh when they resume). Signalling after the meeting ended is `410 ended`; signalling before I answered is `422 not_allowed`.

### Polling

`GET /poll` is the one request every tab repeats, as in Holler:

- `call`: the call named by `call=` while I am in it (or ringing), or with no `call=`, the meeting's call if I have joined it (a reloaded page picks it up). An ended meeting's call is still returned, with its `end_reason`, and so is the call of someone the host removed (`end_reason: "removed"`). After I left, `null`.
- `incoming`: the meeting's call while it rings me and the poll did not name it (`CallClient.start()` without `resumeCall()` sees it ring and emits `incoming`).
- `on_hold`: the meeting's call while I have it on hold.
- `signals`: `[{ id, call, type, payload, from }]` after `after`, at most 100, only to the tab that holds my side (`claim=1`).
- `cursor`: the last signal id, the next `after`.

`claim=1` with `call=` and `tab=` claims my side for this tab: a side is free when no tab has it, the same tab asks, or its tab went quiet for 20 seconds (or sent the `leave` beacon). A fresh tab that takes over skips the signals meant for the old one. Signals up to `after` are deleted when the tab holding the side polls again (the read is the acknowledgement).

#### `meeting` in the poll

Every poll also carries a small view of the meeting, so the call page needs no second poll:

```json
"meeting": { "status": "open", "title": "Design review", "locked": false, "waitingRoom": true, "waiting": [{ "id": "…", "name": "Mihai", "since": "…" }] }
```

`waiting` is there for the host only. `HttpSignaling` does not surface extra fields, so the app reads it by passing its own `fetch` to `HttpSignaling` and peeking at poll responses (clone the response), or falls back to `GET /waiting`.

### Heartbeats, quiet tabs and timeouts

To keep D1 writes down the server does not write on every poll:

- The tab that holds a side writes its heartbeat at most every **10 seconds**. `seen_ago` on a peer is reported relative to that (0 while the tab is polling at least every 5 seconds), so Holler's "alive" check (`seen_ago < 6`) holds for a live tab and fails about 20 seconds after it went quiet.
- A tab that stopped polling loses its side after **20 seconds** (at once with the `leave` beacon).
- Someone in the call whose tab has been quiet for **45 seconds** is `dropped` (out of the meeting, `/me` says `left`).
- Someone admitted who never answers (closed the tab on the camera prompt) is `missed` after **60 seconds**.
- Someone on hold whose tabs all stopped polling is `dropped` after **120 seconds**.

These are applied lazily, by the next poll or join in that meeting, inside the same D1 batch.

### Reconnecting after a reload

The token lives in `sessionStorage`, so a reload keeps it. On load, if `/me` says `admitted`, call `client.resumeCall(code, { answer: true })` again: the poll returns the call (`joined: true`), the client claims its side, sends `reset` and fresh offers, and the others reconnect to it. The `leave` beacon on `pagehide` frees the side at once, so the new page takes it on its first poll.

### ICE servers

`GET /ice` returns the STUN server (`STUN_URL`, `stun:stun.cloudflare.com:3478`) and, when the `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` secrets are set, short-lived Cloudflare Realtime TURN credentials (24 hours) fetched per call. If the TURN service does not answer, STUN alone is returned. `iceTransportPolicy` is `all`.

## Free-plan budget

The Workers free plan allows, per day: **100,000 Worker requests**, and on D1 **100,000 rows written** and **5,000,000 rows read** (static assets are free and unlimited). Polling dominates everything, so the numbers below come from it.

### What one request costs

Measured against local D1 (`meta.rows_written` / `meta.rows_read` of each statement):

| Request | Rows written | Rows read |
| --- | --- | --- |
| Poll, nothing new (most of them) | 0 | 9 with two people, 14 with three, about 20 with four |
| Poll that writes the heartbeat (one in ~4 at 3 s) | 1 | the same |
| Poll that acknowledges signals | 1 per signal read | the same + 1 per signal |
| Signal to one person | 3 (row, index, sequence) | 10–17 |
| Signal to everyone in a 4-person call | 7 | about 25 |
| Create a meeting | 2 | 1 |
| Join | 2–3 | about 10 |
| Waiting guest's `/me` | 1 every 20 s (heartbeat), else 0 | about 3 |

A poll is one D1 batch: expire quiet people, claim or heartbeat, acknowledge read signals, read the meeting, its participants and my new signals. Each write statement only writes when its condition holds, so a quiet poll writes nothing. The tables have one secondary index each (participants by meeting, signals by recipient), because every index adds a written row.

Connecting a call costs about 14 signals per pair of people (offer, answer, a dozen ICE candidates, a state), each one request and about 4 rows written (3 to queue, 1 to acknowledge): a 4-person meeting (6 pairs) spends about 85 requests and 350 rows written to connect.

### Per participant-hour

| Poll interval in a running call | Requests | Rows written | Rows read |
| --- | --- | --- | --- |
| 1 s (Holler's default, all the time) | 3,600 | ~330 | ~55,000 |
| 3 s (recommended once `active`) | 1,200 | ~300 | ~18,000 |
| 5 s | 720 | ~240 | ~11,000 |

Heartbeats are one write every 10–15 seconds whatever the interval. Requests run out first, long before writes or reads.

### Meetings per day

At 3 s polls once connected (1 s for the first ~15 s), for each meeting length:

| Meeting | Requests per meeting | Rows written | Meetings/day (requests limit) |
| --- | --- | --- | --- |
| 2 people, 30 min | ~1,250 | ~370 | **~80** |
| 4 people, 30 min | ~2,550 | ~970 | **~39** |
| 4 people, 60 min | ~4,950 | ~1,570 | **~20** |
| 2 people, 60 min | ~2,450 | ~670 | **~40** |

Roughly **80 participant-hours a day** at 3 s polls (about 140 at 5 s); at Holler's default 1 s it would be under 28. The D1 write limit would allow about 330 participant-hours and reads about 270, so neither binds. The daily cron costs a few hundred rows at most.

A waiting guest costs 720–1,200 requests an hour at 3–5 s polls, so keep the waiting room poll at 5 s.

Past the limits the Worker answers Cloudflare's 1027 error page until midnight UTC. The paid plan ($5/month) lifts requests to 10 million a month.

## Changes to the contract

Relative to [ARCHITECTURE.md](ARCHITECTURE.md):

- A new error code, `not_started` (409): guests joining a scheduled meeting before its start, while the host has not opened it.
- `/me` states add `denied`, `removed` and `left` to `admitted` and `waiting`.
- `join` also returns `meeting`; the meeting object also has `hostName`. Both are additions.
- Host routes also accept `X-Host-Key` instead of the host's token.
- Error bodies also carry `message` and `reason` at the top level (for `HttpSignaling`).
- The Holler poll also returns `meeting` (with the waiting list for the host).
- The call does not end when people leave, only when the host ends it (or the cleanup does); the contract said "or the last person leaves". An empty meeting stays joinable until the daily cleanup ends it after a day without anyone in it.
- `seat` is join order but keeps counting (0, 1, 2, … including people who left), rather than 0..3.

## Known issues

### Holler and a lone participant

`@packstub/holler` 1.0 was built for calls that end once fewer than two people are left. In a meeting, when the second-to-last person leaves, the one who stays can briefly see their connection to the leaver drop before the next poll says the leaver is gone; the client then arms its 15-second "reconnecting" timer while the call is still `active`, and that timer is not cleared when the call turns back to `ringing`. It then hangs up as `dropped`. The app should treat `ended` with `dropped` or `failed` while the meeting is still open and this person did not click Leave as "everyone left": join again (`POST /join`, then `resumeCall`). A small change in holler-js (clear the drop timer in `refreshState()` when the call is not `active`) would remove the workaround. `test/call-client.test.ts` reproduces it with the real client.

# Security

What meet-holler protects, from whom, how, and what it knowingly does not. Written after an audit of the whole app on 2026-11-24, **before the first deploy**: nothing described here was ever exploitable on a live instance.

To report a problem, see [SECURITY.md](../SECURITY.md).

- [The short version](#the-short-version)
- [Threat model](#threat-model)
- [How things are protected](#how-things-are-protected)
- [Findings of the 2026-11 audit](#findings-of-the-2026-11-audit)
- [Accepted risks](#accepted-risks)
- [Before the first deploy](#before-the-first-deploy)
- [Not verified](#not-verified)

## The short version

- There are no accounts. A meeting is a 10-character code; whoever has the link can ask to join. The creator holds a `hostKey`; a private meeting also needs a passcode.
- Audio, video and shared screens go straight between the browsers, encrypted (DTLS-SRTP). The server never sees them. It does carry the signaling that sets those connections up, and whoever carries signaling could tamper with it (see [the server](#the-server-the-worker-d1-cloudflare)).
- Everyone in a meeting learns the others' IP addresses. That is what a peer-to-peer mesh means.
- It runs on Cloudflare's free plan, with a small daily budget of requests and database writes. Most of the hardening is about not letting one visitor spend that budget for everyone.

## Threat model

### What is worth protecting

| | Where it lives |
| --- | --- |
| The conversation itself (audio, video, screen, pointer and drawings) | Only in the browsers of the people in the meeting |
| Who is meeting whom, about what, when: names, titles, times, IP addresses | D1 (names, titles, times) for up to a week after a meeting ends; Cloudflare's logs (addresses, request paths) |
| Control of a meeting: the `hostKey` | The host's `localStorage`, and any host link they copied; the server keeps only its SHA-256 |
| A seat in a meeting: the participant token | The tab's `sessionStorage`, 24 hours at most |
| A private meeting's passcode | People's heads and chats; the creating tab's `sessionStorage` until it closes; the server keeps a salted PBKDF2 hash |
| The service itself: the free plan's daily requests, D1 rows and storage | Cloudflare |

### The server (the Worker, D1, Cloudflare)

**Sees:** every meeting's code, title, host name, schedule, visibility and settings; every participant's display name, when they joined and left, and their IP address; passcode and host key only as hashes. It sees all signaling: the SDP offers and answers and ICE candidates, which contain each participant's network addresses and the fingerprints of their media encryption keys.

**Does not see:** audio, video, screen content, or the pointer and drawings (those travel on a data channel between browsers). With TURN configured, relayed media passes through Cloudflare's TURN service still encrypted end to end between the browsers.

**Could do if it were malicious or compromised:** everything a host can, in any meeting. And, because it relays the signaling, **replace the key fingerprints in SDP and sit in the middle of a call**. Nothing in the app lets participants compare fingerprints, so this would go unnoticed. This is true of every WebRTC service whose server carries signaling and offers no verification step, and it is accepted here ([accepted risks](#accepted-risks)). So the conversation is as private as the deployment is trustworthy: the Cloudflare account, the `SESSION_SECRET`, and this repository's supply chain.

### The host

**Is:** whoever holds the `hostKey` (the browser that created the meeting, or anyone given the host link). Several people can hold it.

**Sees:** what every participant sees, plus the waiting room (names of people asking to come in).

**Can do:** admit and deny, remove people, lock the meeting, switch the waiting room, rename the meeting, end it for everyone. Clear everyone's marks on a shared screen.

**With relayed signaling (PR #15, off by default):** the host's browser passes signaling between guests, so a malicious host has the same man-in-the-middle position between two guests that the server has. The host's browser also tells guests who is in the meeting and, with it, who is host; a host who lies about that only hurts their own meeting.

### A guest (someone admitted)

**Sees:** the other participants' names, their media, their IP addresses (through WebRTC), the meeting's title, whether it is locked and has a waiting room.

**Can do:** send media, signaling to the others in the same meeting (the sender is always taken from the token, never from the message), point and draw while someone shares (unless the sharer turned that off), clear their own marks, leave. Call themselves any name: names are not identities (see [accepted risks](#accepted-risks)).

**Cannot:** use a host route; see the waiting list; reach a participant of another meeting; use their token on another meeting; keep any of this after leaving, being removed, or after 24 hours.

### Someone waiting, denied or removed

Sees the meeting's public information and their own state. Gets nothing from the call: no poll, no signals, no ICE servers; a removed participant is told so and learns nothing about who is still there.

### Someone with only the link

For a **public** meeting: its title, host name, schedule, how many are in, and they can join. The link is the key; treat it like one.

For a **private** meeting: that it exists, that it needs a passcode, whether it is scheduled, open or ended, and when. Not its title, host, who is in, or whether it is locked or full.

### A stranger without a link

Can create meetings, and try to guess codes. A code is 10 characters from 31, about 49.5 bits: with a thousand meetings open, the whole daily request budget spent on guessing would need on the order of ten thousand years to find one. Can try to use up the service (see [accepted risks](#accepted-risks)).

## How things are protected

| | |
| --- | --- |
| Meeting codes | 10 crypto-random characters, rejection-sampled so each is equally likely |
| `hostKey` | 192 random bits, shown once, stored as SHA-256, compared in constant time. On the client only in `localStorage` and in the **fragment** of the host link, which browsers never send to a server; taken out of the address bar and checked with the Worker before it is stored. Never in the `.ics`, the share text or the meeting link |
| Participant tokens | HMAC-SHA-256 over meeting, participant and expiry (24 h). No role inside: host or guest is read from the participant's record on every request. Refused outright if `SESSION_SECRET` is missing or weak |
| Passcodes | PBKDF2-SHA-256, random salt, 30,000 iterations (the free plan's 10 ms of CPU per request sets that); 10 wrong guesses per meeting per 15 minutes, counted before the check; never logged or returned |
| Authorization | Every host route checks the host key or a host participant's token; every signaling route checks that the participant is in the meeting now; all SQL is parameterised |
| Browser | A Content-Security-Policy with no inline or third-party script, `frame-ancestors 'none'`, a Permissions-Policy that keeps the camera, microphone and screen capture for the app's own origin, `no-referrer`, `nosniff`; no cookies; `no-store` on every API answer; no CORS, and state-changing requests from other origins are refused |
| Input | Bodies capped at 16 KB; names and titles cleaned of control, invisible and direction-changing characters; everything peers send over the data channel is validated and clamped before use, and rendered as text |
| Abuse | Per-client limits on creating and joining counted in D1 (per /64 for IPv6); a ceiling on meeting creation overall; caps on the waiting room, on records per meeting, and on signaling data waiting in D1 |

## Findings of the 2026-11 audit

Severity is for a deployed instance, had it been deployed in that state. "Fixed" names the pull request; until those are merged, `main` still has the problem.

| # | Severity | Area | Finding | Status |
| --- | --- | --- | --- | --- |
| 1 | High | Config | Without `SESSION_SECRET` the Worker signed tokens with a constant anyone could know | Fixed, #27 |
| 2 | High | Availability | One participant could leave megabytes of signaling waiting in D1; unread signals were only cleared daily | Fixed, #23 |
| 3 | Medium | Web | No Content-Security-Policy or other security headers on pages or API answers; API answers cacheable | Fixed, #21 |
| 4 | Medium | Web / API | State-changing requests were accepted from any website, and JSON was read whatever its content type, so other sites could act through visitors' browsers on the routes that need no token | Fixed, #21 |
| 5 | Medium | Privacy | A private meeting's title, host name, participant count and lock were readable with the link alone, also through the calendar file | Fixed, #30 |
| 6 | Medium | Web | A host link was trusted when opened: it could replace a stored host key, or leave a guest unable to join | Fixed, #30 |
| 7 | Medium | Abuse | Rate limits lived in each Worker instance's memory and counted single IPv6 addresses | Fixed, #25 |
| 8 | Medium | Abuse | Passcode guesses sent at the same moment were not held to the limit | Fixed, #25 |
| 9 | Medium | Availability | Participant records per meeting and the waiting room were unbounded, and every poll reads them all | Fixed, #25 |
| 10 | Low | Authorization | Tokens had no expiry | Fixed, #27 |
| 11 | Low | Privacy | A removed participant kept getting the list of people in the meeting | Fixed, #27 |
| 12 | Low | Abuse | ICE servers (with TURN credentials, valid 24 h) were given to people who had left | Fixed, #27 |
| 13 | Low | Input | No limit on request bodies | Fixed, #23 |
| 14 | Low | Input | Names and titles kept invisible and direction-changing characters | Fixed, #23 |
| 15 | Low | Annotations (PR #16) | A guest could claim to be host and clear everyone's marks | Fixed, #18 (stacked on #16) |
| 16 | Low | Web | Suggested passcodes came from `Math.random` | Fixed, #30 |
| 17 | Info | Repository | No `SECURITY.md`, no Dependabot, actions not pinned, CI did not run the app's tests | Fixed, with this document |

Checked and found sound: host-only routes against guest tokens and wrong keys; tokens across meetings; signal sender and recipient binding; the poll cursor (it only ever touches the caller's own signals); SQL injection; the `.ics` against header and line injection; XSS (one `{@html}`, on the app's own icon set; everything from the API and from peers is rendered as text); open redirects (none: navigation is same-origin paths only); the capacity check under concurrent joins; `npm audit` in both packages (0 known vulnerabilities on 2026-11-24); no secrets in the repository, `.dev.vars` ignored; the workflow runs on `pull_request` with read-only permissions.

## Accepted risks

Each is a decision, not an oversight. Severity is the realistic impact on a deployed instance.

**The server, or a host relaying signaling, could tamper with SDP fingerprints** (High impact, low likelihood). End-to-end verification would need the participants to compare something out of band (a short code derived from the fingerprints, shown on both sides). Worth building if the app is ever used for conversations that must hold against the operator; out of scope for now.

**The daily request budget can be spent by anyone** (High for availability, accepted on the free plan). Every request that reaches the Worker counts against 100,000 a day, including the ones it refuses; about 70 a minute for a day is enough. The Worker cannot defend against that from the inside. What helps is in front of it: a Cloudflare rate-limiting rule on `/api/*` and the paid plan's larger budget ([before the first deploy](#before-the-first-deploy)). The D1 budgets are defended in the app (findings 2, 7, 9).

**Everyone in a meeting learns the others' IP addresses** (Medium, inherent). Peer-to-peer media needs them. Forcing all media through TURN (`iceTransportPolicy: relay`) would hide them from peers at the cost of relaying everything; not offered today.

**A public meeting is as private as its link** (Medium, by design). No passcode, no waiting room: anyone the link reaches can walk in, see who is there and be seen. The UI says "Anyone with the link". Use a waiting room or a private meeting for anything that matters.

**Someone with the link can keep others out of a meeting** (Medium, inherent without accounts). They can take its free seats, queue in its waiting room up to the cap, or, for a private meeting, use up the ten wrong passcodes so that the right one is refused for up to 15 minutes. The host's link is never blocked by any of these, and the host can lock the meeting or remove people. Counting passcode failures per address instead would let a guesser with many addresses through, which is worse.

**Names are not identities** (Medium, inherent without accounts). Anyone can call themselves anything, including the host's name. The Worker says who the host is (`role` in `peers`, #18), but the room does not show it on other people's tiles yet: a small UI follow-up that is worth doing.

**Denied and removed people can ask again** (Low, by design). Deny and remove are not bans: there is nothing to ban but a browser tab. Lock the meeting to keep someone out.

**The passcode hash is weak against someone who has the database** (Low). 30,000 PBKDF2 iterations is what fits in 10 ms of CPU, and a six-digit passcode falls to an offline search at any iteration count. The defence is the online limit of ten guesses, and D1 not leaking. On a paid plan the iteration count can go up (`PASSCODE_ITERATIONS`).

**Secrets in browser storage** (Low). The host key (`localStorage`), the token and a freshly created passcode (`sessionStorage`) are readable by any script that runs on the origin. The Content-Security-Policy is what stands in front of that. A shared computer keeps host keys of the last 50 meetings until site data is cleared.

**A ceiling on new meetings for everyone** (Low, a trade). 300 an hour. Reaching it blocks new meetings until the hour passes, rather than letting a flood from many addresses spend the D1 writes that running meetings need.

**A private meeting's existence, status and time are visible with the link** (Low). The lobby needs them before any passcode is entered.

**TURN credentials go to anyone who can join any meeting** (Low). They last 6 hours and could be used to relay other traffic through the account's TURN allowance. Watch the usage if TURN is configured.

**A participant can flood the others over the data channel** (Low). Annotation messages are validated and capped in what they can draw, not in how fast they arrive. A participant who does that is already in the meeting and can be removed.

**Meeting metadata is kept for a week after a meeting ends**, and request paths (which contain meeting codes) are in Cloudflare's logs for as long as the account keeps them (Info).

## Before the first deploy

Things only the owner of the Cloudflare account and the repository can do:

1. `wrangler secret put SESSION_SECRET` with `openssl rand -base64 32`. The Worker refuses to run without it.
2. Apply the D1 migrations.
3. On the zone: **Always Use HTTPS** and **HSTS** (the app sets no `Strict-Transport-Security` itself, on purpose: it is a zone setting).
4. A **rate-limiting rule** on `/api/*` (the free plan has included one; confirm in the dashboard), per IP, a little above what a browser in a meeting sends (one request a second). This is the only defence of the daily request budget.
5. Turn off the `workers.dev` route if a custom domain is used, so there is one origin.
6. If TURN is configured: a usage alert on the TURN key.
7. In the repository: turn on **private vulnerability reporting** (SECURITY.md points at it), **Dependabot alerts and security updates**, and a rule on `main` that requires CI.

## Not verified

- Anything against Cloudflare itself: nothing was deployed. That includes `_headers` being applied to assets and the single-page fallback (checked with local `wrangler dev` only), the rate limits across real Worker instances, and whether Workers Logs redact the `X-Host-Key` header the way they redact `Authorization` (if they do not, turn request-header logging off or stop using the header from pages that have not joined).
- The Content-Security-Policy in Safari and Firefox, and with screen sharing and several participants (one headless Chrome was used).
- Real SDP sizes from Safari and Firefox against the 32 KB signal limit.
- The relay protocol inside `@packstub/holler` (PR #15's engine side lives in another repository); only the Worker's part was reviewed here.
- PBKDF2's real CPU time on the free plan (the 30,000 comes from the original estimate, not from a measurement on Cloudflare).

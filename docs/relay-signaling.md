# Relayed signaling

Every browser in a meeting polls the Worker every 1 to 3 seconds for as long as the meeting lasts, and on the free plan (100,000 requests a day) those polls are the budget ([api.md](api.md#free-plan-budget)). Signaling is only needed to connect and to notice people come and go, and once two browsers are connected they have a data channel to each other. So with relaying on, **the host's browser is the only one that polls**: it passes on what the Worker says to the guests connected to it, and they stop asking.

It is **off by default**. Nothing on screen changes with it.

- [Turning it on](#turning-it-on)
- [How it works](#how-it-works)
- [What the Worker adds](#what-the-worker-adds)
- [When the host is not there](#when-the-host-is-not-there)
- [What it saves](#what-it-saves)
- [Trust](#trust)
- [Risks and open ends](#risks-and-open-ends)

## Turning it on

| Where | What |
| --- | --- |
| `RELAY_SIGNALING` in `wrangler.jsonc` (`vars`), or in `.dev.vars` locally | `"host"`: meetings created from now on relay through their host. Anything else (the default is `"off"`): every browser polls, as before. |
| `meetings.relay` | Set when the meeting is created, so flipping the variable never changes a running meeting. `GET /api/meetings/:code` returns it as `relay` (`"host"` or `null`). |
| The app | A tab relays when the meeting says `relay: "host"`. `localStorage['meet:relay'] = 'off'` switches it off for one browser, for trying a meeting where some tabs relay and some do not. |

The engine side is `RelaySignaling` in `@packstub/holler` (its README, "Relayed signaling"): a wrapper around `HttpSignaling` that `web/src/lib/holler.ts` puts in when the meeting relays.

## How it works

The **hub** is the host: in the call, from a tab that relays and holds its side. The Worker says who it is in every call it returns (`hub`), so nobody guesses.

1. **The host polls** as always: once a second while someone is connecting, every 3 seconds otherwise. Its poll also brings the waiting room and the people who join.
2. **A guest joins over HTTP** (`/join`, `/answer`) and polls until its connection to the host is up. The offer, the answer and the ICE candidates between the two go through D1, as today.
3. **The data channel `holler:relay` opens** between them, as on every connection between two tabs that relay. The host's next poll names the guest as `present`; the Worker answers with what the guest's own poll would have said (`relay.views`), the host passes that on over the channel, and from that first word **the guest is quiet**: its client still "polls" on its timer, but the answer comes from what the host passed on, with no request.
4. **The next newcomer** connects to the host the same way. The guests already there hear of it from the host and connect to it **through the host**: their offer, answer and candidates travel guest → host → newcomer over the data channels and never reach the Worker.
5. **Two connected tabs talk directly**: mute, camera and screen-share states, and any later renegotiation, go over their own channel.
6. **The host answers for the quiet guests**: its poll is their heartbeat on the Worker, so their seat stays theirs without a request of their own.

What travels over the channel is JSON: `signal` (to pass on, or passed on, or direct), `view` (the hub's word: what my poll would have answered, and who the hub can reach), `ping`, `poll` (signals wait for me in D1: one poll fetches them) and `undelivered` (the hub lost the peer: the sender posts the signal instead).

A signal always takes the shortest way there is: a direct channel, else through the hub, else D1. Signals for someone who relays and is still on their way to the hub wait up to 10 seconds for them, then go to D1.

## What the Worker adds

Everything is additive; `docs/api.md` has the fields. In short, for a meeting with `relay = 'host'`:

- `GET /poll` takes `relay=1` (this tab relays; stored once in `participants.relay`) and, from the hub only, `present=<id>,<id>` (the participants connected to it).
- Every `call` carries `hub` (I am the hub) and every peer `hub` and `relay` (`null` until their tab has polled).
- The hub's poll **is the heartbeat** of the people it names: one `UPDATE` writes their `seen_at` at most every 10 seconds each, the same cadence as their own heartbeat. Only the host, only from the tab that holds its side, only for people in the call whose tab relays and has not sent the `leave` beacon. Everything else about quiet tabs is unchanged: a side is free after 20 seconds without a heartbeat, the person is dropped after 45.
- The hub's answer has `relay: { views, pending }`: `views[id]` is `{ call, incoming, on_hold, meeting }` exactly as that participant's poll would return it (computed from the rows the poll already read, no extra query), `pending` the ids with signals waiting in D1 (one small query, only when `present` is sent).
- When the meeting ends, the host's next poll still carries the views, so the guests hear it from the host.

A poll in a meeting that does not relay ignores all of it.

Migration `0003_relay.sql` adds `meetings.relay` and `participants.relay`.

## When the host is not there

The rule in every case: **no word from the hub, poll**. A guest that polls is exactly today's client.

| Case | What happens | Covered by |
| --- | --- | --- |
| The flag is off | No hub is named, nobody sends `relay`: today's behaviour, request for request | `test/relay.test.ts` (the flag), `test/relay-client.test.ts` (a meeting that does not relay), web `holler.test.ts` |
| A guest arrives before the host (a scheduled meeting) | No hub: the guests poll and connect through D1. When the host joins they connect to it and go quiet | `relay-client.test.ts` "guests who came before the host" |
| The host reloads | Its connections close; each guest polls at once (the channel closing is the signal). The new page takes its side back, sends `reset` and new offers through D1, the guests reconnect and go quiet again | `relay-client.test.ts` "reloads"; **real Chrome**: guests polling within 2 s, quiet again about 10 s later, 3 polls and 3 signals each |
| The host leaves | The guests poll and stay connected to each other; what they tell each other still goes over their channels. A host who joins again is the hub again | `relay-client.test.ts` "leaves" |
| The channel to the host closes, or the connection to it drops | That guest polls at once and rests again when a channel to the host is back; the others are not affected | `relay-client.test.ts` "loses the channel to one guest only", holler-js `relay.test.js` |
| The host's page is frozen or throttled: connected, but silent | Each guest polls after 10 seconds without a word from the host (`hubTimeout`), and rests again when it speaks | holler-js `relay.test.js` "the hub goes silent" |
| The host's tab is gone and its beacon was lost | The Worker stops naming it as hub after 20 seconds; the guests have been polling since their timeout | `relay.test.ts` "is nobody while…" |
| A tab that does not relay is in the meeting (an old page, the switch above) | It polls and signals through D1. A quiet guest answers it through D1 too; the host is told who has signals waiting (`pending`) and tells them to poll once | `relay-client.test.ts` "tabs that relay and tabs that do not", `relay.test.ts` "names who has signals waiting" |
| A guest never gets a connection to the host (their networks do not meet) | It keeps polling. The others' signals for it go to D1 after 10 seconds; whoever is reached over D1 answers over D1 | holler-js `relay.test.js` "their peer never reaches the hub" |
| A quiet guest reloads | Its `leave` beacon frees its side although the host still names it; the new page polls until it is back on the host, and its offers to the other guests go through the host | `relay.test.ts` "free their side with the leave beacon", holler-js "a quiet peer that reloads" |
| The host removes a quiet guest, or ends the meeting | The guest hears it from the host (its view says `ended`, with the reason) | `relay-client.test.ts` "carries the meeting itself to the quiet guests" |
| Two hosts (the host key on two devices) | The one who came first is the hub; the other is connected to it like a guest | not tested |
| The Worker is down | The host's polls fail; it keeps telling the guests it is there, so they do not all start failing too | not tested beyond the unit |

## What it saves

Once connected, a meeting costs **one poll per host poll, whatever its size**, instead of one per participant.

### Measured

`test/relay-client.test.ts` ("what it costs") runs the real `CallClient` against the Worker and local D1 with fake WebRTC, counting every request and D1's `rows_read` / `rows_written`. Each connection exchanges an offer, an answer and 5 candidates per side. The numbers of one run:

| Meeting | | Requests to connect | of which signals | Requests per host poll, once connected | D1 rows read per host poll |
| --- | --- | --- | --- | --- | --- |
| 2 people | every tab polls | 21 | 12 | 2 | 22 |
| | relayed | 25 | 12 | **1** | 15 |
| 3 people | every tab polls | 58 | 36 | 3 | 45 |
| | relayed | 45 | 24 | **1** | 24 |
| 4 people | every tab polls | 117 | 72 | 4 | 67 |
| | relayed | 69 | 36 | **1** | 30 |

Signals to connect grow with the number of people when relayed (12 per guest: the pair with the host) and with the number of pairs when not (12 per pair). The poll counts while connecting are not meaningful here: the fake network connects in milliseconds.

In **Chrome** (three headless browsers with a fake camera, against `wrangler dev` and local D1, on one machine):

| | Measured |
| --- | --- |
| A guest joining a relayed meeting, from opening the link to quiet | 12 to 13 requests in all: the meeting, `/join`, `/ice`, `/answer`, 5 or 6 polls, 3 signals (the answer and two candidates; the rest went over the channel once it opened) |
| The host, per guest who joins | 16 signals (an offer and about 15 candidates, to a guest who is still polling) and about 8 polls at 1 s instead of 3 at 3 s |
| The second guest joining, for the first one | **0 requests**: the first guest's last poll was 51 seconds old when all three saw each other's video |
| A guest, for 50 seconds of a connected meeting | **0 requests** |
| The host reloading, per guest | 3 polls and 3 signals, quiet again about 10 seconds after the reload |
| The host's tab in the background (another tab in front in its window) | still polling every 3 seconds; see [Risks](#risks-and-open-ends) for how long this was watched |

### Per participant-hour

Estimated from the app's poll intervals (3 seconds once connected) and the measured "one request per host poll"; joining is left out (the tables above: tens of requests, once).

| Meeting | Every tab polls | Relayed | Saved |
| --- | --- | --- | --- |
| 2 people | 1,200 requests per participant-hour (2,400 an hour for the meeting) | **600** (1,200 for the meeting) | 50% |
| 3 people | 1,200 (3,600) | **400** (1,200) | 67% |
| 4 people | 1,200 (4,800) | **300** (1,200) | 75% |

On the free plan's 100,000 requests a day that is about **83 meeting-hours a day whatever the size**: roughly 165 participant-hours in meetings of two, 250 in meetings of three, 330 in meetings of four, against about 80 today.

D1 is no longer far behind. Heartbeat writes are unchanged (one row per participant every 10 to 12 seconds, about 300 per participant-hour, whoever's poll writes it), so the 100,000 rows a day allow about 330 participant-hours: with four people in every meeting, writes and requests now run out together. Rows read per participant-hour roughly halve (about 9,000 against 13,000 to 20,000 measured here), so the 5 million a day allow about 550.

A guest in the waiting room still polls `/me` every 4 seconds, relayed or not.

## Trust

The host relays **signaling**: the SDP offers and answers and the ICE candidates of the guests it connects to each other. **Media never passes through it**: audio and video go straight between the two browsers, encrypted (DTLS-SRTP). But the SDP carries the fingerprints that encryption is checked against, so a host that changed them in transit could put itself between two guests. That is the same trust the Worker has today, moved to the host's browser for the pairs it introduces. The host of a meeting can already remove people and end it; it is the participant to trust with this.

A guest takes relayed signals and the roster only from the participant the Worker named as hub; any other peer speaks for itself alone (holler-js `relay.test.js`, "what a peer may say over the channel").

The host's word also keeps guests alive on the Worker: a host could keep a guest who is gone looking present, in its own meeting, until it stops naming them.

## Risks and open ends

- **The host's tab in the background.** Browsers slow timers in a hidden tab. If the host's polls stall, the guests fall back to polling after 10 seconds, so the meeting goes on, but the saving is gone for as long as it lasts, and a guest joining waits for a slower host. What was checked and what was not is in the pull request that added this page; Safari and mobile browsers were not tried.
- **The host's connection matters more.** A guest joins as fast as the host polls and relays. A host on a poor network slows every join down; a host whose page freezes costs every guest a 10-second timeout before they poll again.
- **Not yet in the dev mock.** `web/dev/mock-holler.ts` does not name a hub, so `npm --prefix web run dev` always polls. Use `npm run dev` (the Worker) with `RELAY_SIGNALING=host` in `.dev.vars` to see relaying.
- **The dependency.** `@packstub/holler` is installed from the branch that adds `RelaySignaling` until it is released.
- **Candidates from the host to a newcomer** still go through D1 one request each (about 15 in Chrome). Batching them, or holding them until the channel is open, would cut a join to a handful of requests.

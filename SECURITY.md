# Security

## Reporting a vulnerability

Please report it privately, not in a public issue or pull request:

**[Report a vulnerability](https://github.com/icaliman/meet-holler/security/advisories/new)** (GitHub's private reporting, under the repository's Security tab).

Say what you found, how to reproduce it, and what someone could do with it. You will get an answer within a few days. Once a fix is out, the advisory is published with credit to you, unless you would rather not be named.

Please do not test against other people's meetings, and do not run anything that floods a deployed instance: it runs on a free plan with a small daily budget, and a load test is an outage for everyone.

## What is in scope

- The Worker in `worker/` (the API, the signaling routes, the scheduled cleanup) and the D1 schema in `migrations/`.
- The app in `web/`.
- The configuration and workflows in this repository.

The WebRTC engine, [`@packstub/holler`](https://github.com/packstub/holler-js), has its own repository: report engine issues there.

## What to expect from the design

[docs/security.md](docs/security.md) describes what the server and the host of a meeting can see and do, what a guest can do, and the risks that are accepted on purpose (for example: meetings of up to four people are a mesh, so everyone in a meeting learns the others' IP addresses unless TURN is forced). A report about one of those is still welcome if you see a way to do better.

## Supported versions

The `main` branch.

// @packstub/holler wired to the meeting's signaling routes (docs/api.md, "Holler signaling").
// One meeting is one Holler call whose id is the meeting code.

import { CallClient, HttpSignaling, RelaySignaling, type HttpSignalingRoutes, type PollResult, type RelayMode } from '@packstub/holler'
import type { Meeting, WaitingGuest } from './types'

/** What every poll says about the meeting itself, next to the call. */
export interface PollMeeting {
    status: 'scheduled' | 'open' | 'ended'
    title: string | null
    locked: boolean
    waitingRoom: boolean
    /** The host only: guests in the waiting room, oldest first. */
    waiting?: WaitingGuest[]
}

/** The data channel for the pointer and drawings on a shared screen (#6): every client lists it, in this order. */
export const CHANNELS = ['annotations']

/** Poll fast while connecting, slower once the media flows: signaling is only needed to connect and to notice people come and go. */
export const POLL = { idle: 5000, active: 1000, hidden: 15000 }
export const POLL_CONNECTED = 3000
/** In a meeting that relays: how long the host keeps polling fast for someone it is not connected to yet. */
export const POLL_FAST_FOR = 20_000

const RELAY_SWITCH = 'meet:relay'

/**
 * Whether this tab relays signaling (docs/relay-signaling.md): the meeting says so, and this
 * browser has not switched it off (`localStorage['meet:relay'] = 'off'`, for testing a
 * meeting where some tabs relay and some do not).
 */
export function relays(meeting: Pick<Meeting, 'relay'> | null | undefined): boolean {
    if (meeting?.relay !== 'host') return false
    try {
        return localStorage.getItem(RELAY_SWITCH) !== 'off'
    } catch {
        return true
    }
}

export function routes(code: string): HttpSignalingRoutes {
    const base = `/api/meetings/${encodeURIComponent(code)}/holler`

    return {
        poll: `${base}/poll`,
        // Required by HttpSignaling; a meeting rings nobody, so the Worker answers 422.
        store: `${base}/start`,
        answer: `${base}/answer`,
        decline: `${base}/decline`,
        hangup: `${base}/hangup`,
        signal: `${base}/signals`,
        leave: `${base}/leave`,
        ice: `${base}/ice`,
    }
}

/**
 * HttpSignaling for one meeting. `onMeeting` receives the `meeting` field of every poll
 * answer (HttpSignaling itself only passes the call on), so the room needs no second poll
 * for the lock, the waiting room or the host's waiting list.
 */
export function signalingFor(code: string, token: string, onMeeting?: (meeting: PollMeeting) => void, fetchFn: typeof fetch = (...args) => globalThis.fetch(...args)): HttpSignaling {
    const peek: typeof fetch = async (input, init) => {
        const response = await fetchFn(input, init)
        if (onMeeting && String(input).includes('/holler/poll') && response.ok) {
            response.clone().json().then((data) => {
                if (data?.meeting) onMeeting(data.meeting as PollMeeting)
            }).catch(() => {})
        }

        return response
    }

    return new HttpSignaling({
        routes: routes(code),
        headers: { Authorization: `Bearer ${token}` },
        // The leave beacon cannot send headers.
        beaconFields: { token },
        fetch: peek,
    })
}

export interface ClientOptions {
    code: string
    token: string
    onMeeting?: (meeting: PollMeeting) => void
    /** Relay signaling through the host (see `relays()`); off, every tab polls as before. */
    relay?: boolean
    /** Told `hub`, `quiet` or `polling` as it changes, in a meeting that relays. */
    onRelayMode?: (mode: RelayMode) => void
    /** The lobby's camera and microphone, handed over so the browser does not ask twice. */
    stream?: MediaStream | null
    video?: boolean
    devices?: { microphone?: string | null, camera?: string | null, speaker?: string | null }
    fetch?: typeof fetch
}

/**
 * The same signaling with the host as relay: the host's tab keeps polling, a guest's tab stops
 * once it is connected to the host and polls again whenever the host is not there. A quiet tab
 * makes no poll request to peek at, so the meeting the host passes on is read from the answer.
 */
export function relayedSignalingFor(code: string, token: string, onMeeting?: (meeting: PollMeeting) => void, fetchFn?: typeof fetch): { http: HttpSignaling, relay: RelaySignaling } {
    const http = signalingFor(code, token, onMeeting, fetchFn)
    const relay = new RelaySignaling(http)
    const poll = relay.poll.bind(relay)
    relay.poll = async (options) => {
        const answer = await poll(options) as PollResult & { meeting?: PollMeeting }
        if (onMeeting && relay.quiet && answer.meeting) onMeeting(answer.meeting)

        return answer
    }

    return { http, relay }
}

export function clientFor({ code, token, onMeeting, relay = false, onRelayMode, stream = null, video = true, devices = {}, fetch: fetchFn }: ClientOptions): CallClient {
    const relayed = relay ? relayedSignalingFor(code, token, onMeeting, fetchFn) : null
    const signaling = relayed?.http ?? signalingFor(code, token, onMeeting, fetchFn)
    let handed = stream

    const client = new CallClient({
        signaling: relayed?.relay ?? signaling,
        iceServers: () => signaling.configuration().then((rtc) => rtc.iceServers),
        maxParticipants: 4,
        poll: { ...POLL },
        channels: CHANNELS,
        video,
        devices,
        getUserMedia: (constraints) => {
            // The first ask gets the stream the lobby already opened.
            if (handed && handed.getTracks().some((track) => track.readyState === 'live')) {
                const given = handed
                handed = null

                return Promise.resolve(given)
            }

            return navigator.mediaDevices.getUserMedia(constraints)
        },
    })

    // Slow the polls down once media flows (docs/api.md, free-plan budget). `pollIntervals`
    // is the client's own setting, not in its typings.
    const intervals = (client as unknown as { pollIntervals?: { active: number } }).pollIntervals

    if (! relayed) {
        client.addEventListener('statechange', ({ detail: { state } }) => {
            if (intervals) intervals.active = state === 'active' ? POLL_CONNECTED : POLL.active
        })

        return client
    }

    // Relaying: the host is the only one polling, so a newcomer waits on its pace. Fast while
    // the call is not up or someone in it is not connected to me yet (for a while: a guest who
    // never connects must not keep the host at one request a second), slow otherwise.
    const waitingSince = new Map<string, number>()
    let recheck: ReturnType<typeof setTimeout> | undefined
    const pace = () => {
        clearTimeout(recheck)
        const now = Date.now()
        const waiting = client.peers.filter((peer) => peer.status === 'joined' && ! peer.connected).map((peer) => peer.id)
        for (const id of [...waitingSince.keys()]) if (! waiting.includes(id)) waitingSince.delete(id)
        for (const id of waiting) if (! waitingSince.has(id)) waitingSince.set(id, now)
        const fresh = [...waitingSince.values()].filter((since) => now - since < POLL_FAST_FOR)
        const fast = client.state !== 'active' || fresh.length > 0
        if (intervals) intervals.active = fast ? POLL.active : POLL_CONNECTED
        if (fresh.length) recheck = setTimeout(pace, POLL_FAST_FOR - (now - Math.min(...fresh)) + 50)
    }
    client.addEventListener('statechange', pace)
    client.addEventListener('peers', pace)
    client.addEventListener('ended', () => clearTimeout(recheck))

    relayed.relay.addEventListener('modechange', ({ detail: { mode } }) => onRelayMode?.(mode))

    return client
}

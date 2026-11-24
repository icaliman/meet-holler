// @packstub/holler wired to the meeting's signaling routes (docs/api.md, "Holler signaling").
// One meeting is one Holler call whose id is the meeting code.

import { CallClient, HttpSignaling, type HttpSignalingRoutes } from '@packstub/holler'
import type { WaitingGuest } from './types'

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
    /** The lobby's camera and microphone, handed over so the browser does not ask twice. */
    stream?: MediaStream | null
    video?: boolean
    devices?: { microphone?: string | null, camera?: string | null, speaker?: string | null }
    fetch?: typeof fetch
}

export function clientFor({ code, token, onMeeting, stream = null, video = true, devices = {}, fetch: fetchFn }: ClientOptions): CallClient {
    const signaling = signalingFor(code, token, onMeeting, fetchFn)
    let handed = stream

    const client = new CallClient({
        signaling,
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
    client.addEventListener('statechange', ({ detail: { state } }) => {
        const intervals = (client as unknown as { pollIntervals?: { active: number } }).pollIntervals
        if (intervals) intervals.active = state === 'active' ? POLL_CONNECTED : POLL.active
    })

    return client
}

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

export type Role = 'host' | 'guest'

/**
 * Who the Worker says is the host and who a guest, by participant id, from a poll's answer
 * (`role` on each entry of `peers`). The engine's roster does not carry the field, so the
 * room reads it here. Optional on the wire: a backend that sends no role names nobody, and
 * then nobody is taken for the host.
 */
export function rolesIn(answer: unknown): Map<string, Role> {
    const roles = new Map<string, Role>()
    const data = (answer ?? {}) as Record<string, { peers?: unknown } | null | undefined>
    for (const call of [data.call, data.incoming, data.on_hold]) {
        if (! Array.isArray(call?.peers)) continue
        for (const peer of call.peers as Array<{ id?: unknown, role?: unknown } | null>) {
            if (peer && (typeof peer.id === 'string' || typeof peer.id === 'number') && (peer.role === 'host' || peer.role === 'guest')) roles.set(String(peer.id), peer.role)
        }
    }

    return roles
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
export function signalingFor(code: string, token: string, onMeeting?: (meeting: PollMeeting) => void, fetchFn: typeof fetch = (...args) => globalThis.fetch(...args), onRoles?: (roles: Map<string, Role>) => void): HttpSignaling {
    const peek: typeof fetch = async (input, init) => {
        const response = await fetchFn(input, init)
        if ((onMeeting || onRoles) && String(input).includes('/holler/poll') && response.ok) {
            response.clone().json().then((data) => {
                if (data?.meeting) onMeeting?.(data.meeting as PollMeeting)
                onRoles?.(rolesIn(data))
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
    /** The roles the Worker names in each poll (see `rolesIn`). */
    onRoles?: (roles: Map<string, Role>) => void
    /** The lobby's camera and microphone, handed over so the browser does not ask twice. */
    stream?: MediaStream | null
    video?: boolean
    devices?: { microphone?: string | null, camera?: string | null, speaker?: string | null }
    fetch?: typeof fetch
}

export function clientFor({ code, token, onMeeting, onRoles, stream = null, video = true, devices = {}, fetch: fetchFn }: ClientOptions): CallClient {
    const signaling = signalingFor(code, token, onMeeting, fetchFn, onRoles)
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

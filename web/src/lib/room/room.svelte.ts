// The live meeting room: @packstub/holler's CallClient as Svelte state, plus the host's
// controls over the API. Components read it through RoomLike (types.ts).

import type { CallClient, CallState, DeviceKind, DeviceList, Peer } from '@packstub/holler'
import { api } from '../api'
import { clientFor, type PollMeeting } from '../holler'
import { announce } from '../ui/announce.svelte'
import { dismiss, toast } from '../ui/toast-store.svelte'
import type { Participant, WaitingGuest } from '../types'
import { LevelMeter, type Voice } from './levels'
import type { Person, RoomLike } from './types'

export interface RoomOptions {
    code: string
    token: string
    me: Participant
    /** The lobby's stream, handed to the client so the browser does not ask again. */
    stream: MediaStream | null
    muted: boolean
    cameraOff: boolean
    devices: { microphone: string | null, camera: string | null, speaker: string | null }
    /**
     * The call ended without me pressing Leave. `othersAlive`: someone else's window was
     * still polling, so the trouble was on my side; otherwise they had all gone quiet.
     */
    onEnded: (reason: string, othersAlive: boolean) => void
    /** The client to use (tests); made from the options otherwise. */
    client?: CallClient
}

const DEVICES_KEY = 'holler:devices'

export function savedDevices(): { microphone: string | null, camera: string | null, speaker: string | null } {
    try {
        return { microphone: null, camera: null, speaker: null, ...JSON.parse(localStorage.getItem(DEVICES_KEY) ?? '{}') }
    } catch {
        return { microphone: null, camera: null, speaker: null }
    }
}

export function rememberDevices(selected: { microphone: string | null, camera: string | null, speaker: string | null }): void {
    try {
        localStorage.setItem(DEVICES_KEY, JSON.stringify(selected))
    } catch {
        // Storage off: the next meeting starts with the system's devices.
    }
}

export class Room implements RoomLike {
    readonly code: string
    readonly isHost: boolean
    state = $state<CallState>('idle')
    people = $state.raw<Person[]>([])
    voices = $state.raw<Map<string, Voice>>(new Map())
    meeting = $state.raw<PollMeeting | null>(null)
    waiting = $state.raw<WaitingGuest[]>([])
    muted = $state(false)
    cameraOff = $state(false)
    sharing = $state(false)
    hasCamera = $state(true)
    hasMicrophone = $state(true)
    speaker = $state<string | null>(null)
    readonly canShare = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

    private client: CallClient
    private me: Participant
    private bearer: string
    private meter: LevelMeter
    private leaving = false
    private everConnected = false
    private waitingToasts = new Map<string, number>()
    private qualityWarned = new Set<string>()
    private onPageHide = () => this.client.leave()
    private onEnded: RoomOptions['onEnded']

    constructor(options: RoomOptions) {
        this.code = options.code
        this.me = options.me
        this.bearer = options.token
        this.isHost = options.me.role === 'host'
        this.muted = options.muted
        this.cameraOff = options.cameraOff
        this.speaker = options.devices.speaker
        this.onEnded = options.onEnded
        this.hasCamera = Boolean(options.stream?.getVideoTracks().length) || ! options.stream
        this.hasMicrophone = Boolean(options.stream?.getAudioTracks().length) || ! options.stream

        this.client = options.client ?? clientFor({
            code: options.code,
            token: options.token,
            stream: options.stream,
            video: this.hasCamera,
            devices: options.devices,
            onMeeting: (meeting) => this.meetingChanged(meeting),
        })
        this.meter = new LevelMeter((voices) => { this.voices = voices })

        this.client.setMuted(this.muted)
        this.client.setCameraOff(this.cameraOff)
        this.listen()
    }

    start(): void {
        this.client.resumeCall(this.code, { answer: true })
        addEventListener('pagehide', this.onPageHide)
        this.sync()
    }

    private listen(): void {
        const c = this.client
        c.addEventListener('statechange', ({ detail: { state } }) => {
            const was = this.state
            this.state = state
            if (state === 'active') this.everConnected = true
            if (state === 'reconnecting' && was === 'active') announce('Connection lost. Trying to get you back…')
            if (state === 'active' && was === 'reconnecting') announce("You're back.")
        })
        c.addEventListener('localstream', () => this.sync())
        c.addEventListener('remotestream', () => this.sync())
        c.addEventListener('peers', () => this.sync())
        c.addEventListener('peerstate', () => this.sync())
        c.addEventListener('peerjoined', ({ detail: { peer } }) => {
            toast('joined.', { who: peer.name, timeout: 3000 })
        })
        c.addEventListener('peerleft', ({ detail: { peer, reason } }) => {
            this.qualityWarned.delete(peer.id)
            if (reason === 'left' || reason === 'dropped') toast(reason === 'dropped' ? 'lost their connection and left.' : 'left.', { who: peer.name, timeout: 3000 })
        })
        c.addEventListener('quality', ({ detail: { peer, quality } }) => {
            this.sync()
            if (quality === 'poor' && ! this.qualityWarned.has(peer.id)) {
                this.qualityWarned.add(peer.id)
                toast("'s connection is weak. Their video may freeze.", { who: peer.name, timeout: 5000 })
            }
            if (quality === 'good') this.qualityWarned.delete(peer.id)
        })
        c.addEventListener('devices', ({ detail: { selected } }) => {
            this.speaker = selected.speaker
            rememberDevices(selected)
        })
        c.addEventListener('error', ({ detail: { error, media } }) => {
            if (! media) return
            const name = (error as Error)?.name
            toast(name === 'NotAllowedError'
                ? 'Your browser is blocking the camera or microphone. Allow it in the address bar, then try again.'
                : "We couldn't use that camera or microphone. Pick another one in Settings.", { tone: 'error', timeout: 7000 })
        })
        c.addEventListener('ended', ({ detail: { reason } }) => {
            const othersAlive = this.people.some((p) => ! p.me && p.alive)
            this.cleanUp()
            if (this.leaving) return
            this.onEnded(reason, othersAlive)
        })
    }

    /** The roster from the client, me first. */
    private sync(): void {
        const c = this.client
        const mine: Person = {
            id: this.me.id,
            name: this.me.name,
            seat: (c.call?.seat as number | undefined) ?? 0,
            me: true,
            stream: c.localStream,
            muted: c.muted,
            cameraOff: c.cameraOff || ! c.localStream?.getVideoTracks().length,
            sharing: c.sharing,
            connected: true,
            alive: true,
            quality: null,
        }
        const others = c.peers
            .filter((p: Peer) => p.status === 'joined' || p.status === 'ringing')
            .sort((a, b) => a.seat - b.seat)
            .map((p: Peer): Person => ({
                id: p.id,
                name: p.name,
                seat: p.seat,
                me: false,
                stream: p.stream,
                muted: p.muted,
                cameraOff: p.cameraOff,
                sharing: p.sharing,
                connected: p.connected,
                alive: p.alive,
                quality: p.quality,
            }))
        this.people = [mine, ...others]
        this.muted = c.muted
        this.cameraOff = c.cameraOff
        this.sharing = c.sharing

        // Voice levels: mine from the camera stream (not the screen), theirs from their stream.
        this.meter.watch('me', c.cameraStream)
        for (const p of others) this.meter.watch(p.id, p.stream)
        this.meter.keep(['me', ...others.map((p) => p.id)])
    }

    private meetingChanged(meeting: PollMeeting): void {
        const before = this.meeting
        this.meeting = meeting
        if (before && before.locked !== meeting.locked) announce(meeting.locked ? 'The meeting is locked.' : 'The meeting is unlocked.')

        if (! this.isHost) return
        const waiting = meeting.waiting ?? []
        this.waiting = waiting
        const ids = new Set(waiting.map((w) => w.id))

        // One toast per guest who wants in, with Admit and Deny, until it is answered.
        for (const guest of waiting) {
            if (this.waitingToasts.has(guest.id)) continue
            this.waitingToasts.set(guest.id, toast('wants to join.', {
                who: guest.name,
                actions: [
                    { label: 'Deny', variant: 'secondary', run: () => this.deny(guest.id) },
                    { label: 'Admit', variant: 'primary', run: () => this.admit(guest.id) },
                ],
            }))
        }
        for (const [id, toastId] of this.waitingToasts) {
            if (ids.has(id)) continue
            dismiss(toastId)
            this.waitingToasts.delete(id)
        }
    }

    toggleMic(): void {
        this.client.setMuted(! this.client.muted)
        this.sync()
        announce(this.client.muted ? 'Microphone off.' : 'Microphone on.')
    }

    toggleCamera(): void {
        this.client.setCameraOff(! this.client.cameraOff)
        this.sync()
        announce(this.client.cameraOff ? 'Camera off.' : 'Camera on.')
    }

    async toggleShare(): Promise<void> {
        try {
            if (this.client.sharing) await this.client.stopSharing()
            else await this.client.shareScreen()
        } catch (error) {
            // Closing the browser's picker is a choice, not an error.
            if ((error as Error)?.name !== 'NotAllowedError' && (error as Error)?.name !== 'AbortError') {
                toast("We couldn't share your screen. Try again, or pick another window.", { tone: 'error' })
            }
        }
        this.sync()
        announce(this.client.sharing ? "You're sharing your screen." : 'You stopped sharing.')
    }

    async leave(): Promise<void> {
        this.leaving = true
        await this.client.hangUp().catch(() => {})
        this.cleanUp()
    }

    async endForAll(): Promise<void> {
        try {
            await api.end(this.code, this.token())
        } catch {
            toast("We couldn't end the meeting. Try again.", { tone: 'error' })
            return
        }
        this.leaving = true
        await this.client.hangUp().catch(() => {})
        this.cleanUp()
    }

    async setLocked(locked: boolean): Promise<void> {
        try {
            const { meeting } = await api.update(this.code, { locked }, this.token())
            this.meeting = { ...(this.meeting ?? { status: 'open', title: null, waitingRoom: meeting.waitingRoom }), locked: meeting.locked, waitingRoom: meeting.waitingRoom }
            announce(locked ? 'Meeting locked. Nobody new can join.' : 'Meeting unlocked.')
        } catch {
            toast(locked ? "We couldn't lock the meeting. Try again." : "We couldn't unlock the meeting. Try again.", { tone: 'error' })
        }
    }

    async setWaitingRoom(on: boolean): Promise<void> {
        try {
            const { meeting } = await api.update(this.code, { waitingRoom: on }, this.token())
            this.meeting = { ...(this.meeting ?? { status: 'open', title: null, locked: meeting.locked }), waitingRoom: meeting.waitingRoom, locked: meeting.locked }
            announce(on ? 'Waiting room on. You let each guest in.' : 'Waiting room off. Guests come straight in.')
        } catch {
            toast("We couldn't change the waiting room. Try again.", { tone: 'error' })
        }
    }

    async admit(id: string): Promise<void> {
        const guest = this.waiting.find((w) => w.id === id)
        try {
            await api.admit(this.code, id, this.token())
            this.forgetWaiting(id)
            announce(`${guest?.name ?? 'Your guest'} is coming in.`)
        } catch (error) {
            this.forgetWaiting(id)
            const full = (error as { code?: string })?.code === 'full'
            toast(full ? 'The meeting is full, so nobody else can come in.' : `${guest?.name ?? 'That guest'} is no longer waiting.`, { tone: full ? 'error' : 'info' })
        }
    }

    async deny(id: string): Promise<void> {
        const guest = this.waiting.find((w) => w.id === id)
        try {
            await api.deny(this.code, id, this.token())
            announce(`${guest?.name ?? 'Your guest'} was not let in.`)
        } catch {
            // Gone already: nothing to deny.
        }
        this.forgetWaiting(id)
    }

    async remove(id: string): Promise<void> {
        const person = this.people.find((p) => p.id === id)
        try {
            await api.remove(this.code, id, this.token())
            toast('was removed from the meeting.', { who: person?.name, timeout: 3000 })
        } catch {
            toast(`We couldn't remove ${person?.name ?? 'them'}. Try again.`, { tone: 'error' })
        }
    }

    devices(): Promise<DeviceList> {
        return this.client.devices()
    }

    async setDevice(kind: DeviceKind, id: string | null): Promise<void> {
        await this.client.setDevice(kind, id)
        if (kind === 'speaker') this.speaker = id
        this.sync()
    }

    private forgetWaiting(id: string): void {
        this.waiting = this.waiting.filter((w) => w.id !== id)
        const toastId = this.waitingToasts.get(id)
        if (toastId) dismiss(toastId)
        this.waitingToasts.delete(id)
    }

    private token(): string {
        return this.bearer
    }

    private cleanUp(): void {
        removeEventListener('pagehide', this.onPageHide)
        this.meter.destroy()
        for (const id of this.waitingToasts.values()) dismiss(id)
        this.waitingToasts.clear()
    }

    destroy(): void {
        this.cleanUp()
        this.client.destroy()
    }

    /** For tests and the console: whether the media ever flowed. */
    get connectedOnce(): boolean {
        return this.everConnected
    }
}

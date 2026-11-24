// The camera and microphone in the lobby: opened once, previewed, switched, and then handed
// to the room so the browser does not ask a second time.

import type { DeviceKind, DeviceList } from '@packstub/holler'
import { openMedia, type MediaProblem } from './media'
import { rememberDevices, savedDevices } from './room.svelte'

export class Preview {
    stream = $state.raw<MediaStream | null>(null)
    camera = $state<MediaProblem | null>(null)
    microphone = $state<MediaProblem | null>(null)
    asking = $state(false)
    muted = $state(false)
    cameraOff = $state(false)
    devices = $state(savedDevices())

    get live(): boolean {
        return Boolean(this.stream?.getTracks().some((t) => t.readyState === 'live'))
    }

    async open(): Promise<void> {
        if (this.asking) return
        this.asking = true
        try {
            this.stop()
            const opened = await openMedia(this.devices)
            this.stream = opened.stream
            this.camera = opened.camera
            this.microphone = opened.microphone
            this.apply()
        } finally {
            this.asking = false
        }
    }

    /** Make sure there is a live stream (it ends when a call ends); asks only when there is none. */
    async ensure(): Promise<void> {
        if (! this.live) await this.open()
    }

    toggleMic(): void {
        this.muted = ! this.muted
        this.apply()
    }

    toggleCamera(): void {
        this.cameraOff = ! this.cameraOff
        this.apply()
    }

    private apply(): void {
        this.stream?.getAudioTracks().forEach((t) => { t.enabled = ! this.muted })
        this.stream?.getVideoTracks().forEach((t) => { t.enabled = ! this.cameraOff })
    }

    async list(): Promise<DeviceList> {
        const all = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) ?? []
        const of = (kind: MediaDeviceKind) => all
            .filter((d) => d.kind === kind && d.deviceId && ! ['default', 'communications'].includes(d.deviceId))
            .map((d) => ({ id: d.deviceId, label: d.label }))

        return { microphones: of('audioinput'), cameras: of('videoinput'), speakers: of('audiooutput'), selected: { ...this.devices } }
    }

    async choose(kind: DeviceKind, id: string | null): Promise<void> {
        this.devices = { ...this.devices, [kind]: id }
        rememberDevices(this.devices)
        if (kind !== 'speaker') await this.open()
    }

    /** The room takes the stream over: the preview no longer stops it. */
    handOver(): MediaStream | null {
        const stream = this.stream

        return stream
    }

    stop(): void {
        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null
    }
}

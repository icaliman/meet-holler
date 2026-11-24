// Dev only (/dev/room): a meeting room with made-up people, no WebRTC and no camera, to look
// at layouts, the speaking ring, host controls and states. Never part of the build.

import type { CallState, DeviceKind, DeviceList } from '@packstub/holler'
import type { PollMeeting } from '../lib/holler'
import type { WaitingGuest } from '../lib/types'
import type { Voice } from '../lib/room/levels'
import type { Person, RoomLike } from '../lib/room/types'
import { toast } from '../lib/ui/toast-store.svelte'
import { Annotations } from '../lib/annotate/annotations.svelte'
import { encode } from '../lib/annotate/protocol'
import { localWire } from '../lib/annotate/wire'

const NAMES = ['Ion', 'Ana Pop', 'Mihai', 'Dana']
const HUES = ['#2A3015', '#2B2638', '#1E2E36', '#3A2A21']

/** A moving picture from a canvas: a soft shape on the seat's tint, standing in for a camera. */
function fakeCamera(seat: number, label: string, screen = false): MediaStream | null {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = screen ? 1280 : 640
    canvas.height = screen ? 800 : 480
    const ctx = canvas.getContext('2d')
    if (! ctx || ! ('captureStream' in canvas)) return null
    let t = seat * 40
    const draw = () => {
        t++
        if (screen) {
            ctx.fillStyle = '#F4EFE4'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.fillStyle = '#1A1712'
            ctx.font = 'bold 56px sans-serif'
            ctx.fillText('Q4 roadmap', 80, 140)
            ctx.font = '28px sans-serif'
            ;['Ship the waiting room', 'Pointer on shared screens', 'TURN for office networks'].forEach((line, i) => ctx.fillText(`•  ${line}`, 100, 240 + i * 60))
            ctx.fillStyle = '#D4F53C'
            ctx.fillRect(80, 480 + Math.sin(t / 30) * 6, 600, 180)
        } else {
            const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
            g.addColorStop(0, HUES[seat % 4])
            g.addColorStop(1, '#0B0A08')
            ctx.fillStyle = g
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.fillStyle = ['#D4F53C', '#B8A3FF', '#74D0F5', '#FFAE82'][seat % 4]
            const x = canvas.width / 2 + Math.sin(t / 50) * 20
            ctx.beginPath()
            ctx.arc(x, 200, 80, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.ellipse(x, 470, 170, 150, 0, Math.PI, 0)
            ctx.fill()
        }
        ctx.fillStyle = 'rgba(0,0,0,0)'
        ctx.fillText(label, 0, 0)
    }
    const timer = setInterval(draw, 1000 / 24)
    draw()
    const stream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(24)
    stream.getVideoTracks()[0]?.addEventListener('ended', () => clearInterval(timer))

    return stream
}

export class DemoRoom implements RoomLike {
    readonly code = 'xxxdemoxxx'
    isHost = $state(true)
    state = $state<CallState>('active')
    people = $state.raw<Person[]>([])
    voices = $state.raw<Map<string, Voice>>(new Map())
    meeting = $state.raw<PollMeeting | null>({ status: 'open', title: 'Design review', locked: false, waitingRoom: true, waiting: [] })
    waiting = $state.raw<WaitingGuest[]>([])
    muted = $state(false)
    cameraOff = $state(false)
    sharing = $state(false)
    hasCamera = true
    hasMicrophone = true
    canShare = true
    speaker = $state<string | null>(null)
    private wire = localWire()
    annotations = new Annotations({ wire: this.wire, me: { id: 'p0', isHost: true } })
    private marksTimer: ReturnType<typeof setInterval> | null = null
    private timer: ReturnType<typeof setInterval>

    constructor({ marks = false, count = 4, share = false, waiting = 0, cameraOff = [] as number[], poor = [] as number[], away = [] as number[] } = {}) {
        this.people = NAMES.slice(0, count).map((name, seat) => ({
            id: `p${seat}`,
            name,
            seat,
            me: seat === 0,
            stream: cameraOff.includes(seat) ? null : fakeCamera(seat, name, share && seat === 1),
            muted: seat === 2,
            cameraOff: cameraOff.includes(seat),
            sharing: share && seat === 1,
            connected: ! away.includes(seat),
            alive: ! away.includes(seat),
            quality: poor.includes(seat) ? 'poor' : 'good',
        }))
        this.waiting = Array.from({ length: waiting }, (_, i) => ({ id: `w${i}`, name: ['Radu', 'Elena'][i % 2], since: new Date().toISOString() }))
        // Someone talks, then someone else.
        let tick = 0
        this.timer = setInterval(() => {
            tick++
            const talker = Math.floor(tick / 25) % Math.max(1, count)
            const voices = new Map<string, Voice>()
            for (const p of this.people) {
                const on = p.seat === talker && ! p.muted
                voices.set(p.me ? 'me' : p.id, { level: on ? 0.15 + Math.abs(Math.sin(tick / 2)) * 0.3 : 0, speaking: on, quietFor: 0 })
            }
            this.voices = voices
        }, 100)
        this.syncMarks()
        if (marks && share && count > 1) this.playMarks(count)
        for (const guest of this.waiting) {
            toast('wants to join.', { who: guest.name, actions: [
                { label: 'Deny', variant: 'secondary', run: () => this.deny(guest.id) },
                { label: 'Admit', variant: 'primary', run: () => this.admit(guest.id) },
            ] })
        }
    }

    private patchMe(change: Partial<Person>) {
        this.people = this.people.map((p) => (p.me ? { ...p, ...change } : p))
        this.syncMarks()
    }

    private syncMarks() {
        this.annotations.rosterChanged(this.people.map(({ id, name, seat, me, sharing }) => ({ id, name, seat, me, sharing, host: me })))
    }

    /** Ana (sharing) points around the slide, Mihai circles a line and draws an arrow to it. */
    private playMarks(count: number) {
        let t = 0
        let stroke = 0
        const s = 'p1'
        const send = (from: string, message: object) => this.wire.deliver(from, encode({ v: 1, s, ...message } as Parameters<typeof encode>[0]))
        this.marksTimer = setInterval(() => {
            t++
            send('p1', { t: 'ptr', x: 0.32 + Math.cos(t / 12) * 0.08, y: 0.3 + Math.sin(t / 12) * 0.05 })
            if (count < 3) return
            const phase = t % 120
            if (phase === 1) {
                stroke++
                const ring = Array.from({ length: 40 }, (_, i) => [0.36 + Math.cos(i / 6) * 0.3, 0.38 + Math.sin(i / 6) * 0.06]).flat()
                send('p2', { t: 'stroke', id: stroke * 2, tool: 'pen', pts: ring, end: true })
                send('p2', { t: 'stroke', id: stroke * 2 + 1, tool: 'arrow', pts: [0.86, 0.66, 0.6, 0.45], end: true })
                send('p2', { t: 'ptr', x: 0.86, y: 0.66 })
            }
        }, 50)
    }

    toggleMic() { this.muted = ! this.muted; this.patchMe({ muted: this.muted }) }
    toggleCamera() { this.cameraOff = ! this.cameraOff; this.patchMe({ cameraOff: this.cameraOff }) }
    async toggleShare() { this.sharing = ! this.sharing; this.patchMe({ sharing: this.sharing }) }
    async leave() {}
    async endForAll() {}
    async setLocked(locked: boolean) { this.meeting = { ...this.meeting!, locked } }
    async setWaitingRoom(on: boolean) { this.meeting = { ...this.meeting!, waitingRoom: on } }
    async admit(id: string) { this.waiting = this.waiting.filter((w) => w.id !== id) }
    async deny(id: string) { this.waiting = this.waiting.filter((w) => w.id !== id) }
    async remove(id: string) { this.people = this.people.filter((p) => p.id !== id); this.syncMarks() }
    async devices(): Promise<DeviceList> {
        return { microphones: [{ id: 'm1', label: 'MacBook Pro Microphone' }], cameras: [{ id: 'c1', label: 'FaceTime HD Camera' }], speakers: [], selected: { microphone: null, camera: null, speaker: null } }
    }
    async setDevice(_kind: DeviceKind, _id: string | null) {}
    destroy() {
        clearInterval(this.timer)
        if (this.marksTimer) clearInterval(this.marksTimer)
        this.annotations.destroy()
    }
}

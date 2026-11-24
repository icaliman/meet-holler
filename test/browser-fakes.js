// The browser side of holler-js's own test doubles (tests/fakes.js in
// packstub/holler-js, MIT): a fake RTCPeerConnection, media streams and
// devices, so a real CallClient runs inside the Worker's tests. The in-memory
// signaling server is left out: the Worker is the server here.

/**
 * Test doubles for the engine: the WebRTC and media globals a browser would
 * provide, and an in-memory signaling server that follows the same rules as
 * the HTTP backend (one window holds a participant's side, signals flow only to
 * the holder, a cursor so nothing is missed or repeated, a seat per participant).
 */

import { vi } from 'vitest'

let ids = 0
const nextId = (prefix) => `${prefix}-${++ids}`

export class FakeTrack extends EventTarget {
    constructor(kind, label = kind) {
        super()
        this.id = nextId(kind)
        this.kind = kind
        this.label = label
        this.enabled = true
        this.readyState = 'live'
    }

    stop() {
        this.readyState = 'ended'
    }

    /** The browser's own "Stop sharing" bar, or a camera unplugged. */
    end() {
        this.stop()
        this.dispatchEvent(new Event('ended'))
    }
}

export class FakeMediaStream {
    constructor(tracks = []) {
        this.id = nextId('stream')
        this.tracks = [...tracks]
    }

    getTracks() { return [...this.tracks] }
    getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio') }
    getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video') }
    addTrack(track) { this.tracks.push(track) }
    removeTrack(track) { this.tracks = this.tracks.filter((candidate) => candidate !== track) }
}

export class FakeDataChannel extends EventTarget {
    constructor(label, options = {}) {
        super()
        this.label = label
        this.options = options
        this.readyState = 'connecting'
        this.bufferedAmount = 0
        this.bufferedAmountLowThreshold = 0
        this.sent = []
    }

    send(data) {
        if (this.readyState !== 'open') throw new Error('InvalidStateError')
        this.sent.push(data)
        // Wired to the other side's channel (`joinChannels()`): it arrives there, in order, a moment later.
        const remote = this.remote
        if (remote) queueMicrotask(() => { if (remote.readyState === 'open') remote.dispatchEvent(Object.assign(new Event('message'), { data })) })
    }

    close() {
        if (this.readyState === 'closed') return
        this.readyState = 'closed'
        this.dispatchEvent(new Event('close'))
        // Closing one end closes the other.
        const remote = this.remote
        this.remote = null
        if (remote?.readyState === 'open') remote.close()
    }

    // ---- what the network would do ------------------------------------------

    open() {
        this.readyState = 'open'
        this.dispatchEvent(new Event('open'))
    }

    /** The browser sent what was queued down to the threshold. */
    drained() {
        this.bufferedAmount = 0
        this.dispatchEvent(new Event('bufferedamountlow'))
    }
}

export class FakeRTCPeerConnection extends EventTarget {
    static instances = []

    constructor(configuration = {}) {
        super()
        this.id = nextId('pc')
        this.configuration = configuration
        this.senders = []
        this.signalingState = 'stable'
        this.connectionState = 'new'
        this.localDescription = null
        this.remoteDescription = null
        this.candidates = []
        this.closed = false
        this.iceRestarts = 0
        FakeRTCPeerConnection.instances.push(this)
    }

    static get latest() {
        return FakeRTCPeerConnection.instances.at(-1)
    }

    static reset() {
        FakeRTCPeerConnection.instances = []
    }

    addTrack(track, stream) {
        const sender = { track, stream, replaced: [], replaceTrack: async (next) => { sender.replaced.push(next); sender.track = next } }
        this.senders.push(sender)
        // Browsers fire negotiationneeded once the current task ends, once for any number of tracks added in it.
        if (! this.negotiationPending) {
            this.negotiationPending = true
            queueMicrotask(() => {
                this.negotiationPending = false
                if (! this.closed) this.dispatchEvent(new Event('negotiationneeded'))
            })
        }

        return sender
    }

    createDataChannel(label, options) {
        const channel = new FakeDataChannel(label, options)
        this.channels = [...(this.channels ?? []), channel]
        // The first channel on a connection needs a negotiation, like a track.
        if (this.channels.length === 1 && ! this.negotiationPending) {
            this.negotiationPending = true
            queueMicrotask(() => {
                this.negotiationPending = false
                if (! this.closed) this.dispatchEvent(new Event('negotiationneeded'))
            })
        }

        return channel
    }

    /** The other side opened a channel: it arrives here, open. */
    receiveChannel(label) {
        const channel = new FakeDataChannel(label)
        channel.readyState = 'open'
        this.dispatchEvent(Object.assign(new Event('datachannel'), { channel }))

        return channel
    }

    removeTrack(sender) {
        this.senders = this.senders.filter((candidate) => candidate !== sender)
    }

    getSenders() {
        return [...this.senders]
    }

    async setLocalDescription(description) {
        description ??= this.signalingState === 'have-remote-offer'
            ? { type: 'answer', sdp: `v=0\r\nanswer ${this.id}\r\n` }
            : { type: 'offer', sdp: `v=0\r\noffer ${this.id}\r\n` }

        this.localDescription = description
        this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'
    }

    async setRemoteDescription(description) {
        this.remoteDescription = description
        this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'
    }

    async addIceCandidate(candidate) {
        this.candidates.push(candidate)
    }

    restartIce() {
        this.iceRestarts++
    }

    /** What `getStats()` answers: a test sets `report` to a list of entries ({ id, type, … }). */
    async getStats() {
        return new Map((this.report ?? []).map((entry) => [entry.id, entry]))
    }

    close() {
        this.closed = true
        this.connectionState = 'closed'
    }

    // ---- what the network would do ------------------------------------------

    setConnectionState(state) {
        this.connectionState = state
        this.dispatchEvent(new Event('connectionstatechange'))
    }

    receiveTrack(track) {
        this.dispatchEvent(Object.assign(new Event('track'), { track }))
    }

    gatherCandidate(candidate) {
        this.dispatchEvent(Object.assign(new Event('icecandidate'), {
            candidate: candidate === null ? null : { toJSON: () => candidate },
        }))
    }
}

/**
 * The data channels of two connections that face each other come up: each one is open
 * and what one side sends arrives on the other. `a` and `b` are the `Link`s (or anything
 * with `channels`, a Map by label) the two clients have to each other.
 */
export function joinChannels(a, b) {
    for (const [label, channel] of a.channels) {
        const other = b.channels.get(label)
        if (! other) continue
        channel.remote = other
        other.remote = channel
        if (channel.readyState !== 'open') channel.open()
        if (other.readyState !== 'open') other.open()
    }
}

/** A camera and a microphone, or whatever `getUserMedia` should answer with. */
export function fakeDevices({ camera = true } = {}) {
    const getUserMedia = vi.fn(async ({ audio, video }) => {
        if (video && ! camera) throw Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' })

        return new FakeMediaStream([
            ...(audio ? [new FakeTrack('audio', 'mic')] : []),
            ...(video ? [new FakeTrack('video', 'camera')] : []),
        ])
    })

    const getDisplayMedia = vi.fn(async () => new FakeMediaStream([new FakeTrack('video', 'screen')]))

    const enumerateDevices = vi.fn(async () => [
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Built-in microphone' },
        { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in microphone' },
        { kind: 'audioinput', deviceId: 'mic-2', label: 'Headset' },
        { kind: 'videoinput', deviceId: 'cam-1', label: 'Built-in camera' },
        { kind: 'videoinput', deviceId: 'cam-2', label: 'External camera' },
        { kind: 'audiooutput', deviceId: 'out-1', label: 'Speakers' },
        { kind: 'audiooutput', deviceId: '', label: '' },
    ])

    return { getUserMedia, getDisplayMedia, enumerateDevices }
}

export function installBrowserGlobals(devices = fakeDevices()) {
    FakeRTCPeerConnection.reset()
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection)
    vi.stubGlobal('MediaStream', FakeMediaStream)
    vi.stubGlobal('navigator', { mediaDevices: devices, sendBeacon: vi.fn(() => true) })

    return devices
}

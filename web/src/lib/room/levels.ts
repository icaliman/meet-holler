// Voice levels for the speaking ring: one AnalyserNode per audio track, read about ten
// times a second. The decision (who is speaking) is a pure function, so it is tested.

/** Smoothed level and speaking flag, with hysteresis so the ring does not flicker between words. */
export interface Voice {
    level: number
    speaking: boolean
    /** Milliseconds the level has stayed below the threshold. */
    quietFor: number
}

export const SPEAK_ON = 0.08
export const SPEAK_OFF = 0.04
export const HANG_MS = 450

export function step(voice: Voice, raw: number, dt: number): Voice {
    // Rise fast, fall slower: the ring follows the voice without jitter.
    const level = raw > voice.level ? voice.level + (raw - voice.level) * 0.6 : voice.level + (raw - voice.level) * 0.25

    if (level >= SPEAK_ON) return { level, speaking: true, quietFor: 0 }
    if (level < SPEAK_OFF) {
        const quietFor = voice.quietFor + dt

        return { level, speaking: voice.speaking && quietFor < HANG_MS, quietFor }
    }

    return { level, speaking: voice.speaking, quietFor: 0 }
}

export const silent: Voice = { level: 0, speaking: false, quietFor: 0 }

/** RMS of a time-domain buffer (0..255 around 128), scaled so normal speech lands around 0.1 to 0.4. */
export function rms(buffer: Uint8Array): number {
    let sum = 0
    for (const value of buffer) {
        const centred = (value - 128) / 128
        sum += centred * centred
    }

    return Math.min(1, Math.sqrt(sum / buffer.length) * 3)
}

type Listener = (levels: Map<string, Voice>) => void

/**
 * Watches the audio of several streams by key (a peer id, or 'me'). Uses one AudioContext;
 * browsers start it suspended until a click, which joining the meeting is.
 */
export class LevelMeter {
    private context: AudioContext | null = null
    private sources = new Map<string, { stream: MediaStream, analyser: AnalyserNode, node: MediaStreamAudioSourceNode, buffer: Uint8Array<ArrayBuffer> }>()
    private voices = new Map<string, Voice>()
    private timer: ReturnType<typeof setInterval> | null = null
    private last = 0

    constructor(private listener: Listener, private interval = 100) {}

    watch(key: string, stream: MediaStream | null): void {
        const current = this.sources.get(key)
        if (current?.stream === stream && stream?.getAudioTracks().length) return
        this.unwatch(key)
        if (! stream || ! stream.getAudioTracks().length) return

        try {
            this.context ??= new AudioContext()
            if (this.context.state === 'suspended') this.context.resume().catch(() => {})
            // A stream of its own for the analyser: the audio tracks only, so a video swap does not disturb it.
            const node = this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
            const analyser = this.context.createAnalyser()
            analyser.fftSize = 512
            node.connect(analyser)
            this.sources.set(key, { stream, analyser, node, buffer: new Uint8Array(new ArrayBuffer(analyser.fftSize)) })
            this.start()
        } catch {
            // No Web Audio here: no rings, everything else works.
        }
    }

    unwatch(key: string): void {
        const source = this.sources.get(key)
        if (! source) return
        source.node.disconnect()
        this.sources.delete(key)
        this.voices.delete(key)
    }

    /** Keys not in the list stop being watched (people who left). */
    keep(keys: Iterable<string>): void {
        const wanted = new Set(keys)
        for (const key of [...this.sources.keys()]) if (! wanted.has(key)) this.unwatch(key)
    }

    private start(): void {
        if (this.timer) return
        this.last = performance.now()
        this.timer = setInterval(() => this.tick(), this.interval)
    }

    private tick(): void {
        const now = performance.now()
        const dt = now - this.last
        this.last = now
        for (const [key, source] of this.sources) {
            source.analyser.getByteTimeDomainData(source.buffer)
            this.voices.set(key, step(this.voices.get(key) ?? silent, rms(source.buffer), dt))
        }
        this.listener(new Map(this.voices))
    }

    destroy(): void {
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        for (const key of [...this.sources.keys()]) this.unwatch(key)
        this.context?.close().catch(() => {})
        this.context = null
    }
}

import { describe, expect, it } from 'vitest'
import { explainProblem, openMedia, problemOf } from './media'

class Track {
    constructor(readonly kind: 'audio' | 'video') {}
    stop() {}
}

class Stream {
    constructor(private tracks: Track[] = []) {}
    getTracks() { return this.tracks }
    getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
    getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
}

globalThis.MediaStream ??= Stream as unknown as typeof MediaStream

const fail = (name: string) => Promise.reject(Object.assign(new Error(name), { name }))

describe('camera and microphone before joining', () => {
    it('names each kind of failure', () => {
        expect(problemOf({ name: 'NotAllowedError' })).toBe('blocked')
        expect(problemOf({ name: 'NotFoundError' })).toBe('missing')
        expect(problemOf({ name: 'NotReadableError' })).toBe('busy')
        expect(problemOf({ name: 'Weird' })).toBe('other')
    })

    it('says what to do next', () => {
        expect(explainProblem('blocked', 'camera')).toMatch(/Allow it in the address bar/)
        expect(explainProblem('missing', 'microphone')).toMatch(/Others won't hear you/)
        expect(explainProblem('busy', 'camera')).toMatch(/Another app is using your camera/)
    })

    it('takes both when both work', async () => {
        const opened = await openMedia(undefined, async () => new Stream([new Track('audio'), new Track('video')]) as unknown as MediaStream)
        expect(opened.camera).toBeNull()
        expect(opened.microphone).toBeNull()
        expect(opened.stream?.getTracks()).toHaveLength(2)
    })

    it('settles for the microphone when there is no camera', async () => {
        const opened = await openMedia(undefined, (c) => (c.video ? fail('NotFoundError') : Promise.resolve(new Stream([new Track('audio')]) as unknown as MediaStream)))
        expect(opened.camera).toBe('missing')
        expect(opened.microphone).toBeNull()
        expect(opened.stream?.getAudioTracks()).toHaveLength(1)
    })

    it('does not ask again when the browser blocks it', async () => {
        let asked = 0
        const opened = await openMedia(undefined, () => { asked++; return fail('NotAllowedError') })
        expect(asked).toBe(1)
        expect(opened).toEqual({ stream: null, camera: 'blocked', microphone: 'blocked' })
    })
})

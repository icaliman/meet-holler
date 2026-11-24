// The camera and microphone before joining: asking for them, and saying in words what went wrong.

export type MediaProblem = 'blocked' | 'missing' | 'busy' | 'insecure' | 'other'

/** What a getUserMedia failure means for the person in front of it. */
export function problemOf(error: unknown): MediaProblem {
    const name = (error as { name?: string } | null)?.name ?? ''
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'blocked'
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing'
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
    if (name === 'TypeError' && typeof navigator !== 'undefined' && ! navigator.mediaDevices) return 'insecure'

    return 'other'
}

/** One friendly sentence per problem, with the next step (docs/design.md, Voice). */
export function explainProblem(problem: MediaProblem, what: 'camera' | 'microphone' | 'camera and microphone' = 'camera and microphone'): string {
    switch (problem) {
        case 'blocked': return `Your browser is blocking the ${what}. Allow it in the address bar, then try again. You can also join without them.`
        case 'missing': return what === 'microphone'
            ? "We can't find a microphone. Others won't hear you, but you can still see and listen."
            : what === 'camera'
                ? "We can't find a camera. You can join with your voice only."
                : "We can't find a camera or a microphone. You can still join to watch and listen."
        case 'busy': return `Another app is using your ${what}. Close it (or its tab), then try again.`
        case 'insecure': return 'Your browser only allows the camera on secure pages. Open the meeting link with https.'
        default: return `We couldn't start your ${what}. Try again, or join without them.`
    }
}

export interface Opened {
    stream: MediaStream | null
    /** Why the camera is not in the stream, when it is not. */
    camera: MediaProblem | null
    microphone: MediaProblem | null
}

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>

const want = (id: string | null) => (id ? { deviceId: { exact: id } } : true)

/**
 * Ask for the camera and the microphone, and settle for what we can get: both, the
 * microphone alone, the camera alone, or nothing (with the reason for each).
 */
export async function openMedia(
    devices: { microphone: string | null, camera: string | null } = { microphone: null, camera: null },
    getUserMedia: GetUserMedia = (c) => navigator.mediaDevices.getUserMedia(c),
): Promise<Opened> {
    try {
        return { stream: await getUserMedia({ audio: want(devices.microphone), video: want(devices.camera) }), camera: null, microphone: null }
    } catch (both) {
        const reason = problemOf(both)
        // Blocked is blocked for both: asking again one by one only shows the prompt again.
        if (reason === 'blocked' || reason === 'insecure') return { stream: null, camera: reason, microphone: reason }

        let camera: MediaProblem | null = null
        let microphone: MediaProblem | null = null
        let audio: MediaStream | null = null
        let video: MediaStream | null = null
        try {
            audio = await getUserMedia({ audio: want(devices.microphone), video: false })
        } catch (error) {
            microphone = problemOf(error)
        }
        try {
            video = await getUserMedia({ audio: false, video: want(devices.camera) })
        } catch (error) {
            camera = problemOf(error)
        }
        const tracks = [...(audio?.getTracks() ?? []), ...(video?.getTracks() ?? [])]

        return { stream: tracks.length ? new MediaStream(tracks) : null, camera, microphone }
    }
}

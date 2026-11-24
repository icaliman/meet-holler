// What someone opening a meeting link sees first, from the meeting's public info.

import type { Meeting } from './types'

export type Gate = 'ended' | 'early' | 'full' | 'locked' | 'lobby'

export function gate(meeting: Meeting, isHost: boolean): Gate {
    if (meeting.status === 'ended') return 'ended'
    // The host can always open their meeting, early or not.
    if (meeting.status === 'scheduled' && ! isHost) return 'early'
    if (meeting.participantCount >= meeting.capacity) return 'full'
    if (meeting.locked && ! isHost) return 'locked'

    return 'lobby'
}

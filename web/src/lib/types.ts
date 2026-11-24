// The shapes of the HTTP API, as docs/ARCHITECTURE.md ("HTTP API") describes them.

export type Visibility = 'public' | 'private'
export type MeetingStatus = 'scheduled' | 'open' | 'ended'
export type Role = 'host' | 'guest'
export type ParticipantState = 'admitted' | 'waiting' | 'denied' | 'removed' | 'left'

export type ErrorCode =
    | 'not_found'
    | 'forbidden'
    | 'passcode_required'
    | 'passcode_wrong'
    | 'full'
    | 'locked'
    | 'ended'
    | 'invalid'
    | 'rate_limited'
    | 'network'

/** Public information about a meeting: `GET /api/meetings/:code`. */
export interface Meeting {
    code: string
    title: string | null
    visibility: Visibility
    requiresPasscode: boolean
    waitingRoom: boolean
    scheduledAt: string | null
    durationMin: number | null
    status: MeetingStatus
    locked: boolean
    participantCount: number
    capacity: number
}

export interface CreateMeetingInput {
    title?: string
    visibility: Visibility
    passcode?: string
    waitingRoom: boolean
    scheduledAt?: string
    durationMin?: number
    hostName?: string
}

export interface CreatedMeeting {
    meeting: Meeting
    hostKey: string
}

export interface Participant {
    id: string
    name: string
    role: Role
    state: ParticipantState
}

export interface JoinInput {
    name: string
    passcode?: string
    hostKey?: string
}

export interface JoinResult {
    token: string
    participant: Participant
}

export interface WaitingGuest {
    id: string
    name: string
    since: string
}

export interface MeetingPatch {
    waitingRoom?: boolean
    locked?: boolean
    title?: string
}

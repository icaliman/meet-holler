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
    | 'not_started'
    | 'network'

/**
 * Information about a meeting: `GET /api/meetings/:code`. A private meeting asked about with
 * only the link (no passcode entered yet, no host key) withholds what it is about and who is
 * in it: `title`, `hostName`, `locked` and `participantCount` are then `null`.
 */
export interface Meeting {
    code: string
    title: string | null
    visibility: Visibility
    requiresPasscode: boolean
    waitingRoom: boolean
    scheduledAt: string | null
    durationMin: number | null
    status: MeetingStatus
    locked: boolean | null
    participantCount: number | null
    capacity: number
    hostName?: string | null
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
    meeting?: Meeting
}

/** `GET /me`: where I stand, and the meeting as it is now. */
export interface Me {
    participant: Participant
    meeting: Meeting
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

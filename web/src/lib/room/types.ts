// What the meeting room's components read and call: the live room (room.svelte.ts, over
// @packstub/holler) and the dev demo (demo.svelte.ts) both implement it.

import type { CallState, ConnectionQuality, DeviceKind, DeviceList } from '@packstub/holler'
import type { Annotations } from '../annotate/annotations.svelte'
import type { PollMeeting } from '../holler'
import type { WaitingGuest } from '../types'
import type { Voice } from './levels'

export interface Person {
    id: string
    name: string
    seat: number
    me: boolean
    stream: MediaStream | null
    muted: boolean
    cameraOff: boolean
    sharing: boolean
    /** Media flows from them (always true for me). */
    connected: boolean
    /** Their window is alive (polling); false while they reload or lost the network. */
    alive: boolean
    quality: ConnectionQuality | null
}

export interface RoomLike {
    readonly code: string
    readonly isHost: boolean
    readonly state: CallState
    readonly people: Person[]
    readonly voices: Map<string, Voice>
    readonly meeting: PollMeeting | null
    readonly waiting: WaitingGuest[]
    readonly muted: boolean
    readonly cameraOff: boolean
    readonly sharing: boolean
    readonly hasCamera: boolean
    readonly hasMicrophone: boolean
    readonly canShare: boolean
    readonly speaker: string | null
    /** The pointer and marks on a shared screen (#6); absent where nothing is wired up. */
    readonly annotations?: Annotations | null

    toggleMic(): void
    toggleCamera(): void
    toggleShare(): Promise<void>
    leave(): Promise<void>
    endForAll(): Promise<void>
    setLocked(locked: boolean): Promise<void>
    setWaitingRoom(on: boolean): Promise<void>
    admit(id: string): Promise<void>
    deny(id: string): Promise<void>
    remove(id: string): Promise<void>
    devices(): Promise<DeviceList>
    setDevice(kind: DeviceKind, id: string | null): Promise<void>
    destroy(): void
}

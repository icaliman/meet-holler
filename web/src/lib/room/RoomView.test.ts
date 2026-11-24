import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import RoomView from './RoomView.svelte'
import type { Person, RoomLike } from './types'

const person = (over: Partial<Person>): Person => ({
    id: 'p1', name: 'Ion', seat: 0, me: true, stream: null, muted: false, cameraOff: true, sharing: false,
    connected: true, alive: true, quality: null, ...over,
})

function fakeRoom(over: Partial<RoomLike> = {}): RoomLike {
    return {
        code: 'abcdefghjk',
        isHost: false,
        state: 'active',
        people: [person({}), person({ id: 'p2', name: 'Ana Pop', seat: 1, me: false })],
        voices: new Map(),
        meeting: { status: 'open', title: 'Design review', locked: false, waitingRoom: false },
        waiting: [],
        muted: false,
        cameraOff: true,
        sharing: false,
        hasCamera: true,
        hasMicrophone: true,
        canShare: true,
        speaker: null,
        toggleMic: vi.fn(),
        toggleCamera: vi.fn(),
        toggleShare: vi.fn(async () => {}),
        leave: vi.fn(async () => {}),
        endForAll: vi.fn(async () => {}),
        setLocked: vi.fn(async () => {}),
        setWaitingRoom: vi.fn(async () => {}),
        admit: vi.fn(async () => {}),
        deny: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        devices: vi.fn(async () => ({ microphones: [], cameras: [], speakers: [], selected: { microphone: null, camera: null, speaker: null } })),
        setDevice: vi.fn(async () => {}),
        destroy: vi.fn(),
        ...over,
    }
}

describe('the meeting room', () => {
    it('shows everyone with their name and state', () => {
        render(RoomView, { room: fakeRoom(), onleave: () => {} })
        expect(screen.getByRole('heading', { name: 'Design review' })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: /Ion \(you\), camera off/ })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: /^Ana Pop/ })).toBeInTheDocument()
    })

    it('keeps the controls labelled with what they do, and reachable by keyboard shortcuts', async () => {
        const room = fakeRoom()
        render(RoomView, { room, onleave: () => {} })
        await userEvent.click(screen.getByRole('button', { name: 'Turn microphone off' }))
        expect(room.toggleMic).toHaveBeenCalledTimes(1)
        await userEvent.keyboard('v')
        expect(room.toggleCamera).toHaveBeenCalledTimes(1)
    })

    it('lets a guest leave in one click', async () => {
        const onleave = vi.fn()
        render(RoomView, { room: fakeRoom(), onleave })
        await userEvent.click(screen.getByRole('button', { name: 'Leave the meeting' }))
        expect(onleave).toHaveBeenCalledWith(false)
    })

    it('asks the host whether to leave or end it for everyone', async () => {
        const onleave = vi.fn()
        render(RoomView, { room: fakeRoom({ isHost: true }), onleave })
        await userEvent.click(screen.getByRole('button', { name: 'Leave or end the meeting' }))
        await userEvent.click(screen.getByRole('menuitem', { name: /End for everyone/ }))
        expect(onleave).toHaveBeenCalledWith(true)
    })

    it('shows the host who is waiting, and admits them from the People panel', async () => {
        const room = fakeRoom({ isHost: true, waiting: [{ id: 'w1', name: 'Dana', since: new Date().toISOString() }] })
        render(RoomView, { room, onleave: () => {} })
        await userEvent.click(screen.getByRole('button', { name: 'People, 1 waiting to join' }))
        await userEvent.click(screen.getByRole('button', { name: 'Admit Dana' }))
        expect(room.admit).toHaveBeenCalledWith('w1')
    })

    it('invites people when you are alone', () => {
        render(RoomView, { room: fakeRoom({ people: [person({})] }), onleave: () => {} })
        expect(screen.getByText("You're the first one here")).toBeInTheDocument()
        expect(screen.getByLabelText('Meeting link')).toHaveValue('http://localhost:3000/m/abc-defg-hjk')
    })

    it('says when the connection dropped', () => {
        render(RoomView, { room: fakeRoom({ state: 'reconnecting' }), onleave: () => {} })
        expect(screen.getByRole('status')).toHaveTextContent('Connection lost. Trying to get you back…')
    })
})

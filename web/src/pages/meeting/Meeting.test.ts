import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import Meeting from './Meeting.svelte'
import { MockStore } from '../../../dev/mock-store'
import { mockFetch } from '../../../dev/mock-fetch'
import { hostKeyFor, rememberHostKey } from '../../lib/storage'

describe('opening a meeting link', () => {
    let store: MockStore

    beforeEach(() => {
        store = new MockStore()
        vi.stubGlobal('fetch', mockFetch(store))
        localStorage.clear()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('says a missing meeting cannot be found, with a way back', async () => {
        render(Meeting, { code: 'zzzzzzzzzz' })
        expect(await screen.findByRole('heading', { name: "We can't find that meeting" })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Back to start' })).toHaveAttribute('href', '/')
    })

    it('says an ended meeting has ended', async () => {
        render(Meeting, { code: 'xxxendeddd' })
        expect(await screen.findByRole('heading', { name: 'This meeting has ended' })).toBeInTheDocument()
    })

    it('says a full meeting is full and offers to try again', async () => {
        render(Meeting, { code: 'xxxfuuuuuu' })
        expect(await screen.findByRole('heading', { name: 'This meeting is full' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })

    it('counts down to a scheduled meeting, with a calendar file', async () => {
        render(Meeting, { code: 'xxxsxhedxx' })
        expect(await screen.findByRole('heading', { name: "You're early" })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Add to calendar' })).toHaveAttribute('href', '/api/meetings/xxxsxhedxx.ics')
        expect(screen.getByText(/Opens in 2 hours and 1[45] minutes/)).toBeInTheDocument()
    })

    it('lets the host past the countdown, also from a host link on another device', async () => {
        history.replaceState(null, '', `/xxx-sxhe-dxx#host=${store.meetings.get('xxxsxhedxx')!.hostKey}`)
        render(Meeting, { code: 'xxxsxhedxx' })
        // Out of the address bar at once; kept only after the server has accepted it.
        expect(location.hash).toBe('')
        expect(await screen.findByText(/you're the host/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Open the meeting' })).toBeInTheDocument()
        expect(hostKeyFor('xxxsxhedxx')).toBe(store.meetings.get('xxxsxhedxx')!.hostKey)
    })

    it('does not believe a host link the server refuses: nothing is stored, and the real key stays', async () => {
        const real = store.meetings.get('xxxsxhedxx')!.hostKey
        rememberHostKey('xxxsxhedxx', real)
        history.replaceState(null, '', '/xxx-sxhe-dxx#host=not-the-key')
        render(Meeting, { code: 'xxxsxhedxx' })

        expect(await screen.findByText(/you're the host/i)).toBeInTheDocument()
        expect(hostKeyFor('xxxsxhedxx')).toBe(real)
        expect(location.hash).toBe('')
    })

    it('treats someone who opens a made-up host link as the guest they are', async () => {
        history.replaceState(null, '', '/xxx-wayt-xxx#host=not-the-key')
        render(Meeting, { code: 'xxxwaytxxx' })

        expect(await screen.findByLabelText('Your name')).toBeInTheDocument()
        expect(screen.queryByText(/you're the host/i)).not.toBeInTheDocument()
        expect(hostKeyFor('xxxwaytxxx')).toBeNull()
    })

    it('forgets a stored host key the server refuses, instead of sending it with every join', async () => {
        rememberHostKey('xxxwaytxxx', 'stale-or-planted')
        render(Meeting, { code: 'xxxwaytxxx' })

        expect(await screen.findByLabelText('Your name')).toBeInTheDocument()
        expect(screen.queryByText(/you're the host/i)).not.toBeInTheDocument()
        expect(hostKeyFor('xxxwaytxxx')).toBeNull()
    })

    it('shows a private meeting without its title or who is in until the passcode is entered', async () => {
        render(Meeting, { code: 'xxxpassxxx' })

        expect(await screen.findByText(/Private meeting\./)).toBeInTheDocument()
        expect(screen.queryByText('Interview')).not.toBeInTheDocument()
    })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import Meeting from './Meeting.svelte'
import { MockStore } from '../../../dev/mock-store'
import { mockFetch } from '../../../dev/mock-fetch'
import { hostKeyFor } from '../../lib/storage'

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
        expect(hostKeyFor('xxxsxhedxx')).toBe(store.meetings.get('xxxsxhedxx')!.hostKey)
        expect(location.hash).toBe('')
        expect(await screen.findByText(/You're the host/)).toBeInTheDocument()
    })
})

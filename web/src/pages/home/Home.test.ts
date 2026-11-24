import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import Home from './Home.svelte'
import { MockStore } from '../../../dev/mock-store'
import { mockFetch } from '../../../dev/mock-fetch'
import { router } from '../../lib/router.svelte'
import { hostKeyFor } from '../../lib/storage'

describe('home', () => {
    let store: MockStore

    beforeEach(() => {
        store = new MockStore()
        vi.stubGlobal('fetch', mockFetch(store))
        history.replaceState(null, '', '/')
        localStorage.clear()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('shows the three actions in order', () => {
        render(Home)
        const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
        expect(headings).toEqual(['Start a meeting', 'Join with a code', 'Schedule for later'])
    })

    it('starts a meeting in one click and remembers the host key', async () => {
        render(Home)
        await userEvent.click(screen.getByRole('button', { name: 'Start a meeting' }))

        await waitFor(() => expect(router.route.name).toBe('meeting'))
        const code = (router.route as { code: string }).code
        expect(location.pathname).toMatch(/^\/[2-9a-z]{3}-[2-9a-z]{4}-[2-9a-z]{3}$/)
        expect(hostKeyFor(code)).toBe(store.meetings.get(code)?.hostKey)
    })

    it('explains a wrong code instead of going nowhere', async () => {
        render(Home)
        const input = screen.getByLabelText('Meeting code or link')
        await userEvent.type(input, 'abcdefg')
        await userEvent.click(screen.getByRole('button', { name: 'Join' }))

        expect(screen.getByText('A code has 10 letters and numbers. This one has 7.')).toBeInTheDocument()
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(input).toHaveFocus()
    })

    it('formats the code as it is typed and joins with it', async () => {
        render(Home)
        const input = screen.getByLabelText('Meeting code or link') as HTMLInputElement
        await userEvent.type(input, 'abcdefghjk')
        expect(input.value).toBe('abc-defg-hjk')

        await userEvent.click(screen.getByRole('button', { name: 'Join' }))
        expect(location.pathname).toBe('/abc-defg-hjk')
    })

    it('takes a pasted link', async () => {
        render(Home)
        const input = screen.getByLabelText('Meeting code or link') as HTMLInputElement
        input.focus()
        await userEvent.paste('https://meet.xlite.dev/xyz-wxyz-wxy')
        expect(input.value).toBe('xyz-wxyz-wxy')
    })

    it('schedules a private meeting and shows it is ready', async () => {
        render(Home)
        await userEvent.click(screen.getByRole('button', { name: 'Schedule for later' }))
        expect(screen.getByRole('heading', { name: 'Schedule a meeting' })).toBeInTheDocument()

        await userEvent.type(screen.getByLabelText(/^Title/), 'Planning')
        await userEvent.click(screen.getByRole('radio', { name: 'Link + passcode' }))
        const passcode = screen.getByLabelText('Passcode') as HTMLInputElement
        await userEvent.clear(passcode)
        await userEvent.click(screen.getByRole('button', { name: 'Schedule meeting' }))
        expect(screen.getByText(/A private meeting needs a passcode/)).toBeInTheDocument()

        await userEvent.type(passcode, '2468')
        await userEvent.click(screen.getByRole('switch', { name: 'Waiting room' }))
        await userEvent.click(screen.getByRole('button', { name: 'Schedule meeting' }))

        await waitFor(() => expect(router.route.name).toBe('ready'))
        const meeting = [...store.meetings.values()].find((m) => m.title === 'Planning')!
        expect(meeting).toMatchObject({ visibility: 'private', passcode: '2468', waitingRoom: true, durationMin: 30 })
        expect(meeting.scheduledAt).toBeTruthy()
    })
})

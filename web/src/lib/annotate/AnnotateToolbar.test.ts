import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { flushSync } from 'svelte'
import AnnotateToolbar from './AnnotateToolbar.svelte'
import { Annotations } from './annotations.svelte'
import { localWire } from './wire'

let made: Annotations[] = []

/** Annotations for `me` in a meeting with Ana and Mihai, while `sharer` shares. */
function setup(me: string, sharer: string, isHost = false) {
    const wire = localWire()
    const annotations = new Annotations({ wire, me: { id: me, isHost }, announce: () => {}, reducedMotion: () => true })
    annotations.rosterChanged([
        { id: 'ana', name: 'Ana', seat: 1, me: me === 'ana', sharing: sharer === 'ana' },
        { id: 'mihai', name: 'Mihai', seat: 2, me: me === 'mihai', sharing: sharer === 'mihai' },
    ])
    made.push(annotations)
    render(AnnotateToolbar, { annotations })

    return { annotations, wire }
}

afterEach(() => {
    for (const a of made) a.destroy()
    made = []
})

describe('the tool palette', () => {
    it('names whose screen it draws on and every tool', () => {
        setup('mihai', 'ana')
        expect(screen.getByRole('toolbar', { name: "Point and draw on Ana's screen" })).toBeInTheDocument()
        for (const name of ['Pointer', 'Pen', 'Arrow', 'Highlighter']) {
            expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
        }
    })

    it('picks a tool, and puts it down when pressed again', async () => {
        const { annotations } = setup('mihai', 'ana')
        await userEvent.click(screen.getByRole('button', { name: 'Pen' }))
        expect(annotations.tool).toBe('pen')
        expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true')
        await userEvent.click(screen.getByRole('button', { name: 'Arrow' }))
        expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'false')
        await userEvent.click(screen.getByRole('button', { name: 'Arrow' }))
        expect(annotations.tool).toBeNull()
    })

    it('works from the keyboard: Tab in, arrows along, Enter to pick', async () => {
        const { annotations } = setup('mihai', 'ana')
        await userEvent.tab()
        expect(screen.getByRole('button', { name: 'Pointer' })).toHaveFocus()
        await userEvent.keyboard('{ArrowRight}{ArrowRight}')
        expect(screen.getByRole('button', { name: 'Arrow' })).toHaveFocus()
        await userEvent.keyboard('{ArrowLeft}{Enter}')
        expect(annotations.tool).toBe('pen')
        await userEvent.keyboard('{End}')
        expect(screen.getByRole('button', { name: 'Highlighter' })).toHaveFocus()
    })

    it('lets a viewer clear only their own marks, once they have some', async () => {
        const { annotations } = setup('mihai', 'ana')
        const clear = screen.getByRole('button', { name: 'Clear your marks' })
        expect(clear).toBeDisabled()
        annotations.setTool('pen')
        annotations.begin({ x: 0.5, y: 0.5 })
        annotations.end()
        flushSync()
        expect(clear).toBeEnabled()
        await userEvent.click(clear)
        expect(annotations.marks).toEqual([])
    })

    it('gives the host "Clear all marks"', () => {
        setup('mihai', 'ana', true)
        expect(screen.getByRole('button', { name: 'Clear all marks' })).toBeInTheDocument()
    })

    it('gives the sharer a switch for the others, and tells everyone', async () => {
        const { annotations, wire } = setup('ana', 'ana')
        expect(screen.getByRole('toolbar', { name: 'Point and draw on your screen' })).toBeInTheDocument()
        const others = screen.getByRole('switch', { name: 'Let others point and draw' })
        expect(others).toHaveAttribute('aria-checked', 'true')
        await userEvent.click(others)
        expect(others).toHaveAttribute('aria-checked', 'false')
        expect(annotations.open).toBe(false)
        expect(JSON.parse(wire.sent[wire.sent.length - 1].data)).toEqual({ v: 1, t: 'cfg', s: 'ana', open: false })
    })

    it('shows a viewer that the sharer turned it off, with the tools disabled', () => {
        const { annotations, wire } = setup('mihai', 'ana')
        wire.deliver('ana', JSON.stringify({ v: 1, t: 'cfg', s: 'ana', open: false }))
        flushSync()
        expect(annotations.open).toBe(false)
        expect(screen.getByText('Only Ana can point and draw now.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Pointer' })).toBeDisabled()
    })

    it('has no switch for a viewer', () => {
        setup('mihai', 'ana')
        expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
})

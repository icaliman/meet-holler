<script lang="ts">
    /** The tool palette over a shared screen: pointer, pen, arrow, highlighter, clear, and the sharer's switch. */
    import Icon from '../ui/Icon.svelte'
    import type { IconName } from '../ui/icons'
    import { seatColour } from '../room/layout'
    import type { Annotations, Tool } from './annotations.svelte'

    let { annotations }: { annotations: Annotations } = $props()

    let bar: HTMLDivElement | undefined = $state()

    const TOOLS: { key: Tool, icon: IconName, label: string, shortcut: string }[] = [
        { key: 'pointer', icon: 'pointer', label: 'Pointer', shortcut: 'P' },
        { key: 'pen', icon: 'pen', label: 'Pen', shortcut: 'D' },
        { key: 'arrow', icon: 'arrowDraw', label: 'Arrow', shortcut: 'A' },
        { key: 'marker', icon: 'marker', label: 'Highlighter', shortcut: 'H' },
    ]

    const mySeat = $derived(seatColour(annotations.people.find((p) => p.me)?.seat ?? 0))
    const whose = $derived(annotations.iShare ? 'your screen' : `${annotations.sharerName}'s screen`)
    const blocked = $derived(! annotations.canAnnotate)

    function pick(tool: Tool) {
        annotations.setTool(annotations.tool === tool ? null : tool)
    }

    /** Left and right arrows move along the palette, like any toolbar. */
    function roam(event: KeyboardEvent) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return
        const buttons = [...(bar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (! buttons.length) return
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0
            : event.key === 'End' ? buttons.length - 1
            : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
        event.preventDefault()
    }
</script>

<div class="wrap">
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div bind:this={bar} class="palette seat-{mySeat}" role="toolbar" aria-label="Point and draw on {whose}" tabindex="-1" onkeydown={roam}>
        {#each TOOLS as t (t.key)}
            <button
                type="button"
                class="tool"
                aria-pressed={annotations.tool === t.key}
                aria-label={t.label}
                aria-keyshortcuts={t.shortcut}
                title="{t.label} ({t.shortcut})"
                disabled={blocked}
                onclick={() => pick(t.key)}
            >
                <Icon name={t.icon} size={20} />
            </button>
        {/each}

        <span class="sep" aria-hidden="true"></span>

        <button
            type="button"
            class="tool"
            aria-label={annotations.canClearAll ? 'Clear all marks' : 'Clear your marks'}
            title={annotations.canClearAll ? 'Clear all marks' : 'Clear your marks'}
            disabled={! annotations.hasMarks}
            onclick={() => annotations.clear()}
        >
            <Icon name="eraser" size={20} />
        </button>

        {#if annotations.iShare}
            <button
                type="button"
                class="switch"
                role="switch"
                aria-checked={annotations.open}
                aria-label="Let others point and draw"
                title="Let others point and draw"
                onclick={() => annotations.setOpen(! annotations.open)}
            >
                <Icon name="users" size={18} />
                <span class="track" aria-hidden="true"><span class="knob"></span></span>
            </button>
        {/if}
    </div>

    {#if blocked && annotations.sharerId}
        <p class="note">Only {annotations.sharerName} can point and draw now.</p>
    {/if}
</div>

<style>
    .wrap {
        position: absolute;
        top: var(--s-3);
        left: 50%;
        transform: translateX(-50%);
        z-index: 7;
        display: grid;
        justify-items: center;
        gap: var(--s-1);
        max-width: calc(100% - 2 * var(--s-3));
    }

    .seat-0 { --mine: var(--seat-0); }
    .seat-1 { --mine: var(--seat-1); }
    .seat-2 { --mine: var(--seat-2); }
    .seat-3 { --mine: var(--seat-3); }

    .palette {
        display: flex;
        align-items: center;
        gap: var(--s-1);
        padding: 4px;
        border-radius: var(--r-pill);
        background: var(--surface);
        border: 1px solid var(--line);
        box-shadow: var(--shadow-float);
    }

    .palette:focus {
        outline: none;
    }

    .tool,
    .switch {
        display: grid;
        place-items: center;
        min-width: 44px;
        height: 44px;
        border: 0;
        border-radius: var(--r-pill);
        background: transparent;
        color: var(--ink);
        cursor: pointer;
        transition: background-color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
    }

    .tool:hover:not(:disabled),
    .switch:hover {
        background: #2E2A23;
    }

    .tool:active:not(:disabled) {
        transform: scale(0.94);
    }

    /* The tool in hand takes my seat colour: the colour my marks are drawn in. */
    .tool[aria-pressed='true'],
    .tool[aria-pressed='true']:hover {
        background: var(--mine);
        color: #12110D;
    }

    .tool:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }

    .sep {
        width: 1px;
        height: 24px;
        background: var(--line);
        margin: 0 2px;
    }

    .switch {
        display: inline-flex;
        gap: 6px;
        padding: 0 10px;
    }

    .track {
        position: relative;
        width: 30px;
        height: 18px;
        border-radius: var(--r-pill);
        border: 1.5px solid var(--line-strong);
        background: transparent;
        transition: background-color var(--t-fast) var(--ease-out);
    }

    .knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 11px;
        height: 11px;
        border-radius: 50%;
        background: var(--ink-muted);
        transition: transform var(--t-fast) var(--ease-out);
    }

    .switch[aria-checked='true'] .track {
        background: var(--volt);
        border-color: var(--volt);
    }

    .switch[aria-checked='true'] .knob {
        background: #12110D;
        transform: translateX(12px);
    }

    .note {
        padding: 4px 12px;
        border-radius: var(--r-pill);
        background: rgb(11 10 8 / 0.78);
        color: var(--ink);
        font-size: var(--text-sm);
        font-weight: 700;
        text-align: center;
    }

    @media (max-width: 639px) {
        .wrap {
            top: var(--s-2);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .tool,
        .switch,
        .track,
        .knob {
            transition: none;
        }

        .tool:active:not(:disabled) {
            transform: none;
        }
    }
</style>

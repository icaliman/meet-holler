<script lang="ts">
    import Icon from '../ui/Icon.svelte'
    import type { IconName } from '../ui/icons'
    import type { RoomLike } from './types'

    let {
        room,
        panel,
        onpanel,
        onleave,
    }: {
        room: RoomLike
        panel: 'people' | 'settings' | null
        onpanel: (panel: 'people' | 'settings' | null) => void
        onleave: (forEveryone: boolean) => void
    } = $props()

    let leaveOpen = $state(false)
    let leaveWrap: HTMLDivElement | undefined = $state()

    const waitingCount = $derived(room.isHost ? room.waiting.length : 0)

    interface Control {
        key: string
        icon: IconName
        label: string
        short: string
        off?: boolean
        active?: boolean
        hidden?: boolean
        disabled?: boolean
        shortcut?: string
        run: () => void
        badge?: number
    }

    const controls = $derived<Control[]>([
        {
            key: 'mic',
            icon: room.muted ? 'micOff' : 'mic',
            label: ! room.hasMicrophone ? 'No microphone found' : room.muted ? 'Turn microphone on' : 'Turn microphone off',
            short: room.muted ? 'Unmute' : 'Mute',
            off: room.muted || ! room.hasMicrophone,
            disabled: ! room.hasMicrophone,
            shortcut: 'M',
            run: () => room.toggleMic(),
        },
        {
            key: 'camera',
            icon: room.cameraOff ? 'cameraOff' : 'camera',
            label: ! room.hasCamera ? 'No camera found' : room.cameraOff ? 'Turn camera on' : 'Turn camera off',
            short: room.cameraOff ? 'Start video' : 'Stop video',
            off: room.cameraOff || ! room.hasCamera,
            disabled: ! room.hasCamera,
            shortcut: 'V',
            run: () => room.toggleCamera(),
        },
        {
            key: 'share',
            icon: room.sharing ? 'screenOff' : 'screen',
            label: room.sharing ? 'Stop sharing your screen' : 'Share your screen',
            short: room.sharing ? 'Stop share' : 'Share',
            active: room.sharing,
            hidden: ! room.canShare,
            shortcut: 'S',
            run: () => { room.toggleShare() },
        },
        {
            key: 'people',
            icon: 'users',
            label: waitingCount ? `People, ${waitingCount} waiting to join` : 'People and invite',
            short: 'People',
            active: panel === 'people',
            badge: waitingCount,
            run: () => onpanel(panel === 'people' ? null : 'people'),
        },
        {
            key: 'settings',
            icon: 'settings',
            label: 'Settings: microphone, camera, speaker',
            short: 'Settings',
            active: panel === 'settings',
            run: () => onpanel(panel === 'settings' ? null : 'settings'),
        },
    ])

    function leave() {
        if (room.isHost) leaveOpen = ! leaveOpen
        else onleave(false)
    }

    $effect(() => {
        if (! leaveOpen) return
        const close = (event: Event) => {
            if (event instanceof KeyboardEvent && event.key !== 'Escape') return
            if (event instanceof MouseEvent && leaveWrap?.contains(event.target as Node)) return
            leaveOpen = false
        }
        document.addEventListener('click', close, true)
        document.addEventListener('keydown', close)

        return () => {
            document.removeEventListener('click', close, true)
            document.removeEventListener('keydown', close)
        }
    })
</script>

<div class="bar" role="toolbar" aria-label="Meeting controls">
    {#each controls.filter((c) => ! c.hidden) as control (control.key)}
        <div class="control {control.key}">
            <button
                type="button"
                class="round"
                class:off={control.off}
                class:active={control.active}
                aria-label={control.label}
                aria-pressed={control.key === 'people' || control.key === 'settings' ? control.active : undefined}
                aria-keyshortcuts={control.shortcut}
                title={control.shortcut ? `${control.label} (${control.shortcut})` : control.label}
                disabled={control.disabled}
                onclick={control.run}
            >
                <Icon name={control.icon} size={22} />
                {#if control.badge}<span class="badge" aria-hidden="true">{control.badge}</span>{/if}
            </button>
            <span class="caption" aria-hidden="true">{control.short}</span>
        </div>
    {/each}

    <div class="control leave-wrap" bind:this={leaveWrap}>
        <button
            type="button"
            class="leave"
            aria-label={room.isHost ? 'Leave or end the meeting' : 'Leave the meeting'}
            aria-haspopup={room.isHost ? 'menu' : undefined}
            aria-expanded={room.isHost ? leaveOpen : undefined}
            onclick={leave}
        >
            <Icon name="leave" size={24} />
            <span class="leave-label">Leave</span>
        </button>
        {#if leaveOpen}
            <div class="leave-menu" role="menu">
                <button type="button" role="menuitem" onclick={() => { leaveOpen = false; onleave(false) }}>
                    <strong>Leave</strong>
                    <span>The meeting goes on without you.</span>
                </button>
                <button type="button" role="menuitem" class="danger" onclick={() => { leaveOpen = false; onleave(true) }}>
                    <strong>End for everyone</strong>
                    <span>Everyone leaves, and the link stops working.</span>
                </button>
            </div>
        {/if}
    </div>
</div>

<style>
    .bar {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        gap: var(--s-2);
        padding: var(--s-2) var(--s-3);
        border-radius: var(--r-pill);
        background: #1C1A15;
        border: 1px solid #34302A;
        box-shadow: var(--shadow-float);
    }

    .control {
        position: relative;
        display: grid;
        justify-items: center;
        gap: 4px;
    }

    .round {
        position: relative;
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        border: 0;
        background: #2E2A23;
        color: var(--ink);
        cursor: pointer;
        transition: background-color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
    }

    .round:hover:not(:disabled) {
        background: #3A352C;
    }

    .round:active:not(:disabled) {
        transform: scale(0.94);
    }

    /* Off is loud on purpose: you should never wonder whether they can hear you. */
    .round.off {
        background: var(--ink);
        color: #12110D;
    }

    .round.active {
        background: var(--volt);
        color: var(--on-volt);
    }

    .round:disabled {
        cursor: not-allowed;
        opacity: 0.6;
    }

    .badge {
        position: absolute;
        top: -2px;
        right: -2px;
        min-width: 22px;
        height: 22px;
        padding: 0 6px;
        border-radius: var(--r-pill);
        background: var(--volt);
        color: var(--on-volt);
        font-size: 0.75rem;
        font-weight: 800;
        display: grid;
        place-items: center;
        border: 2px solid #1C1A15;
    }

    .caption {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--ink-muted);
        white-space: nowrap;
    }

    .leave-wrap {
        margin-left: var(--s-2);
    }

    .leave {
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        height: 52px;
        padding: 0 var(--s-5);
        border: 0;
        border-radius: var(--r-pill);
        background: var(--danger);
        color: var(--on-danger);
        font-weight: 800;
        cursor: pointer;
    }

    .leave:hover {
        filter: brightness(1.08);
    }

    .leave-menu {
        position: absolute;
        right: 0;
        bottom: calc(100% + var(--s-3));
        width: min(300px, calc(100vw - 32px));
        padding: var(--s-2);
        border-radius: var(--r-md);
        background: var(--surface);
        border: 1px solid var(--line);
        box-shadow: var(--shadow-float);
        display: grid;
        gap: var(--s-1);
    }

    .leave-menu button {
        display: grid;
        gap: 2px;
        text-align: left;
        padding: var(--s-3);
        border: 0;
        border-radius: var(--r-sm);
        background: transparent;
        color: var(--ink);
        cursor: pointer;
    }

    .leave-menu button:hover {
        background: var(--sunken);
    }

    .leave-menu span {
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .leave-menu .danger strong {
        color: var(--danger);
    }

    @media (max-width: 639px) {
        .bar {
            gap: 6px;
            padding: var(--s-2);
            border-radius: var(--r-lg);
            width: 100%;
            justify-content: space-between;
        }

        .caption,
        .leave-label {
            display: none;
        }

        .round,
        .leave {
            width: 52px;
            height: 52px;
            padding: 0;
            justify-content: center;
        }

        .leave-wrap {
            margin-left: 0;
        }
    }
</style>

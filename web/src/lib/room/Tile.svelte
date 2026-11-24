<script lang="ts">
    import Icon from '../ui/Icon.svelte'
    import VideoEl from './VideoEl.svelte'
    import { initials, seatColour } from './layout'
    import type { Voice } from './levels'
    import type { Person } from './types'

    let {
        person,
        voice = null,
        speaker = null,
        stage = false,
        compact = false,
        onremove = null,
    }: {
        person: Person
        voice?: Voice | null
        speaker?: string | null
        /** The shared screen on the stage: shown whole (contain), not cropped. */
        stage?: boolean
        compact?: boolean
        /** The host can take someone out of the meeting. */
        onremove?: (() => void) | null
    } = $props()

    let menuOpen = $state(false)

    const hasVideo = $derived(Boolean(person.stream?.getVideoTracks().some((t) => t.readyState !== 'ended')) && (! person.cameraOff || person.sharing))
    const speaking = $derived(Boolean(voice?.speaking) && ! person.muted)
    const ring = $derived(speaking ? Math.round(2 + Math.min(1, (voice?.level ?? 0) * 2.5) * 4) : 0)
    const away = $derived(! person.me && (! person.alive || ! person.connected))
    const label = $derived(person.me ? `${person.name} (you)` : person.name)
    const description = $derived([
        person.muted ? 'microphone off' : null,
        ! hasVideo ? 'camera off' : null,
        person.sharing ? 'sharing their screen' : null,
        person.quality === 'poor' ? 'weak connection' : null,
        away ? 'connecting' : null,
    ].filter(Boolean).join(', '))
</script>

<div
    role="group"
    class="tile seat-{seatColour(person.seat)}"
    class:speaking
    class:stage
    class:compact
    class:away
    style:--ring="{ring}px"
    aria-label="{label}{description ? `, ${description}` : ''}"
>
    {#if hasVideo}
        <VideoEl
            stream={person.stream}
            muted={person.me}
            mirror={person.me && ! person.sharing}
            fit={stage || person.sharing ? 'contain' : 'cover'}
            sinkId={speaker}
            label={person.sharing ? `${person.name}'s screen` : `${label}'s video`}
        />
    {:else}
        <div class="avatar" aria-hidden="true">
            <span>{initials(person.name)}</span>
        </div>
        {#if ! person.me && person.stream}
            <!-- No picture, but their voice still plays. -->
            <VideoEl stream={person.stream} sinkId={speaker} audioOnly label={`${label}'s audio`} />
        {/if}
    {/if}

    {#if away}
        <div class="veil" aria-hidden="true">
            <span class="dots"><i></i><i></i><i></i></span>
            <span>{person.connected ? 'Reconnecting…' : 'Connecting…'}</span>
        </div>
    {/if}

    <div class="tag">
        {#if person.muted}
            <span class="muted" title="Microphone off"><Icon name="micOff" size={16} /></span>
        {:else}
            <span class="bars" class:on={speaking} aria-hidden="true"><i></i><i></i><i></i></span>
        {/if}
        <span class="name">{person.name}</span>
        {#if person.me}<span class="you">You</span>{/if}
        {#if person.sharing}<span class="pill">Sharing</span>{/if}
    </div>

    {#if person.quality === 'poor' && ! away}
        <span class="weak" title="Weak connection"><Icon name="signal" size={16} /> Weak connection</span>
    {/if}

    {#if onremove && ! person.me}
        <div class="menu">
            <button
                type="button"
                class="menu-button"
                aria-label="Options for {person.name}"
                aria-expanded={menuOpen}
                onclick={() => (menuOpen = ! menuOpen)}
            >
                <Icon name="more" size={18} />
            </button>
            {#if menuOpen}
                <div class="menu-list">
                    <button type="button" onclick={() => { menuOpen = false; onremove?.() }}>Remove from meeting</button>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .tile {
        --seat: var(--seat-0);
        position: relative;
        min-width: 0;
        min-height: 0;
        border-radius: var(--r-lg);
        background: var(--tile);
        overflow: hidden;
        isolation: isolate;
        animation: arrive var(--t-med) var(--ease-spring) both;
    }

    .tile.compact {
        border-radius: var(--r-md);
    }

    .seat-0 { --seat: var(--seat-0); --tint: #2A3015; }
    .seat-1 { --seat: var(--seat-1); --tint: #2B2638; }
    .seat-2 { --seat: var(--seat-2); --tint: #1E2E36; }
    .seat-3 { --seat: var(--seat-3); --tint: #3A2A21; }

    .tile::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-shadow: inset 0 0 0 var(--ring, 0) var(--volt);
        transition: box-shadow 90ms linear;
        z-index: 3;
    }

    .avatar {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: var(--tint);
    }

    .avatar span {
        display: grid;
        place-items: center;
        width: clamp(56px, 28%, 132px);
        aspect-ratio: 1;
        border-radius: 50%;
        background: var(--seat);
        color: #12110D;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: clamp(1.25rem, 4vw, 2.75rem);
        letter-spacing: -0.03em;
    }

    .compact .avatar span {
        width: 44%;
        font-size: 1.125rem;
    }

    .veil {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: var(--s-2);
        background: rgb(11 10 8 / 0.6);
        color: var(--ink);
        font-weight: 700;
        font-size: var(--text-sm);
    }

    .dots {
        display: flex;
        gap: 5px;
    }

    .dots i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--volt);
        animation: blink 1s var(--ease-out) infinite;
    }

    .dots i:nth-child(2) { animation-delay: 150ms; }
    .dots i:nth-child(3) { animation-delay: 300ms; }

    .tag {
        position: absolute;
        left: var(--s-3);
        bottom: var(--s-3);
        z-index: 4;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: calc(100% - 2 * var(--s-3));
        padding: 5px 10px 5px 8px;
        border-radius: var(--r-pill);
        background: rgb(11 10 8 / 0.72);
        color: #F4EFE4;
        font-size: var(--text-sm);
        font-weight: 700;
        backdrop-filter: blur(6px);
    }

    .compact .tag {
        left: 6px;
        bottom: 6px;
        font-size: 0.75rem;
        padding: 3px 8px 3px 6px;
    }

    .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .you,
    .pill {
        flex: none;
        padding: 1px 7px;
        border-radius: var(--r-pill);
        background: var(--seat);
        color: #12110D;
        font-size: 0.6875rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .pill {
        background: var(--volt);
    }

    .muted {
        display: grid;
        place-items: center;
        color: var(--danger);
    }

    .bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 2px;
        height: 12px;
    }

    .bars i {
        width: 3px;
        height: 4px;
        border-radius: 2px;
        background: rgb(244 239 228 / 0.5);
        transition: height 120ms var(--ease-out);
    }

    .bars.on i {
        background: var(--volt);
        animation: talk 700ms var(--ease-out) infinite alternate;
    }

    .bars.on i:nth-child(2) { animation-delay: 120ms; }
    .bars.on i:nth-child(3) { animation-delay: 240ms; }

    .weak {
        position: absolute;
        right: var(--s-3);
        bottom: var(--s-3);
        z-index: 4;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: var(--r-pill);
        background: var(--seat-3);
        color: #12110D;
        font-size: 0.75rem;
        font-weight: 700;
    }

    .menu {
        position: absolute;
        top: var(--s-2);
        right: var(--s-2);
        z-index: 5;
    }

    .menu-button {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        background: rgb(11 10 8 / 0.6);
        color: #F4EFE4;
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--t-fast) var(--ease-out);
    }

    .tile:hover .menu-button,
    .menu-button:focus-visible,
    .menu-button[aria-expanded='true'] {
        opacity: 1;
    }

    @media (hover: none) {
        .menu-button { opacity: 1; }
    }

    .menu-list {
        position: absolute;
        right: 0;
        top: 42px;
        min-width: 200px;
        padding: var(--s-1);
        border-radius: var(--r-sm);
        background: var(--surface);
        box-shadow: var(--shadow-float);
    }

    .menu-list button {
        width: 100%;
        min-height: 44px;
        padding: 0 var(--s-3);
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--danger);
        font-weight: 700;
        text-align: left;
        cursor: pointer;
    }

    .menu-list button:hover {
        background: var(--sunken);
    }

    @keyframes arrive {
        from { opacity: 0; transform: scale(0.92); }
        to { opacity: 1; transform: none; }
    }

    @keyframes blink {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 1; }
    }

    @keyframes talk {
        from { height: 4px; }
        to { height: 12px; }
    }

    /* Steady signals instead of motion: a fixed ring while someone talks. */
    @media (prefers-reduced-motion: reduce) {
        .tile { animation: none; }
        .tile::after { transition: none; }
        .speaking { --ring: 3px !important; }
        .bars.on i { animation: none; height: 10px; }
    }
</style>

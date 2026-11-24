<script lang="ts">
    /**
     * The seat motif as a small picture for full-page states: the room from above,
     * each seat empty, taken (in its seat colour) or lit, with a badge for the state.
     */
    import type { Mood } from './moods'

    let { mood }: { mood: Mood } = $props()

    const seats = $derived.by((): Array<'empty' | 'taken' | 'dim'> => {
        switch (mood) {
            case 'full': return ['taken', 'taken', 'taken', 'taken']
            case 'ended':
            case 'left': return ['dim', 'dim', 'dim', 'dim']
            case 'locked': return ['taken', 'taken', 'empty', 'empty']
            case 'waiting':
            case 'denied': return ['taken', 'taken', 'empty', 'empty']
            case 'early': return ['empty', 'empty', 'empty', 'empty']
            default: return ['empty', 'empty', 'empty', 'empty']
        }
    })

    const colours = ['var(--seat-0)', 'var(--seat-1)', 'var(--seat-2)', 'var(--seat-3)']
    const spots = [[18, 18], [62, 18], [18, 62], [62, 62]]
</script>

<svg class="art {mood}" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <rect class="room" x="6" y="6" width="92" height="92" rx="26" />
    {#each spots as [x, y], i}
        {#if seats[i] === 'taken'}
            <rect class="seat taken" style:--c={colours[i]} {x} {y} width="24" height="24" rx="12" />
        {:else if seats[i] === 'dim'}
            <rect class="seat dim" {x} {y} width="24" height="24" rx="12" />
        {:else}
            <rect class="seat empty" x={x + 1.5} y={y + 1.5} width="21" height="21" rx="10.5" />
        {/if}
    {/each}

    {#if mood === 'waiting' || mood === 'denied'}
        <!-- you, outside the room, by the door -->
        <rect class="you" x="88" y="84" width="24" height="24" rx="12" />
    {/if}
    {#if mood === 'locked'}
        <g class="badge" transform="translate(80 78)">
            <circle cx="16" cy="16" r="18" />
            <rect class="glyph-fill" x="8" y="15" width="16" height="12" rx="3" />
            <path class="glyph" d="M11 15v-3a5 5 0 0 1 10 0v3" />
        </g>
    {:else if mood === 'missing'}
        <g class="badge" transform="translate(80 78)">
            <circle cx="16" cy="16" r="18" />
            <text x="16" y="23" text-anchor="middle">?</text>
        </g>
    {:else if mood === 'early'}
        <g class="badge" transform="translate(80 78)">
            <circle cx="16" cy="16" r="18" />
            <circle class="glyph" cx="16" cy="16" r="9" />
            <path class="glyph" d="M16 11v5l3 2" />
        </g>
    {:else if mood === 'full'}
        <g class="badge" transform="translate(80 78)">
            <circle cx="16" cy="16" r="18" />
            <text x="16" y="23" text-anchor="middle">4</text>
        </g>
    {:else if mood === 'blocked'}
        <g class="badge" transform="translate(80 78)">
            <circle cx="16" cy="16" r="18" />
            <path class="glyph" d="M8 12h11v9H8zM19 15l5-3v9l-5-3M7 8l18 18" />
        </g>
    {:else if mood === 'ended' || mood === 'left'}
        <g class="badge" transform="translate(80 78)">
            <circle cx="16" cy="16" r="18" />
            <path class="glyph" d="M10 16.5l4 4 8-9" />
        </g>
    {/if}
</svg>

<style>
    .art {
        width: 132px;
        height: 132px;
        overflow: visible;
    }

    .room {
        fill: var(--surface);
        stroke: var(--ink);
        stroke-width: 2.5;
    }

    .seat.taken {
        fill: var(--c);
        stroke: var(--ink);
        stroke-width: 2;
    }

    .seat.dim {
        fill: var(--sunken);
        stroke: var(--line-strong);
        stroke-width: 2;
    }

    .seat.empty {
        fill: none;
        stroke: var(--line-strong);
        stroke-width: 2;
        stroke-dasharray: 4 4;
    }

    .you {
        fill: var(--volt);
        stroke: var(--ink);
        stroke-width: 2;
    }

    .badge circle:first-child {
        fill: var(--ink);
    }

    .badge text {
        fill: var(--volt);
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 20px;
    }

    .glyph {
        fill: none;
        stroke: var(--volt);
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .glyph-fill {
        fill: var(--volt);
    }

    .waiting .you {
        animation: knock 2.4s var(--ease-out) infinite;
        transform-origin: 100px 96px;
    }

    @keyframes knock {
        0%, 70%, 100% { transform: translateX(0); }
        76% { transform: translateX(-4px); }
        82% { transform: translateX(0); }
        88% { transform: translateX(-4px); }
    }

    @media (prefers-reduced-motion: reduce) {
        .waiting .you { animation: none; }
    }
</style>

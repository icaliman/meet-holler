<script lang="ts">
    /**
     * The signature picture: the logo's room grown into a live scene. Three people arrive,
     * take turns talking (the Volt ring), and the fourth seat is yours. `invite` lights it,
     * while the Start button is hovered or focused.
     */
    let { invite = false }: { invite?: boolean } = $props()

    const people = [
        { name: 'Ana', seat: 1 },
        { name: 'Mihai', seat: 2 },
        { name: 'Dana', seat: 3 },
    ]
</script>

<div class="hero" aria-hidden="true">
    <div class="room">
        {#each people as person, i (person.name)}
            <div class="tile seat-{person.seat}" style:--i={i}>
                <svg class="person" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet">
                    <circle cx="50" cy="42" r="17" />
                    <path d="M16 100c0-21 15-34 34-34s34 13 34 34z" />
                </svg>
                <span class="tag">
                    <span class="bars"><i></i><i></i><i></i></span>
                    {person.name}
                </span>
            </div>
        {/each}
        <div class="tile you" class:invite>
            <span class="plus">
                <svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 5v14M5 12h14" /></svg>
            </span>
            <span class="your">Your seat</span>
        </div>
    </div>
</div>

<style>
    .hero {
        --frame: #1A1712;
        width: 100%;
        max-width: 520px;
        margin-inline: auto;
        transform: rotate(-2.5deg);
    }

    :global([data-theme='dark']) .hero {
        --frame: #24211B;
    }

    @media (prefers-color-scheme: dark) {
        :global(:root:not([data-theme='light'])) .hero {
            --frame: #24211B;
        }
    }

    .room {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 12px;
        border-radius: 40px;
        background: var(--frame);
        box-shadow: 10px 10px 0 var(--volt);
        aspect-ratio: 1;
    }

    .tile {
        position: relative;
        border-radius: var(--r-lg);
        background: #2A2620;
        overflow: hidden;
        display: grid;
        place-items: end center;
        animation: arrive 520ms var(--ease-spring) both;
        animation-delay: calc(300ms + var(--i) * 650ms);
    }

    .person {
        width: 82%;
        height: 82%;
    }

    .seat-1 .person { fill: var(--seat-1); }
    .seat-2 .person { fill: var(--seat-2); }
    .seat-3 .person { fill: var(--seat-3); }
    .seat-1 { background: #2B2638; }
    .seat-2 { background: #1E2E36; }
    .seat-3 { background: #3A2A21; }

    /* Each person talks for a while in turn: a ring that swells, and bars in their tag. */
    .tile::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: inset 0 0 0 0 var(--volt);
        animation: talk 9s var(--ease-out) infinite;
        animation-delay: calc(2.4s + var(--i) * 3s);
    }

    .tag {
        position: absolute;
        left: 10px;
        bottom: 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px 4px 8px;
        border-radius: var(--r-pill);
        background: rgb(11 10 8 / 0.72);
        color: #F4EFE4;
        font-size: 0.8125rem;
        font-weight: 700;
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
        background: var(--volt);
        animation: bar 9s linear infinite;
        animation-delay: calc(2.4s + var(--i) * 3s);
    }

    .bars i:nth-child(2) { animation-name: bar2; }
    .bars i:nth-child(3) { animation-name: bar3; }

    .you {
        border: 2.5px dashed rgb(244 239 228 / 0.4);
        background: transparent;
        place-items: center;
        align-content: center;
        gap: 6px;
        color: rgb(244 239 228 / 0.75);
        animation-delay: 2.2s;
        transition: background-color var(--t-med) var(--ease-out), border-color var(--t-med) var(--ease-out), color var(--t-med) var(--ease-out);
    }

    .you::after {
        display: none;
    }

    .you.invite {
        background: var(--volt);
        border-color: var(--volt);
        color: #1A1712;
    }

    .plus svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
        stroke-linecap: round;
    }

    .you.invite .plus {
        animation: nudge 600ms var(--ease-spring);
    }

    .your {
        font-family: var(--font-display);
        font-weight: 750;
        font-size: 1.05rem;
        letter-spacing: -0.02em;
    }

    @keyframes arrive {
        from { opacity: 0; transform: scale(0.86); }
        to { opacity: 1; transform: scale(1); }
    }

    @keyframes talk {
        0%, 100% { box-shadow: inset 0 0 0 0 var(--volt); }
        3% { box-shadow: inset 0 0 0 5px var(--volt); }
        8% { box-shadow: inset 0 0 0 3px var(--volt); }
        13% { box-shadow: inset 0 0 0 6px var(--volt); }
        18% { box-shadow: inset 0 0 0 4px var(--volt); }
        24% { box-shadow: inset 0 0 0 5px var(--volt); }
        28% { box-shadow: inset 0 0 0 0 var(--volt); }
    }

    @keyframes bar {
        0%, 28%, 100% { height: 4px; }
        4%, 12%, 20% { height: 12px; }
        8%, 16%, 24% { height: 6px; }
    }

    @keyframes bar2 {
        0%, 28%, 100% { height: 4px; }
        4%, 12%, 20% { height: 7px; }
        8%, 16%, 24% { height: 12px; }
    }

    @keyframes bar3 {
        0%, 28%, 100% { height: 4px; }
        6%, 14%, 22% { height: 10px; }
        10%, 18%, 26% { height: 5px; }
    }

    @keyframes nudge {
        from { transform: scale(0.6) rotate(-90deg); }
        to { transform: scale(1) rotate(0); }
    }

    /* A still, full room: everyone there, Ana talking, no movement. */
    @media (prefers-reduced-motion: reduce) {
        .tile,
        .tile::after,
        .bars i,
        .you.invite .plus {
            animation: none !important;
        }

        .seat-1::after {
            box-shadow: inset 0 0 0 4px var(--volt);
        }

        .seat-1 .bars i { height: 10px; }
    }
</style>

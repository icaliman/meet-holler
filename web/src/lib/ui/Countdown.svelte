<script lang="ts">
    import { onDestroy } from 'svelte'
    import { inWords, remaining } from '../time'

    let { target, ondone }: { target: string, ondone?: () => void } = $props()

    let now = $state(Date.now())
    const timer = setInterval(() => {
        now = Date.now()
    }, 1000)
    onDestroy(() => clearInterval(timer))

    const left = $derived(remaining(target, now))
    // Screen readers hear the minute changes, not every second.
    const spoken = $derived(inWords(remaining(target, Math.floor(now / 60000) * 60000)))

    let fired = false
    $effect(() => {
        if (left.total === 0 && ! fired) {
            fired = true
            ondone?.()
        }
    })

    const units = $derived([
        ...(left.days > 0 ? [{ value: left.days, label: left.days === 1 ? 'day' : 'days' }] : []),
        { value: left.hours, label: left.hours === 1 ? 'hour' : 'hours' },
        { value: left.minutes, label: 'min' },
        { value: left.seconds, label: 'sec' },
    ])
</script>

<div class="countdown">
    <p class="visually-hidden" aria-live="polite">Opens in {spoken}.</p>
    <div class="units" aria-hidden="true">
        {#each units as unit (unit.label)}
            <div class="unit">
                <span class="value">{String(unit.value).padStart(2, '0')}</span>
                <span class="label">{unit.label}</span>
            </div>
        {/each}
    </div>
</div>

<style>
    .units {
        display: flex;
        justify-content: center;
        gap: var(--s-2);
    }

    .unit {
        display: grid;
        justify-items: center;
        min-width: 76px;
        padding: var(--s-3) var(--s-2) var(--s-2);
        border-radius: var(--r-md);
        background: var(--surface);
        border: 2px solid var(--ink);
    }

    .unit:last-child {
        background: var(--volt);
        color: var(--on-volt);
        border-color: var(--volt-outline);
    }

    .value {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: clamp(2rem, 1.5rem + 2vw, 3rem);
        line-height: 1;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
    }

    .label {
        font-size: var(--text-sm);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.75;
    }

    @media (max-width: 420px) {
        .unit { min-width: 64px; }
    }
</style>

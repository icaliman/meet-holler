<script lang="ts" generics="T extends string">
    import Icon from './Icon.svelte'
    import type { IconName } from './icons'

    let {
        value = $bindable(),
        options,
        legend,
        name,
    }: {
        value: T
        options: Array<{ value: T, label: string, icon?: IconName }>
        legend: string
        name: string
    } = $props()
</script>

<fieldset>
    <legend>{legend}</legend>
    <div class="track">
        {#each options as option (option.value)}
            <label class:selected={value === option.value}>
                <input type="radio" {name} value={option.value} bind:group={value} />
                {#if option.icon}<Icon name={option.icon} size={18} />{/if}
                <span>{option.label}</span>
            </label>
        {/each}
    </div>
</fieldset>

<style>
    fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-2);
        min-width: 0;
    }

    legend {
        font-weight: 700;
        padding: 0;
        margin-bottom: var(--s-2);
    }

    .track {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: 1fr;
        gap: var(--s-1);
        padding: var(--s-1);
        border-radius: var(--r-pill);
        background: var(--sunken);
        border: 2px solid var(--line);
    }

    label {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--s-2);
        min-height: 44px;
        border-radius: var(--r-pill);
        font-weight: 700;
        cursor: pointer;
        color: var(--ink-muted);
        transition: background-color var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
    }

    label.selected {
        background: var(--surface);
        color: var(--ink);
        box-shadow: 0 0 0 2px var(--ink);
    }

    input {
        position: absolute;
        opacity: 0;
        inset: 0;
        margin: 0;
        cursor: pointer;
    }

    label:has(input:focus-visible) {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
    }
</style>

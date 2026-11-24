<script lang="ts">
    import type { Snippet } from 'svelte'
    import Icon from './Icon.svelte'

    interface Control {
        id: string
        describedby: string | undefined
        invalid: boolean
    }

    let {
        label,
        id,
        hint = null,
        error = null,
        optional = false,
        children,
    }: {
        label: string
        id: string
        hint?: string | null
        error?: string | null
        optional?: boolean
        children: Snippet<[Control]>
    } = $props()

    const describedby = $derived([error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined)
</script>

<div class="field" class:has-error={Boolean(error)}>
    <label for={id}>
        {label}
        {#if optional}<span class="optional">optional</span>{/if}
    </label>
    {@render children({ id, describedby, invalid: Boolean(error) })}
    {#if error}
        <p class="error" id="{id}-error">
            <Icon name="alert" size={18} />
            <span>{error}</span>
        </p>
    {/if}
    {#if hint}
        <p class="hint" id="{id}-hint">{hint}</p>
    {/if}
</div>

<style>
    .field {
        display: grid;
        gap: var(--s-2);
    }

    label {
        font-weight: 700;
        display: flex;
        align-items: baseline;
        gap: var(--s-2);
    }

    .optional {
        font-weight: 400;
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .hint {
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .error {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        font-size: var(--text-sm);
        font-weight: 700;
        color: var(--danger);
    }

    .error :global(svg) {
        margin-top: 1px;
    }

    .field :global(.input) {
        width: 100%;
        min-height: 52px;
        padding: 0 var(--s-4);
        border-radius: var(--r-sm);
        border: 2px solid var(--line-strong);
        background: var(--surface);
        font-size: max(16px, var(--text-md));
        transition: border-color var(--t-fast) var(--ease-out);
    }

    .field :global(.input:hover) {
        border-color: var(--ink-muted);
    }

    .field :global(.input:focus-visible) {
        border-color: var(--ink);
        outline-offset: 1px;
    }

    .field :global(.input[aria-invalid='true']) {
        border-color: var(--danger);
    }

    .field :global(.input::placeholder) {
        color: var(--ink-muted);
        opacity: 0.75;
    }
</style>

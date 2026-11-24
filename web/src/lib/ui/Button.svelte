<script lang="ts">
    import type { Snippet } from 'svelte'
    import type { HTMLButtonAttributes } from 'svelte/elements'
    import Icon from './Icon.svelte'
    import type { IconName } from './icons'

    type Props = HTMLButtonAttributes & {
        variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
        size?: 'md' | 'sm' | 'lg'
        icon?: IconName | null
        iconRight?: IconName | null
        busy?: boolean
        /** What the button says while busy ("Starting…"). */
        busyLabel?: string
        href?: string | null
        download?: string | boolean | null
        wide?: boolean
        children: Snippet
    }

    let {
        variant = 'secondary',
        size = 'md',
        icon = null,
        iconRight = null,
        busy = false,
        busyLabel,
        href = null,
        download = null,
        wide = false,
        type = 'button',
        disabled = false,
        children,
        class: className = '',
        ...rest
    }: Props = $props()
</script>

{#snippet inner()}
    {#if busy}
        <span class="spinner" aria-hidden="true"></span>
    {:else if icon}
        <Icon name={icon} size={size === 'sm' ? 18 : 20} />
    {/if}
    <span class="label">
        {#if busy && busyLabel}{busyLabel}{:else}{@render children()}{/if}
    </span>
    {#if iconRight && ! busy}
        <Icon name={iconRight} size={size === 'sm' ? 18 : 20} />
    {/if}
{/snippet}

{#if href}
    <a
        class="btn {variant} {size} {className}"
        class:wide
        {href}
        download={download === true ? '' : (download || undefined)}
        aria-disabled={disabled || undefined}
    >
        {@render inner()}
    </a>
{:else}
    <button
        class="btn {variant} {size} {className}"
        class:wide
        class:busy
        {type}
        disabled={disabled || undefined}
        aria-busy={busy || undefined}
        {...rest}
    >
        {@render inner()}
    </button>
{/if}

<style>
    .btn {
        --h: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--s-2);
        min-height: var(--h);
        padding: 0 calc(var(--h) / 2.4);
        border-radius: var(--r-pill);
        border: 2px solid transparent;
        font-family: var(--font-text);
        font-weight: 700;
        font-size: var(--text-md);
        line-height: 1;
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
        user-select: none;
        transition:
            transform var(--t-fast) var(--ease-out),
            box-shadow var(--t-fast) var(--ease-out),
            background-color var(--t-fast) var(--ease-out),
            border-color var(--t-fast) var(--ease-out);
    }

    .sm { --h: 44px; font-size: var(--text-sm); }
    .lg { --h: 56px; font-size: 1.125rem; }
    .wide { width: 100%; }

    .primary {
        background: var(--volt);
        color: var(--on-volt);
        border-color: var(--volt-outline);
        box-shadow: var(--lift);
    }

    .primary:hover {
        transform: translateY(-1px);
    }

    .primary:active:not(:disabled) {
        transform: translateY(2px);
        box-shadow: var(--lift-pressed);
    }

    .secondary {
        background: var(--surface);
        color: var(--ink);
        border-color: var(--ink);
    }

    .secondary:hover {
        background: var(--sunken);
    }

    .ghost {
        background: transparent;
        color: var(--ink);
        padding: 0 var(--s-3);
    }

    .ghost:hover {
        background: color-mix(in srgb, var(--ink) 8%, transparent);
    }

    .danger {
        background: var(--danger);
        color: var(--on-danger);
    }

    .danger:hover {
        filter: brightness(1.06);
    }

    .btn:disabled,
    .btn[aria-disabled='true'] {
        cursor: not-allowed;
        opacity: 0.55;
        transform: none;
    }

    .btn.busy {
        cursor: progress;
        opacity: 1;
    }

    .spinner {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2.5px solid currentColor;
        border-right-color: transparent;
        animation: spin 700ms linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
</style>

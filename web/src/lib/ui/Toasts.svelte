<script lang="ts">
    import { flip } from 'svelte/animate'
    import { fly, fade } from 'svelte/transition'
    import Button from './Button.svelte'
    import Icon from './Icon.svelte'
    import { dismiss, toasts, type Toast, type ToastAction } from './toast-store.svelte'

    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    let busy = $state<number | null>(null)

    async function act(item: Toast, action: ToastAction) {
        busy = item.id
        try {
            await action.run()
            dismiss(item.id)
        } finally {
            busy = null
        }
    }
</script>

<div class="toasts {toasts.placement}" aria-live="polite" aria-relevant="additions text" role="region" aria-label="Notifications">
    {#each toasts.list as item (item.id)}
        <div
            class="toast {item.tone}"
            animate:flip={{ duration: reduced ? 0 : 240 }}
            in:fly={{ y: reduced ? 0 : 16, duration: reduced ? 120 : 240 }}
            out:fade={{ duration: 160 }}
        >
            <div class="body">
                {#if item.tone === 'error'}
                    <Icon name="alert" size={20} />
                {:else if item.tone === 'success'}
                    <Icon name="check" size={20} />
                {/if}
                <p>
                    {#if item.who}<strong>{item.who}</strong>{' '}{/if}{item.message}
                </p>
                {#if ! item.actions.length}
                    <button class="close" type="button" aria-label="Dismiss" onclick={() => dismiss(item.id)}>
                        <Icon name="x" size={18} />
                    </button>
                {/if}
            </div>
            {#if item.actions.length}
                <div class="actions">
                    {#each item.actions as action}
                        <Button size="sm" variant={action.variant ?? 'secondary'} disabled={busy === item.id} onclick={() => act(item, action)}>
                            {action.label}
                        </Button>
                    {/each}
                </div>
            {/if}
        </div>
    {/each}
</div>

<style>
    .toasts {
        position: fixed;
        z-index: 50;
        left: var(--gutter);
        right: var(--gutter);
        bottom: calc(var(--s-4) + env(safe-area-inset-bottom));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--s-2);
        pointer-events: none;
    }

    /* In the meeting: light cards at the top right, clear of the name tags and the controls. */
    .toasts.stage {
        --ink: #F4EFE4;
        --bg: #1A1712;
        top: calc(72px + env(safe-area-inset-top));
        bottom: auto;
    }

    @media (min-width: 768px) {
        .toasts.stage {
            left: auto;
            right: var(--s-4);
            align-items: flex-end;
        }
    }

    @media (min-width: 768px) {
        .toasts {
            align-items: flex-start;
            right: auto;
            max-width: 420px;
        }
    }

    .toast {
        pointer-events: auto;
        width: min(100%, 420px);
        background: var(--ink);
        color: var(--bg);
        border-radius: var(--r-md);
        padding: var(--s-3) var(--s-3) var(--s-3) var(--s-4);
        box-shadow: var(--shadow-float);
        font-size: var(--text-sm);
    }

    .toast.error {
        background: var(--danger);
        color: var(--on-danger);
    }

    .body {
        display: flex;
        align-items: center;
        gap: var(--s-3);
        min-height: 32px;
    }

    .body p {
        flex: 1;
    }

    .success :global(svg) {
        color: var(--volt);
    }

    .close {
        flex: none;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .close:hover {
        background: color-mix(in srgb, currentColor 15%, transparent);
    }

    .actions {
        display: flex;
        gap: var(--s-2);
        justify-content: flex-end;
        margin-top: var(--s-3);
    }

    /* Buttons on the inverted toast: the ink is the background here. */
    .actions :global(.btn.secondary) {
        background: transparent;
        color: var(--bg);
        border-color: var(--bg);
    }

    .actions :global(.btn.primary) {
        border-color: transparent;
        box-shadow: none;
    }
</style>

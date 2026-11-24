<script lang="ts">
    import type { Snippet } from 'svelte'
    import { fly } from 'svelte/transition'
    import Icon from '../ui/Icon.svelte'

    let { title, onclose, children }: { title: string, onclose: () => void, children: Snippet } = $props()

    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 767px)').matches
    let heading: HTMLHeadingElement | undefined = $state()

    $effect(() => {
        heading?.focus()
    })
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onclose() }} />

<!-- A panel beside the stage (below it on phones), not a modal: the meeting stays usable. -->
<aside
    class="sheet"
    aria-labelledby="sheet-title"
    transition:fly={{ x: phone || reduced ? 0 : 24, y: phone && ! reduced ? 24 : 0, duration: reduced ? 120 : 240 }}
>
    <header>
        <h2 id="sheet-title" tabindex="-1" bind:this={heading}>{title}</h2>
        <button type="button" class="close" aria-label="Close {title}" onclick={onclose}>
            <Icon name="x" size={20} />
        </button>
    </header>
    <div class="body">
        {@render children()}
    </div>
</aside>

<style>
    .sheet {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--r-lg);
        overflow: hidden;
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s-3);
        padding: var(--s-4) var(--s-4) var(--s-3) var(--s-5);
    }

    h2 {
        font-size: var(--text-lg);
    }

    h2:focus {
        outline: none;
    }

    .close {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 0;
        background: transparent;
        color: var(--ink);
        cursor: pointer;
    }

    .close:hover {
        background: var(--sunken);
    }

    .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 var(--s-5) var(--s-5);
        display: grid;
        align-content: start;
        gap: var(--s-5);
    }
</style>

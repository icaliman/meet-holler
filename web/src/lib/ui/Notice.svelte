<script lang="ts">
    import type { Snippet } from 'svelte'
    import SeatsArt from './SeatsArt.svelte'
    import type { Mood } from './moods'

    let {
        mood,
        title,
        children,
        actions,
        live = false,
    }: {
        mood: Mood
        title: string
        children: Snippet
        actions?: Snippet
        /** Announce the title and message when they appear (a state that changes under you). */
        live?: boolean
    } = $props()
</script>

<section class="notice" aria-labelledby="notice-title">
    <SeatsArt {mood} />
    <div class="copy" role={live ? 'status' : undefined}>
        <h1 id="notice-title" tabindex="-1" data-autofocus>{title}</h1>
        <div class="message">{@render children()}</div>
    </div>
    {#if actions}
        <div class="actions">{@render actions()}</div>
    {/if}
</section>

<style>
    .notice {
        max-width: 520px;
        margin: 0 auto;
        padding: var(--s-7) 0;
        display: grid;
        justify-items: center;
        text-align: center;
        gap: var(--s-5);
    }

    .copy {
        display: grid;
        gap: var(--s-3);
    }

    h1 {
        font-size: var(--text-xl);
    }

    h1:focus {
        outline: none;
    }

    .message {
        color: var(--ink-muted);
        font-size: 1.125rem;
        display: grid;
        gap: var(--s-2);
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--s-3);
        margin-top: var(--s-2);
    }
</style>

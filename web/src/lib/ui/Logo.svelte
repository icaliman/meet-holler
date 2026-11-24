<script lang="ts">
    import Mark from './Mark.svelte'

    let { href = '/' }: { href?: string | null } = $props()
</script>

{#if href}
    <a class="logo" {href} aria-label="Holler, home">
        <Mark size={34} />
        <span class="word" aria-hidden="true">holler</span>
    </a>
{:else}
    <span class="logo">
        <Mark size={34} />
        <span class="word">holler</span>
    </span>
{/if}

<style>
    .logo {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        text-decoration: none;
        color: var(--ink);
        border-radius: var(--r-sm);
    }

    .word {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 1.55rem;
        letter-spacing: -0.045em;
        line-height: 1;
        padding-bottom: 3px;
    }

    @media (max-width: 359px) {
        .word { display: none; }
    }
</style>

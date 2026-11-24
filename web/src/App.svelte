<script lang="ts">
    import { onMount, tick } from 'svelte'
    import Home from './pages/home/Home.svelte'
    import Ready from './pages/Ready.svelte'
    import Meeting from './pages/meeting/Meeting.svelte'
    import Button from './lib/ui/Button.svelte'
    import Logo from './lib/ui/Logo.svelte'
    import Notice from './lib/ui/Notice.svelte'
    import ThemeSwitch from './lib/ui/ThemeSwitch.svelte'
    import Toasts from './lib/ui/Toasts.svelte'
    import Announcer from './lib/ui/Announcer.svelte'
    import { router, startRouter } from './lib/router.svelte'

    onMount(() => startRouter())

    const route = $derived(router.route)
    const routeKey = $derived(router.path)

    // On every page change after the first, focus moves to the new page's heading,
    // so a screen reader starts reading there.
    let first = true
    $effect(() => {
        void routeKey
        if (first) {
            first = false
            return
        }
        tick().then(() => {
            const target = document.querySelector<HTMLElement>('main h1[tabindex="-1"]')
            target?.focus({ preventScroll: true })
        })
    })

    $effect(() => {
        document.title = route.name === 'home' ? 'Holler · Video meetings for up to four' : 'Holler'
    })
</script>

<a class="skip-link" href="#main">Skip to content</a>

<div class="shell">
    <header class="top">
        <Logo />
    </header>

    <main id="main">
        {#key routeKey}
            {#if route.name === 'home'}
                <Home />
            {:else if route.name === 'ready'}
                <Ready code={route.code} />
            {:else if route.name === 'meeting'}
                <Meeting code={route.code} />
            {:else if import.meta.env.DEV && routeKey === '/dev/room'}
                <!-- Dev only: the room with made-up people (src/dev/), left out of the build. -->
                {#await import('./dev/DemoRoom.svelte') then demo}
                    <demo.default />
                {/await}
            {:else}
                <Notice mood="missing" title="There's nothing here">
                    <p>This page doesn't exist. If you were looking for a meeting, check the link in your invite.</p>
                    {#snippet actions()}
                        <Button variant="primary" href="/" icon="arrowLeft">Back to start</Button>
                    {/snippet}
                </Notice>
            {/if}
        {/key}
    </main>

    <footer class="foot">
        <p>Video goes straight between browsers. No account, no tracking.</p>
        <ThemeSwitch />
    </footer>
</div>

<Toasts />
<Announcer />

<style>
    .shell {
        min-height: 100dvh;
        display: grid;
        grid-template-rows: auto 1fr auto;
        width: 100%;
        max-width: calc(var(--content) + 2 * var(--gutter));
        margin: 0 auto;
        padding-inline: var(--gutter);
    }

    .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-block: var(--s-4);
    }

    main {
        min-width: 0;
    }

    main:focus {
        outline: none;
    }

    .foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--s-3);
        padding-block: var(--s-5);
        border-top: 2px solid var(--line);
        color: var(--ink-muted);
        font-size: var(--text-sm);
    }
</style>

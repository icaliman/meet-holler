<script lang="ts">
    import Button from '../../lib/ui/Button.svelte'
    import Notice from '../../lib/ui/Notice.svelte'
    import Gate from './Gate.svelte'
    import Lobby from './Lobby.svelte'
    import { api, ApiError } from '../../lib/api'
    import { gate } from '../../lib/gate'
    import { explain } from '../../lib/messages'
    import { claimHostFragment, hostKeyFor } from '../../lib/storage'
    import type { Meeting } from '../../lib/types'

    let { code }: { code: string } = $props()

    // The page is remounted per route (App keys it on the path), so the code never changes here.
    // svelte-ignore state_referenced_locally
    claimHostFragment(code)
    // svelte-ignore state_referenced_locally
    const hostKey = hostKeyFor(code)

    let meeting = $state<Meeting | null>(null)
    let failure = $state<ApiError | Error | null>(null)
    let loading = $state(true)

    async function load() {
        try {
            meeting = await api.getMeeting(code)
            failure = null
        } catch (error) {
            failure = error as Error
        } finally {
            loading = false
        }
    }

    $effect(() => {
        load()
    })

    const view = $derived(meeting ? gate(meeting, Boolean(hostKey)) : null)
</script>

{#if loading}
    <div class="loading" role="status">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>Finding your meeting…</span>
    </div>
{:else if failure instanceof ApiError && failure.code === 'not_found'}
    <Notice mood="missing" title="We can't find that meeting">
        <p>Check the code in your invite, or start a new meeting.</p>
        {#snippet actions()}
            <Button variant="primary" href="/" icon="arrowLeft">Back to start</Button>
        {/snippet}
    </Notice>
{:else if failure}
    <Notice mood="missing" title="We couldn't open the meeting">
        <p>{explain(failure)}</p>
        {#snippet actions()}
            <Button variant="primary" icon="refresh" onclick={load}>Try again</Button>
        {/snippet}
    </Notice>
{:else if meeting && view && view !== 'lobby'}
    <Gate {meeting} kind={view} onretry={load} />
{:else if meeting}
    <Lobby {meeting} {hostKey} />
{/if}

<style>
    .loading {
        min-height: 50vh;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: var(--s-4);
        color: var(--ink-muted);
        font-weight: 700;
    }

    .dots {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        padding: 8px;
        border-radius: 14px;
        background: var(--ink);
    }

    .dots i {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--bg);
        opacity: 0.35;
        animation: seat 1.2s var(--ease-out) infinite;
    }

    .dots i:nth-child(1) { animation-delay: 0ms; }
    .dots i:nth-child(2) { animation-delay: 150ms; }
    .dots i:nth-child(4) { animation-delay: 300ms; }
    .dots i:nth-child(3) { animation-delay: 450ms; }

    @keyframes seat {
        0%, 100% { opacity: 0.35; }
        30% { opacity: 1; background: var(--volt); }
    }
</style>

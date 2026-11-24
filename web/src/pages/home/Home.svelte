<script lang="ts">
    import { tick } from 'svelte'
    import { slide } from 'svelte/transition'
    import Button from '../../lib/ui/Button.svelte'
    import CodeInput from '../../lib/ui/CodeInput.svelte'
    import Field from '../../lib/ui/Field.svelte'
    import Hero from './Hero.svelte'
    import ScheduleForm from './ScheduleForm.svelte'
    import { api } from '../../lib/api'
    import { check, extractCode, meetingPath } from '../../lib/code'
    import { explain } from '../../lib/messages'
    import { navigate } from '../../lib/router.svelte'
    import { rememberHostKey } from '../../lib/storage'

    let starting = $state(false)
    let startError = $state<string | null>(null)
    let inviting = $state(false)

    let code = $state('')
    let codeError = $state<string | null>(null)

    let scheduling = $state(false)
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

    async function start() {
        if (starting) return
        starting = true
        startError = null
        try {
            const { meeting, hostKey } = await api.createMeeting({ visibility: 'public', waitingRoom: false })
            rememberHostKey(meeting.code, hostKey)
            navigate(meetingPath(meeting.code))
        } catch (error) {
            startError = explain(error)
        } finally {
            starting = false
        }
    }

    function join(event: SubmitEvent) {
        event.preventDefault()
        codeError = check(code)
        if (codeError) {
            document.getElementById('join-code')?.focus()
            return
        }
        const found = extractCode(code)!
        // A pasted host link keeps its key (#host=…), so it still makes you the host.
        const host = /#host=([^&\s]+)/.exec(code)
        if (host) rememberHostKey(found, decodeURIComponent(host[1]))
        navigate(meetingPath(found))
    }

    async function openSchedule() {
        scheduling = true
        await tick()
        document.getElementById('schedule-title')?.focus()
        document.getElementById('schedule-panel')?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    }
</script>

<div class="home">
    <section class="intro">
        <h1 id="page-title" tabindex="-1">
            A room for four.
            <span class="accent">Open it in <mark>one click.</mark></span>
        </h1>
        <p class="lede">Video meetings in your browser. No account, no app, nothing to install.</p>
    </section>

    <div class="art">
        <Hero invite={inviting} />
    </div>

    <section class="actions" aria-label="Get started">
        <div class="action start">
            <span class="step" aria-hidden="true">1</span>
            <div class="action-body">
                <h2>Start a meeting</h2>
                <p>Get a link right now and go in.</p>
            </div>
            <div
                class="cta"
                role="presentation"
                onmouseenter={() => (inviting = true)}
                onmouseleave={() => (inviting = false)}
                onfocusin={() => (inviting = true)}
                onfocusout={() => (inviting = false)}
            >
                <Button variant="primary" size="lg" icon="bolt" busy={starting} busyLabel="Starting…" onclick={start} wide>Start a meeting</Button>
            </div>
            {#if startError}
                <p class="inline-error" role="alert">{startError}</p>
            {/if}
        </div>

        <form class="action join" onsubmit={join} novalidate>
            <span class="step" aria-hidden="true">2</span>
            <div class="action-body">
                <h2 id="join-title">Join with a code</h2>
            </div>
            <Field label="Meeting code or link" id="join-code" error={codeError}>
                {#snippet children({ id, describedby, invalid })}
                    <div class="join-row">
                        <CodeInput {id} {describedby} {invalid} bind:value={code} oninput={() => (codeError = null)} />
                        <Button type="submit" variant="secondary" iconRight="arrowRight">Join</Button>
                    </div>
                {/snippet}
            </Field>
        </form>

        <div class="action schedule">
            <span class="step" aria-hidden="true">3</span>
            <div class="action-body">
                <h2>Schedule for later</h2>
                <p>Pick a time, share the invite.</p>
            </div>
            <Button variant="secondary" icon="calendar" onclick={openSchedule} aria-expanded={scheduling} aria-controls="schedule-panel" wide>
                Schedule for later
            </Button>
        </div>
    </section>

    {#if scheduling}
        <section id="schedule-panel" class="panel" transition:slide={{ duration: reduced ? 0 : 280 }}>
            <ScheduleForm oncancel={() => (scheduling = false)} />
        </section>
    {/if}
</div>

<style>
    .home {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--s-6);
        padding-block: var(--s-5) var(--s-8);
    }

    @media (min-width: 960px) {
        .home {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
            grid-template-areas:
                'intro art'
                'actions actions'
                'panel panel';
            column-gap: var(--s-8);
            row-gap: var(--s-7);
            padding-top: var(--s-7);
            align-items: center;
        }

        .intro { grid-area: intro; }
        .art { grid-area: art; }
        .actions { grid-area: actions; }
        .panel { grid-area: panel; }
    }

    h1 {
        font-size: var(--text-hero);
        line-height: 0.95;
        letter-spacing: -0.045em;
        font-weight: 800;
        text-wrap: balance;
    }

    h1:focus {
        outline: none;
    }

    .accent {
        display: block;
    }

    mark {
        background: none;
        color: inherit;
        white-space: nowrap;
        box-shadow: inset 0 -0.34em 0 var(--volt);
        padding-inline: 0.04em;
    }

    .lede {
        margin-top: var(--s-5);
        font-size: clamp(1.125rem, 1rem + 0.5vw, 1.375rem);
        max-width: 34ch;
    }

    .art {
        padding: var(--s-2) var(--s-4) var(--s-4) var(--s-2);
    }

    /* On phones the three actions come first; the picture follows them. */
    @media (max-width: 959px) {
        .art {
            order: 1;
            max-width: 340px;
            width: 100%;
            justify-self: center;
        }
    }

    .actions {
        display: grid;
        gap: var(--s-4);
    }

    @media (min-width: 960px) {
        .actions {
            grid-template-columns: 1fr 1.25fr 1fr;
            align-items: stretch;
        }
    }

    .action {
        position: relative;
        display: grid;
        align-content: start;
        gap: var(--s-4);
        padding: var(--s-5);
        border-radius: var(--r-md);
        background: var(--surface);
        border: 2px solid var(--line);
        min-width: 0;
    }

    .action.start {
        border-color: var(--ink);
        box-shadow: var(--lift);
    }

    .action > :global(:last-child) {
        align-self: end;
    }

    @media (min-width: 960px) {
        .action {
            grid-template-rows: auto 1fr auto;
        }
    }

    .step {
        position: absolute;
        top: var(--s-4);
        right: var(--s-4);
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--sunken);
        font-family: var(--font-display);
        font-weight: 800;
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .start .step {
        background: var(--volt);
        color: var(--on-volt);
    }

    .action-body {
        display: grid;
        gap: var(--s-1);
        padding-right: var(--s-6);
    }

    h2 {
        font-size: var(--text-lg);
    }

    .action-body p {
        color: var(--ink-muted);
    }

    .join-row {
        display: flex;
        gap: var(--s-2);
    }

    .join-row :global(input) {
        flex: 1;
        min-width: 0;
    }

    .join-row :global(.btn) {
        min-height: 52px;
    }

    .inline-error {
        color: var(--danger);
        font-weight: 700;
        font-size: var(--text-sm);
    }

    .panel {
        max-width: 640px;
        width: 100%;
        justify-self: center;
        padding: var(--s-6) var(--s-5);
        border-radius: var(--r-md);
        background: var(--surface);
        border: 2px solid var(--ink);
        scroll-margin-top: var(--s-5);
    }

    @media (min-width: 768px) {
        .panel {
            padding: var(--s-6);
        }
    }
</style>

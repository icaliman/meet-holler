<script lang="ts">
    import Button from '../lib/ui/Button.svelte'
    import CopyField from '../lib/ui/CopyField.svelte'
    import Icon from '../lib/ui/Icon.svelte'
    import Notice from '../lib/ui/Notice.svelte'
    import { api } from '../lib/api'
    import { createdFor } from '../lib/created'
    import { format, hostUrl, meetingPath, meetingUrl } from '../lib/code'
    import { explain } from '../lib/messages'
    import { hostKeyFor } from '../lib/storage'
    import { durationLabel } from '../lib/schedule'
    import { longDate, timeZone } from '../lib/time'
    import type { Meeting } from '../lib/types'

    let { code }: { code: string } = $props()

    // The page is remounted per route (App keys it on the path), so the code never changes here.
    // svelte-ignore state_referenced_locally
    const created = createdFor(code)
    // svelte-ignore state_referenced_locally
    const hostKey = hostKeyFor(code)
    let meeting = $state<Meeting | null>(created?.meeting ?? null)
    let failure = $state<string | null>(null)

    $effect(() => {
        api.getMeeting(code).then((fresh) => (meeting = fresh)).catch((error) => {
            if (! meeting) failure = explain(error)
        })
    })

    const link = $derived(meetingUrl(code))
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

    function share() {
        navigator.share?.({ title: meeting?.title ?? 'Meeting', text: invitation(), url: link }).catch(() => {})
    }

    function invitation(): string {
        const lines = [meeting?.title ? `Join "${meeting.title}" on Holler` : 'Join my meeting on Holler']
        if (meeting?.scheduledAt) lines.push(longDate(meeting.scheduledAt))
        lines.push(link)

        return lines.join('\n')
    }
</script>

{#if failure}
    <Notice mood="missing" title="We can't find that meeting">
        <p>{failure}</p>
        {#snippet actions()}
            <Button variant="primary" href="/" icon="arrowLeft">Back to start</Button>
        {/snippet}
    </Notice>
{:else}
    <article class="ready">
        <header>
            <p class="eyebrow"><Icon name="check" size={18} /> Meeting created</p>
            <h1 id="page-title" tabindex="-1">Your meeting is ready.</h1>
            <p class="lede">Send this link to the people you're meeting.</p>
        </header>

        <div class="card">
            <dl class="facts">
                {#if meeting?.title}
                    <div class="fact title"><dt>Title</dt><dd>{meeting.title}</dd></div>
                {/if}
                {#if meeting?.scheduledAt}
                    <div class="fact"><dt>When</dt><dd>{longDate(meeting.scheduledAt)}<span class="tz">{timeZone()}</span></dd></div>
                {/if}
                {#if meeting?.durationMin}
                    <div class="fact"><dt>Length</dt><dd>{durationLabel(meeting.durationMin)}</dd></div>
                {/if}
                <div class="fact"><dt>Code</dt><dd class="code">{format(code)}</dd></div>
                <div class="fact">
                    <dt>Who can join</dt>
                    <dd>
                        {meeting?.visibility === 'private' ? 'People with the link and the passcode' : 'Anyone with the link'}{meeting?.waitingRoom ? ', after you let them in' : ''}
                    </dd>
                </div>
            </dl>

            <CopyField id="ready-link" label="Meeting link" value={link} />

            {#if created?.passcode}
                <CopyField id="ready-passcode" label="Passcode (send it separately)" value={created.passcode} copyLabel="Copy" />
            {/if}

            <div class="buttons">
                <Button variant="primary" href={meetingPath(code)} icon="arrowRight" size="lg">Start now</Button>
                {#if meeting?.scheduledAt}
                    <Button variant="secondary" href={api.icsUrl(code)} download="{format(code)}.ics" icon="calendar">Add to calendar</Button>
                {/if}
                {#if canShare}
                    <Button variant="ghost" icon="link" onclick={share}>Share…</Button>
                {/if}
            </div>
        </div>

        {#if hostKey}
            <details class="host">
                <summary><Icon name="chevronDown" size={18} /> Host from another device</summary>
                <p>This browser already knows you're the host. To host from your phone or another computer, open this link there. Keep it to yourself: anyone with it can end the meeting.</p>
                <CopyField id="ready-host" label="Host link" value={hostUrl(code, hostKey)} secret />
            </details>
        {/if}
    </article>
{/if}

<style>
    .ready {
        max-width: 640px;
        margin: 0 auto;
        padding-block: var(--s-6) var(--s-8);
        display: grid;
        gap: var(--s-6);
    }

    header {
        display: grid;
        gap: var(--s-3);
    }

    .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        justify-self: start;
        padding: var(--s-1) var(--s-3);
        border-radius: var(--r-pill);
        background: var(--volt);
        color: var(--on-volt);
        font-weight: 700;
        font-size: var(--text-sm);
    }

    h1 {
        font-size: var(--text-xl);
    }

    h1:focus {
        outline: none;
    }

    .lede {
        font-size: 1.125rem;
        color: var(--ink-muted);
    }

    .card {
        display: grid;
        gap: var(--s-5);
        padding: var(--s-5);
        border-radius: var(--r-md);
        background: var(--surface);
        border: 2px solid var(--ink);
        box-shadow: var(--lift);
    }

    @media (min-width: 768px) {
        .card { padding: var(--s-6); }
    }

    .facts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: var(--s-4);
        margin: 0;
    }

    .fact {
        display: grid;
        gap: 2px;
    }

    .fact.title {
        grid-column: 1 / -1;
    }

    .fact.title dd {
        font-family: var(--font-display);
        font-size: var(--text-lg);
        font-weight: 750;
        letter-spacing: -0.02em;
    }

    dt {
        font-size: var(--text-sm);
        color: var(--ink-muted);
        font-weight: 700;
    }

    dd {
        margin: 0;
        font-weight: 700;
    }

    .tz {
        display: block;
        font-weight: 400;
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-3);
    }

    .host {
        border-top: 2px solid var(--line);
        padding-top: var(--s-4);
    }

    .host summary {
        cursor: pointer;
        font-weight: 700;
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: var(--s-2);
        list-style: none;
    }

    .host summary::-webkit-details-marker {
        display: none;
    }

    .host summary :global(svg) {
        transition: transform var(--t-med) var(--ease-out);
        transform: rotate(-90deg);
    }

    .host[open] summary :global(svg) {
        transform: none;
    }

    .host p {
        color: var(--ink-muted);
        margin-block: var(--s-2) var(--s-4);
    }
</style>

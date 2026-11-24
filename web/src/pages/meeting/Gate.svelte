<script lang="ts">
    /** The states in front of a meeting: ended, too early, full, locked. Each says what to do next. */
    import Button from '../../lib/ui/Button.svelte'
    import Countdown from '../../lib/ui/Countdown.svelte'
    import Notice from '../../lib/ui/Notice.svelte'
    import { api } from '../../lib/api'
    import { format } from '../../lib/code'
    import { inWords, longDate, remaining, timeZone } from '../../lib/time'
    import type { Gate } from '../../lib/gate'
    import type { Meeting } from '../../lib/types'

    let { meeting, kind, onretry }: { meeting: Meeting, kind: Exclude<Gate, 'lobby'>, onretry: () => unknown } = $props()

    let checking = $state(false)
    async function retry() {
        checking = true
        try {
            await onretry()
        } finally {
            checking = false
        }
    }
</script>

{#if kind === 'ended'}
    <Notice mood="ended" title="This meeting has ended">
        <p>Thanks for coming.{meeting.title ? ` "${meeting.title}" is over.` : ''}</p>
        {#snippet actions()}
            <Button variant="primary" href="/" icon="bolt">Start a new meeting</Button>
        {/snippet}
    </Notice>
{:else if kind === 'early' && meeting.scheduledAt}
    <Notice mood="early" title="You're early">
        <p>
            {meeting.title ? `"${meeting.title}"` : 'This meeting'} opens in {inWords(remaining(meeting.scheduledAt))}, on
            {longDate(meeting.scheduledAt)} ({timeZone()}).
        </p>
        <p>Keep this page open. It lets you in when it's time.</p>
        {#snippet actions()}
            <div class="early">
                <Countdown target={meeting.scheduledAt!} ondone={retry} />
                <div class="buttons">
                    <Button variant="secondary" href={api.icsUrl(meeting.code)} download="{format(meeting.code)}.ics" icon="calendar">Add to calendar</Button>
                    <Button variant="ghost" icon="refresh" busy={checking} busyLabel="Checking…" onclick={retry}>Check again</Button>
                </div>
            </div>
        {/snippet}
    </Notice>
{:else if kind === 'full'}
    <Notice mood="full" title="This meeting is full">
        <p>It holds four people, and four are in. Try again in a moment, or start a new meeting.</p>
        {#snippet actions()}
            <Button variant="primary" icon="refresh" busy={checking} busyLabel="Checking…" onclick={retry}>Try again</Button>
            <Button variant="secondary" href="/" icon="bolt">Start a new meeting</Button>
        {/snippet}
    </Notice>
{:else if kind === 'locked'}
    <Notice mood="locked" title="This meeting is locked">
        <p>The host has locked it, so nobody new can come in. Ask them to unlock it, then try again.</p>
        {#snippet actions()}
            <Button variant="primary" icon="refresh" busy={checking} busyLabel="Checking…" onclick={retry}>Try again</Button>
        {/snippet}
    </Notice>
{/if}

<style>
    .early {
        display: grid;
        gap: var(--s-5);
        justify-items: center;
    }

    .buttons {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: var(--s-3);
    }
</style>

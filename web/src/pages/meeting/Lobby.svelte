<script lang="ts">
    /** Placeholder until the meeting room lands (#5): the meeting is open and you could join. */
    import Button from '../../lib/ui/Button.svelte'
    import Notice from '../../lib/ui/Notice.svelte'
    import { format } from '../../lib/code'
    import type { Meeting } from '../../lib/types'

    let { meeting, hostKey }: { meeting: Meeting, hostKey: string | null } = $props()
</script>

<Notice mood="empty" title={meeting.title ?? `Meeting ${format(meeting.code)}`}>
    <p>{hostKey ? "You're the host." : 'The meeting is open.'} The lobby and the room arrive with the next change (#5).</p>
    {#snippet actions()}
        <Button variant="secondary" href="/" icon="arrowLeft">Back to start</Button>
    {/snippet}
</Notice>

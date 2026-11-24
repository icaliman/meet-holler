<script lang="ts">
    import Button from '../ui/Button.svelte'
    import CopyField from '../ui/CopyField.svelte'
    import Toggle from '../ui/Toggle.svelte'
    import { meetingUrl } from '../code'
    import { initials, seatColour } from './layout'
    import type { RoomLike } from './types'

    let { room }: { room: RoomLike } = $props()

    let locked = $state(false)
    let waitingRoom = $state(false)
    $effect(() => {
        locked = room.meeting?.locked ?? false
        waitingRoom = room.meeting?.waitingRoom ?? false
    })

    const since = (iso: string) => {
        const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))

        return s < 60 ? 'just now' : `${Math.round(s / 60)} min`
    }
</script>

<section class="invite" aria-labelledby="invite-title">
    <h3 id="invite-title">Invite people</h3>
    {#if room.meeting?.locked}
        <p class="note">The meeting is locked, so nobody new can come in.</p>
    {:else}
        <CopyField id="panel-link" label="Meeting link" value={meetingUrl(room.code)} />
        <p class="note">Up to four people in total. {4 - room.people.length > 0 ? `${4 - room.people.length} seat${4 - room.people.length === 1 ? '' : 's'} free.` : 'The meeting is full.'}</p>
    {/if}
</section>

{#if room.isHost && room.waiting.length}
    <section aria-labelledby="waiting-title">
        <h3 id="waiting-title">Waiting to join <span class="count">{room.waiting.length}</span></h3>
        <ul class="list">
            {#each room.waiting as guest (guest.id)}
                <li class="row">
                    <span class="avatar waiting" aria-hidden="true">{initials(guest.name)}</span>
                    <span class="who"><strong>{guest.name}</strong><small>waiting {since(guest.since)}</small></span>
                    <span class="actions">
                        <Button size="sm" variant="ghost" onclick={() => room.deny(guest.id)} aria-label="Deny {guest.name}">Deny</Button>
                        <Button size="sm" variant="primary" onclick={() => room.admit(guest.id)} aria-label="Admit {guest.name}">Admit</Button>
                    </span>
                </li>
            {/each}
        </ul>
    </section>
{/if}

<section aria-labelledby="in-title">
    <h3 id="in-title">In the meeting <span class="count">{room.people.length}</span></h3>
    <ul class="list">
        {#each room.people as person (person.id)}
            <li class="row">
                <span class="avatar seat-{seatColour(person.seat)}" aria-hidden="true">{initials(person.name)}</span>
                <span class="who">
                    <strong>{person.name}{person.me ? ' (you)' : ''}</strong>
                    <small>
                        {[person.me && room.isHost ? 'Host' : null, person.muted ? 'Muted' : null, person.sharing ? 'Sharing screen' : null, person.quality === 'poor' ? 'Weak connection' : null].filter(Boolean).join(' · ') || ' '}
                    </small>
                </span>
                {#if room.isHost && ! person.me}
                    <Button size="sm" variant="ghost" onclick={() => room.remove(person.id)} aria-label="Remove {person.name} from the meeting">Remove</Button>
                {/if}
            </li>
        {/each}
    </ul>
</section>

{#if room.isHost}
    <section class="host" aria-labelledby="host-title">
        <h3 id="host-title">Host controls</h3>
        <Toggle id="host-lock" label="Lock the meeting" description="Nobody new can join, even with the link." bind:checked={locked} onchange={(on) => room.setLocked(on)} />
        <Toggle id="host-waiting" label="Waiting room" description="You let each guest in yourself." bind:checked={waitingRoom} onchange={(on) => room.setWaitingRoom(on)} />
    </section>
{/if}

<style>
    section {
        display: grid;
        gap: var(--s-3);
    }

    h3 {
        font-size: 1rem;
        font-family: var(--font-text);
        font-weight: 700;
        letter-spacing: 0;
        display: flex;
        align-items: center;
        gap: var(--s-2);
    }

    .count {
        display: inline-grid;
        place-items: center;
        min-width: 24px;
        height: 24px;
        padding: 0 6px;
        border-radius: var(--r-pill);
        background: var(--sunken);
        font-size: var(--text-sm);
    }

    .note {
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--s-1);
    }

    .row {
        display: flex;
        align-items: center;
        gap: var(--s-3);
        min-height: 52px;
    }

    .avatar {
        flex: none;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--seat-0);
        color: #12110D;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 0.8125rem;
    }

    .avatar.seat-1 { background: var(--seat-1); }
    .avatar.seat-2 { background: var(--seat-2); }
    .avatar.seat-3 { background: var(--seat-3); }

    .avatar.waiting {
        background: transparent;
        color: var(--ink);
        border: 2px dashed var(--line-strong);
    }

    .who {
        flex: 1;
        min-width: 0;
        display: grid;
    }

    .who strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .who small {
        color: var(--ink-muted);
        font-size: 0.8125rem;
        min-height: 1em;
    }

    .actions {
        display: flex;
        gap: var(--s-1);
    }

    .host {
        border-top: 1px solid var(--line);
        padding-top: var(--s-4);
        gap: var(--s-4);
    }
</style>

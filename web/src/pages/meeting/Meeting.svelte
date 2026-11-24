<script lang="ts">
    import { onDestroy } from 'svelte'
    import Button from '../../lib/ui/Button.svelte'
    import Notice from '../../lib/ui/Notice.svelte'
    import Gate from './Gate.svelte'
    import Lobby from './Lobby.svelte'
    import Waiting from './Waiting.svelte'
    import RoomView from '../../lib/room/RoomView.svelte'
    import { Room } from '../../lib/room/room.svelte'
    import { Preview } from '../../lib/room/preview.svelte'
    import { api, ApiError } from '../../lib/api'
    import { gate } from '../../lib/gate'
    import { next, rejoinBudget, type FlowEvent, type Phase } from '../../lib/flow'
    import { explain } from '../../lib/messages'
    import { forgetHostKey, hostKeyFor, rememberHostKey, rememberName, savedName, takeHostFragment } from '../../lib/storage'
    import { forgetSession, rememberSession, sessionFor, type Session } from '../../lib/session'
    import { clearToasts, toast } from '../../lib/ui/toast-store.svelte'
    import { announce } from '../../lib/ui/announce.svelte'
    import type { Meeting } from '../../lib/types'

    let { code }: { code: string } = $props()

    // The page is remounted per route (App keys it on the path), so the code never changes here.
    // A host link's key is a claim until the Worker has checked it (lookUp below): not stored yet.
    let offeredKey = takeHostFragment()
    // svelte-ignore state_referenced_locally
    let hostKey = $state(hostKeyFor(code))
    /** The last token this tab had: someone who was in may still ask about a private meeting. */
    let lastToken: string | null = null
    // svelte-ignore state_referenced_locally
    let session = $state<Session | null>(sessionFor(code))

    let meeting = $state<Meeting | null>(null)
    let failure = $state<ApiError | Error | null>(null)
    let loading = $state(true)
    // A tab that was already in (a reload) goes straight back in.
    // svelte-ignore state_referenced_locally
    let phase = $state<Phase>(session ? { name: 'joining' } : { name: 'lobby' })
    let name = $state(savedName())
    let passcode = $state('')
    let room = $state.raw<Room | null>(null)
    const preview = new Preview()
    const mayRejoin = rejoinBudget()

    function send(event: FlowEvent) {
        phase = next(phase, event)
    }

    const refused = (error: unknown) => error instanceof ApiError && error.code === 'forbidden'

    /**
     * The meeting, asked as whoever this browser can show it is. A key from a host link is
     * kept only if the Worker accepts it, and a stored key the Worker refuses is forgotten:
     * either way a wrong key never stands between someone and the meeting.
     */
    async function lookUp(): Promise<Meeting> {
        if (offeredKey) {
            const key = offeredKey
            try {
                const found = await api.getMeeting(code, { hostKey: key })
                offeredKey = null
                rememberHostKey(code, key)
                hostKey = key

                return found
            } catch (error) {
                if (! refused(error)) throw error
                offeredKey = null
                toast("That host link isn't for this meeting. You can still join as a guest.", { tone: 'error', timeout: 7000 })
            }
        }
        if (hostKey) {
            try {
                return await api.getMeeting(code, { hostKey })
            } catch (error) {
                if (! refused(error)) throw error
                forgetHostKey(code)
                hostKey = null
            }
        }

        return api.getMeeting(code, session?.token ?? lastToken ?? undefined)
    }

    async function load() {
        try {
            meeting = await lookUp()
            failure = null
        } catch (error) {
            failure = error as Error
        } finally {
            loading = false
        }
    }

    $effect(() => {
        load().then(() => {
            if (session && meeting && meeting.status !== 'ended') resume()
            else if (session) {
                forgetSession(code)
                session = null
                phase = { name: 'lobby' }
            }
        })
    })

    /** Back after a reload: the token in sessionStorage still names me. */
    async function resume() {
        try {
            const me = await api.me(code, session!.token)
            meeting = me.meeting
            if (me.participant.state === 'admitted') await enterRoom()
            else if (me.participant.state === 'waiting') phase = { name: 'waiting' }
            else throw new Error('Not in the meeting any more.')
        } catch {
            forgetSession(code)
            session = null
            phase = { name: 'lobby' }
        }
    }

    async function join() {
        if (phase.name === 'joining' && session) return
        send({ type: 'join' })
        try {
            const result = await api.join(code, { name: name.trim(), passcode: passcode.trim() || undefined, hostKey: hostKey ?? undefined })
            session = { token: result.token, participant: result.participant }
            rememberSession(code, session)
            rememberName(name)
            if (result.meeting) meeting = result.meeting
            if (result.participant.state === 'admitted') await enterRoom()
            else send({ type: 'joined', state: result.participant.state })
        } catch (error) {
            send({ type: 'join_failed', code: error instanceof ApiError ? error.code : 'network' })
        }
    }

    async function enterRoom() {
        if (! session) return
        await preview.ensure()
        room?.destroy()
        const live = new Room({
            code,
            token: session.token,
            me: session.participant,
            stream: preview.handOver(),
            muted: preview.muted,
            cameraOff: preview.cameraOff,
            devices: preview.devices,
            // Only the room on screen decides what happens next; an old one ending late is ignored.
            onEnded: (reason, othersAlive) => { if (room === live) callEnded(reason, othersAlive) },
        })
        room = live
        phase = { name: 'room' }
        live.start()
        announce("You're in the meeting.")
    }

    let holding = $state(false)

    function callEnded(reason: string, othersAlive: boolean) {
        room?.destroy()
        room = null
        send({ type: 'call_ended', reason, canRejoin: mayRejoin() })
        lastToken = session?.token ?? lastToken
        forgetSession(code)
        session = null
        if (phase.name === 'joining') {
            // Holler let go of a call that is still on (docs/api.md, "Holler and a lone participant"): back in, quietly.
            if (othersAlive) {
                phase = { name: 'lobby' }
                join()
            } else {
                holdSeat()
            }
        } else {
            clearToasts()
            preview.stop()
        }
    }

    /**
     * Everyone else went quiet (closed their tabs): rejoining at once would wait for them all
     * over again. The server drops quiet people after 45 s, so wait until it has, then come
     * back in alone, to an empty room with the invite link.
     */
    async function holdSeat() {
        if (holding) return
        holding = true
        const until = Date.now() + 60_000
        while (Date.now() < until) {
            await new Promise((resolve) => setTimeout(resolve, 5000))
            try {
                meeting = await lookUp()
                if (meeting.status === 'ended') {
                    holding = false
                    phase = { name: 'ended' }
                    return
                }
                if (meeting.participantCount === 0) break
            } catch {
                // Try again on the next round.
            }
        }
        holding = false
        phase = { name: 'lobby' }
        join()
    }

    async function leave(forEveryone = false) {
        const current = room
        send({ type: 'leave' })
        room = null
        if (current) await (forEveryone ? current.endForAll() : current.leave())
        forgetSession(code)
        session = null
        preview.stop()
        clearToasts()
        if (forEveryone) phase = { name: 'ended' }
    }

    function backToLobby() {
        phase = { name: 'lobby' }
        load()
    }

    // A guest in the waiting room asks every 4 seconds whether they are in.
    $effect(() => {
        if (phase.name !== 'waiting' || ! session) return
        const token = session.token
        const timer = setInterval(async () => {
            try {
                const me = await api.me(code, token)
                meeting = me.meeting
                if (me.meeting.status === 'ended') {
                    send({ type: 'meeting_ended' })
                } else if (me.participant.state === 'admitted') {
                    toast("You're in. The host let you join.", { tone: 'success', timeout: 3000 })
                    await enterRoom()
                } else if (me.participant.state !== 'waiting') {
                    send({ type: 'me', state: me.participant.state })
                }
            } catch {
                // A missed check; the next one tries again.
            }
        }, 4000)

        return () => clearInterval(timer)
    })

    $effect(() => {
        if (['denied', 'removed', 'ended', 'failed', 'dropped', 'left'].includes(phase.name)) preview.stop()
    })

    onDestroy(() => {
        room?.destroy()
        preview.stop()
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
{:else if holding}
    <Notice mood="empty" title="Everyone else has left" live>
        <p>We're keeping your seat. You'll be back in the meeting in a moment, ready for whoever joins next.</p>
        {#snippet actions()}
            <Button variant="secondary" href="/" icon="arrowLeft">Back to start</Button>
        {/snippet}
    </Notice>
{:else if phase.name === 'room' && room}
    <RoomView {room} title={meeting?.title ?? null} onleave={(all) => leave(all)} />
{:else if phase.name === 'waiting'}
    <Waiting {name} hostName={meeting?.hostName ?? null} {preview} onleave={() => leave()} />
{:else if phase.name === 'denied'}
    <Notice mood="denied" title="The host didn't let you in" live>
        <p>Maybe it's a private meeting, or not the right time. Check with whoever invited you.</p>
        {#snippet actions()}
            <Button variant="secondary" href="/" icon="arrowLeft">Back to start</Button>
        {/snippet}
    </Notice>
{:else if phase.name === 'removed'}
    <Notice mood="left" title="You were removed from the meeting" live>
        <p>The host took you out of this meeting.</p>
        {#snippet actions()}
            <Button variant="secondary" href="/" icon="arrowLeft">Back to start</Button>
        {/snippet}
    </Notice>
{:else if phase.name === 'ended'}
    <Notice mood="ended" title="This meeting has ended" live>
        <p>Thanks for coming.</p>
        {#snippet actions()}
            <Button variant="primary" href="/" icon="bolt">Start a new meeting</Button>
        {/snippet}
    </Notice>
{:else if phase.name === 'left'}
    <Notice mood="left" title="You left the meeting" live>
        <p>It goes on for the others. You can come back while it's open.</p>
        {#snippet actions()}
            <Button variant="primary" icon="refresh" onclick={backToLobby}>Rejoin</Button>
            <Button variant="secondary" href="/" icon="arrowLeft">Back to start</Button>
        {/snippet}
    </Notice>
{:else if phase.name === 'failed'}
    <Notice mood="blocked" title="We couldn't connect you" live>
        <p>Your browser and the others' couldn't reach each other. This happens on some office networks and VPNs.</p>
        <p>Try another network (a phone hotspot works), or turn the VPN off, then rejoin.</p>
        {#snippet actions()}
            <Button variant="primary" icon="refresh" onclick={backToLobby}>Rejoin</Button>
        {/snippet}
    </Notice>
{:else if phase.name === 'dropped'}
    <Notice mood="left" title="You lost the connection" live>
        <p>The meeting may still be going. Check your internet connection, then rejoin.</p>
        {#snippet actions()}
            <Button variant="primary" icon="refresh" onclick={backToLobby}>Rejoin</Button>
        {/snippet}
    </Notice>
{:else if meeting && view && view !== 'lobby' && phase.name === 'lobby'}
    <Gate {meeting} kind={view} onretry={load} />
{:else if meeting}
    <Lobby
        {meeting}
        isHost={Boolean(hostKey)}
        {preview}
        bind:name
        bind:passcode
        error={phase.name === 'lobby' ? (phase.error ?? null) : null}
        busy={phase.name === 'joining'}
        onjoin={join}
    />
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

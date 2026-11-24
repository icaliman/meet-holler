<script lang="ts">
    import { onDestroy } from 'svelte'
    import ControlBar from './ControlBar.svelte'
    import DevicePicker from './DevicePicker.svelte'
    import EmptySeat from './EmptySeat.svelte'
    import PeoplePanel from './PeoplePanel.svelte'
    import Sheet from './Sheet.svelte'
    import Tile from './Tile.svelte'
    import Mark from '../ui/Mark.svelte'
    import Icon from '../ui/Icon.svelte'
    import { toast, toasts } from '../ui/toast-store.svelte'
    import { format } from '../code'
    import { copyText } from '../clipboard'
    import { meetingUrl } from '../code'
    import { layout } from './layout'
    import type { RoomLike } from './types'

    let { room, title = null, onleave }: { room: RoomLike, title?: string | null, onleave: (forEveryone: boolean) => void } = $props()

    let panel = $state<'people' | 'settings' | null>(null)
    let stageWidth = $state(1280)
    let stageHeight = $state(720)

    const sharer = $derived(room.people.find((p) => p.sharing) ?? null)
    const others = $derived(room.people.filter((p) => ! p.me))
    const shape = $derived(layout(room.people.length, stageWidth / Math.max(1, stageHeight), Boolean(sharer)))
    const strip = $derived(sharer ? room.people.filter((p) => p.id !== sharer.id) : [])
    const stripSide = $derived(stageWidth / Math.max(1, stageHeight) >= 1.2 ? 'right' : 'bottom')
    const meetingTitle = $derived(room.meeting?.title ?? title ?? null)

    const status = $derived.by(() => {
        if (room.state === 'reconnecting' && others.length && others.every((p) => ! p.alive)) {
            return { tone: 'info', text: others.length === 1 ? `${others[0].name} lost their connection. Waiting for them…` : 'The others lost their connection. Waiting for them…' }
        }
        if (room.state === 'reconnecting') return { tone: 'warn', text: 'Connection lost. Trying to get you back…' }
        if (room.state === 'connecting' && others.length && ! others.some((p) => p.connected)) {
            return { tone: 'info', text: others.length === 1 ? `Connecting to ${others[0].name}…` : 'Connecting to everyone…' }
        }

        return null
    })

    // How long I have been in: a quiet clock in the corner.
    const startedAt = Date.now()
    let now = $state(Date.now())
    const clock = setInterval(() => (now = Date.now()), 1000)
    toasts.placement = 'stage'
    onDestroy(() => {
        clearInterval(clock)
        toasts.placement = 'page'
    })
    const elapsed = $derived.by(() => {
        const s = Math.floor((now - startedAt) / 1000)
        const h = Math.floor(s / 3600)
        const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
        const ss = String(s % 60).padStart(2, '0')

        return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
    })

    async function copyInvite() {
        if (await copyText(meetingUrl(room.code))) toast('Meeting link copied. Paste it to whoever you are meeting.', { tone: 'success', timeout: 3000 })
    }

    function onKey(event: KeyboardEvent) {
        if (event.metaKey || event.ctrlKey || event.altKey) return
        const target = event.target as HTMLElement | null
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
        const key = event.key.toLowerCase()
        if (key === 'm' && room.hasMicrophone) room.toggleMic()
        else if (key === 'v' && room.hasCamera) room.toggleCamera()
        else if (key === 's' && room.canShare) room.toggleShare()
        else if (key === '?') toast('Shortcuts: M microphone, V camera, S share screen.', { timeout: 6000 })
        else return
        event.preventDefault()
    }
</script>

<svelte:window onkeydown={onKey} />

<div class="room stage-palette" class:with-panel={panel !== null}>
    <header class="top">
        <div class="where">
            <Mark size={30} seats={room.people.length} />
            <div class="meta">
                <h1 id="page-title" tabindex="-1">{meetingTitle ?? 'Meeting'}</h1>
                <p>
                    <span class="code">{format(room.code)}</span>
                    <span aria-hidden="true">·</span>
                    <span aria-label="Time in the meeting">{elapsed}</span>
                    {#if room.meeting?.locked}
                        <span class="chip"><Icon name="lock" size={14} /> Locked</span>
                    {/if}
                </p>
            </div>
        </div>
        <button type="button" class="invite" onclick={copyInvite}>
            <Icon name="link" size={18} />
            <span>Copy invite link</span>
        </button>
    </header>

    {#if status}
        <div class="status {status.tone}" role="status">
            <span class="pulse" aria-hidden="true"></span>
            {status.text}
        </div>
    {/if}

    <main class="body">
        <section
            class="stage {shape.mode} strip-{stripSide}"
            aria-label="People in the meeting"
            bind:clientWidth={stageWidth}
            bind:clientHeight={stageHeight}
        >
            {#if sharer}
                <div class="spot">
                    <Tile person={sharer} voice={room.voices.get(sharer.me ? 'me' : sharer.id)} speaker={room.speaker} stage />
                </div>
                {#if strip.length}
                    <div class="strip">
                        {#each strip as person (person.id)}
                            <Tile {person} voice={room.voices.get(person.me ? 'me' : person.id)} speaker={room.speaker} compact onremove={room.isHost ? () => room.remove(person.id) : null} />
                        {/each}
                    </div>
                {/if}
            {:else}
                <div class="grid" style:--cols={shape.cols} style:--rows={shape.rows}>
                    {#each room.people as person (person.id)}
                        <Tile {person} voice={room.voices.get(person.me ? 'me' : person.id)} speaker={room.speaker} onremove={room.isHost ? () => room.remove(person.id) : null} />
                    {/each}
                    {#each Array(shape.emptySeats) as _, i (i)}
                        <EmptySeat code={room.code} alone={room.people.length === 1} locked={room.meeting?.locked ?? false} />
                    {/each}
                </div>
            {/if}
        </section>

        {#if panel === 'people'}
            <div class="side">
                <Sheet title="People" onclose={() => (panel = null)}>
                    <PeoplePanel {room} />
                </Sheet>
            </div>
        {:else if panel === 'settings'}
            <div class="side">
                <Sheet title="Settings" onclose={() => (panel = null)}>
                    <DevicePicker idPrefix="room" load={() => room.devices()} choose={(kind, id) => room.setDevice(kind, id)} />
                    <p class="tip">Shortcuts: <kbd>M</kbd> microphone, <kbd>V</kbd> camera, <kbd>S</kbd> share screen.</p>
                </Sheet>
            </div>
        {/if}
    </main>

    <footer class="controls">
        <ControlBar {room} {panel} onpanel={(p) => (panel = p)} {onleave} />
    </footer>
</div>

<style>
    .room {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        grid-template-areas: "top" "status" "body" "controls";
        background: var(--stage);
        color: var(--ink);
        padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    }

    .top {
        grid-area: top;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s-3);
        padding: var(--s-3) var(--s-4);
    }

    .where {
        display: flex;
        align-items: center;
        gap: var(--s-3);
        min-width: 0;
    }

    .meta {
        min-width: 0;
    }

    h1 {
        font-size: 1.0625rem;
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    h1:focus {
        outline: none;
    }

    .meta p {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--text-sm);
        color: var(--ink-muted);
        font-variant-numeric: tabular-nums;
    }

    .code {
        font-family: var(--font-mono);
        letter-spacing: 0.04em;
    }

    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 8px;
        border-radius: var(--r-pill);
        background: var(--seat-3);
        color: #12110D;
        font-weight: 700;
        font-size: 0.75rem;
    }

    .invite {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 44px;
        padding: 0 var(--s-4);
        border-radius: var(--r-pill);
        border: 1.5px solid var(--line-strong);
        background: transparent;
        color: var(--ink);
        font-weight: 700;
        cursor: pointer;
    }

    .invite:hover {
        background: var(--surface);
    }

    .status {
        grid-area: status;
        justify-self: center;
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        margin: 0 var(--s-4) var(--s-2);
        padding: var(--s-2) var(--s-4);
        border-radius: var(--r-pill);
        background: var(--surface);
        font-weight: 700;
        font-size: var(--text-sm);
    }

    .status.warn {
        background: var(--seat-3);
        color: #12110D;
    }

    .pulse {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--volt);
        animation: pulse 1.2s var(--ease-out) infinite;
    }

    .warn .pulse {
        background: #12110D;
    }

    .body {
        grid-area: body;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--s-3);
        min-height: 0;
        padding: 0 var(--s-4);
    }

    .with-panel .body {
        grid-template-columns: minmax(0, 1fr) 360px;
    }

    .stage {
        position: relative;
        min-height: 0;
        min-width: 0;
        display: grid;
    }

    .grid {
        display: grid;
        grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
        grid-template-rows: repeat(var(--rows), minmax(0, 1fr));
        gap: var(--s-3);
        min-height: 0;
    }

    .stage.spotlight {
        gap: var(--s-3);
    }

    .strip-right.spotlight {
        grid-template-columns: minmax(0, 1fr) clamp(140px, 18vw, 240px);
    }

    .strip-bottom.spotlight {
        grid-template-rows: minmax(0, 1fr) 112px;
    }

    .spot {
        display: grid;
        min-height: 0;
        min-width: 0;
    }

    .strip {
        display: grid;
        gap: var(--s-2);
        min-height: 0;
        min-width: 0;
    }

    .strip-right .strip {
        grid-auto-rows: minmax(0, 150px);
        align-content: start;
    }

    .strip-bottom .strip {
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 150px);
        justify-content: center;
    }

    .side {
        display: grid;
        min-height: 0;
    }

    .controls {
        grid-area: controls;
        align-items: flex-end;
        display: flex;
        justify-content: center;
        padding: var(--s-3) var(--s-4) var(--s-4);
    }

    .tip {
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    kbd {
        display: inline-block;
        min-width: 22px;
        padding: 0 6px;
        border-radius: 6px;
        border: 1px solid var(--line-strong);
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        text-align: center;
    }

    /* Below 1024 px the panel covers the bottom of the stage instead of taking a column. */
    @media (max-width: 1023px) {
        .with-panel .body {
            grid-template-columns: minmax(0, 1fr);
        }

        .side {
            position: absolute;
            left: var(--s-3);
            right: var(--s-3);
            bottom: calc(96px + env(safe-area-inset-bottom));
            max-height: min(70dvh, 560px);
            z-index: 30;
        }

        .side :global(.sheet) {
            box-shadow: var(--shadow-float);
        }
    }

    @media (min-width: 640px) and (max-width: 1023px) {
        .side {
            left: auto;
            width: 380px;
        }
    }

    @media (max-width: 639px) {
        .top {
            padding: var(--s-2) var(--s-3);
        }

        .invite span {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
        }

        .invite {
            width: 44px;
            padding: 0;
            justify-content: center;
        }

        .body {
            padding: 0 var(--s-2);
        }

        .grid {
            gap: var(--s-2);
        }

        .controls {
            padding: var(--s-2) var(--s-2) var(--s-3);
        }
    }

    @keyframes pulse {
        0%, 100% { opacity: 0.35; }
        50% { opacity: 1; }
    }
</style>

<script lang="ts">
    /** Before joining: see yourself, check the microphone, pick devices, say your name. */
    import { onDestroy } from 'svelte'
    import Button from '../../lib/ui/Button.svelte'
    import Field from '../../lib/ui/Field.svelte'
    import Icon from '../../lib/ui/Icon.svelte'
    import DevicePicker from '../../lib/room/DevicePicker.svelte'
    import VideoEl from '../../lib/room/VideoEl.svelte'
    import { LevelMeter, type Voice } from '../../lib/room/levels'
    import { explainProblem } from '../../lib/room/media'
    import type { Preview } from '../../lib/room/preview.svelte'
    import { initials } from '../../lib/room/layout'
    import { format } from '../../lib/code'
    import { ApiError } from '../../lib/api'
    import { explain } from '../../lib/messages'
    import type { ErrorCode, Meeting } from '../../lib/types'

    let {
        meeting,
        isHost,
        preview,
        name = $bindable(''),
        passcode = $bindable(''),
        error = null,
        busy = false,
        onjoin,
    }: {
        meeting: Meeting
        isHost: boolean
        preview: Preview
        name?: string
        passcode?: string
        error?: ErrorCode | null
        busy?: boolean
        onjoin: () => void
    } = $props()

    let nameError = $state<string | null>(null)
    let voice = $state<Voice | null>(null)
    const meter = new LevelMeter((voices) => { voice = voices.get('me') ?? null })
    onDestroy(() => meter.destroy())

    $effect(() => {
        if (! preview.live && ! preview.asking && ! preview.camera && ! preview.microphone) preview.open()
    })

    $effect(() => {
        meter.watch('me', preview.stream)
    })

    const hasVideo = $derived(Boolean(preview.stream?.getVideoTracks().length) && ! preview.cameraOff)
    const needsPasscode = $derived(meeting.requiresPasscode && ! isHost)
    const passcodeError = $derived(error === 'passcode_required' || error === 'passcode_wrong' ? explain(new ApiError(error, '')) : null)
    const otherError = $derived(error && ! passcodeError ? explain(new ApiError(error, '')) : null)
    const early = $derived(meeting.status === 'scheduled')

    const problem = $derived.by(() => {
        const { camera, microphone } = preview
        if (camera && microphone && camera === microphone) return explainProblem(camera, 'camera and microphone')
        if (camera && microphone) return `${explainProblem(microphone, 'microphone')} ${explainProblem(camera, 'camera')}`
        if (microphone) return explainProblem(microphone, 'microphone')
        if (camera) return explainProblem(camera, 'camera')

        return null
    })

    const whoIsIn = $derived.by(() => {
        const n = meeting.participantCount
        const host = meeting.hostName ? `Hosted by ${meeting.hostName}. ` : ''
        // A private meeting says who is in only after the passcode.
        if (n === null) return 'Private meeting.'
        if (n === 0) return `${host}Nobody is in yet.`
        if (n === 1) return `${host}One person is in.`

        return `${host}${n} people are in. ${4 - n} seat${4 - n === 1 ? '' : 's'} left.`
    })

    function submit(event: SubmitEvent) {
        event.preventDefault()
        nameError = name.trim() ? null : 'Tell the others who you are. A first name is enough.'
        if (nameError) {
            document.getElementById('lobby-name')?.focus()
            return
        }
        onjoin()
    }
</script>

<div class="lobby">
    <section class="preview-col" aria-label="Your camera and microphone">
        <div class="preview" class:off={! hasVideo}>
            {#if hasVideo}
                <VideoEl stream={preview.stream} muted mirror label="Your camera preview" />
            {:else}
                <div class="avatar" aria-hidden="true"><span>{initials(name || '?')}</span></div>
                <p class="camera-note">
                    {#if preview.asking}Asking for your camera…{:else if preview.cameraOff}Your camera is off{:else}No camera{/if}
                </p>
            {/if}

            <div class="overlay">
                <button
                    type="button"
                    class="round"
                    class:off={preview.muted || ! preview.stream?.getAudioTracks().length}
                    aria-label={preview.muted ? 'Turn microphone on' : 'Turn microphone off'}
                    aria-pressed={! preview.muted}
                    disabled={! preview.stream?.getAudioTracks().length}
                    onclick={() => preview.toggleMic()}
                >
                    <Icon name={preview.muted ? 'micOff' : 'mic'} size={22} />
                </button>
                <button
                    type="button"
                    class="round"
                    class:off={preview.cameraOff || ! preview.stream?.getVideoTracks().length}
                    aria-label={preview.cameraOff ? 'Turn camera on' : 'Turn camera off'}
                    aria-pressed={! preview.cameraOff}
                    disabled={! preview.stream?.getVideoTracks().length}
                    onclick={() => preview.toggleCamera()}
                >
                    <Icon name={preview.cameraOff ? 'cameraOff' : 'camera'} size={22} />
                </button>
            </div>

            {#if preview.stream?.getAudioTracks().length && ! preview.muted}
                <div class="level" aria-hidden="true" title="Microphone level">
                    {#each [0, 1, 2, 3, 4, 5, 6, 7] as i}
                        <i class:lit={(voice?.level ?? 0) * 12 > i}></i>
                    {/each}
                </div>
            {/if}
        </div>

        {#if problem}
            <div class="problem" role="alert">
                <Icon name="alert" size={20} />
                <div>
                    <p>{problem}</p>
                    <Button size="sm" variant="secondary" icon="refresh" busy={preview.asking} busyLabel="Asking…" onclick={() => preview.open()}>Try again</Button>
                </div>
            </div>
        {/if}

        <details class="devices">
            <summary><Icon name="settings" size={18} /> Check your devices</summary>
            <DevicePicker idPrefix="lobby" load={() => preview.list()} choose={(kind, id) => preview.choose(kind, id)} />
        </details>
    </section>

    <form class="join" onsubmit={submit} novalidate aria-labelledby="page-title">
        <div class="head">
            <p class="eyebrow">{early && isHost ? "You're early, and you're the host" : isHost ? "You're the host" : 'Ready to join?'}</p>
            <h1 id="page-title" tabindex="-1">{meeting.title ?? (isHost ? 'Your meeting' : 'Join the meeting')}</h1>
            <p class="sub"><span class="code">{format(meeting.code)}</span> · {whoIsIn}</p>
        </div>

        <Field label="Your name" id="lobby-name" error={nameError} hint="Shown to everyone in the meeting.">
            {#snippet children({ id, describedby, invalid })}
                <input {id} class="input" type="text" maxlength="40" autocomplete="name" bind:value={name} aria-describedby={describedby} aria-invalid={invalid} oninput={() => (nameError = null)} />
            {/snippet}
        </Field>

        {#if needsPasscode}
            <Field label="Passcode" id="lobby-passcode" error={passcodeError} hint={passcodeError ? null : 'This meeting is private. The host gave you a passcode with the link.'}>
                {#snippet children({ id, describedby, invalid })}
                    <input {id} class="input pass" type="text" autocomplete="off" spellcheck="false" bind:value={passcode} aria-describedby={describedby} aria-invalid={invalid} />
                {/snippet}
            </Field>
        {/if}

        {#if meeting.waitingRoom && ! isHost}
            <p class="note"><Icon name="door" size={18} /> The host lets each guest in. You'll wait a moment after joining.</p>
        {/if}

        {#if otherError}
            <p class="failure" role="alert">{otherError}</p>
        {/if}

        <Button type="submit" variant="primary" size="lg" icon="arrowRight" {busy} busyLabel="Joining…" wide>
            {early && isHost ? 'Open the meeting' : 'Join now'}
        </Button>
        {#if ! preview.stream && ! preview.asking}
            <p class="note">You'll join without camera and microphone. You can still see and hear the others.</p>
        {/if}
    </form>
</div>

<style>
    .lobby {
        display: grid;
        gap: var(--s-6);
        padding-block: var(--s-5) var(--s-8);
        align-items: start;
    }

    @media (min-width: 900px) {
        .lobby {
            grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
            gap: var(--s-7);
            padding-top: var(--s-6);
        }
    }

    .preview-col {
        display: grid;
        gap: var(--s-4);
        min-width: 0;
    }

    .preview {
        position: relative;
        aspect-ratio: 16 / 10;
        border-radius: var(--r-lg);
        background: #1F1C17;
        overflow: hidden;
        border: 2px solid var(--ink);
        box-shadow: var(--lift);
    }

    .avatar {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: #2A3015;
    }

    .avatar span {
        display: grid;
        place-items: center;
        width: 96px;
        height: 96px;
        border-radius: 50%;
        background: var(--seat-0);
        color: #12110D;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 2rem;
    }

    .camera-note {
        position: absolute;
        top: var(--s-4);
        left: 0;
        right: 0;
        text-align: center;
        color: #F4EFE4;
        font-weight: 700;
        font-size: var(--text-sm);
    }

    .overlay {
        position: absolute;
        left: 0;
        right: 0;
        bottom: var(--s-4);
        display: flex;
        justify-content: center;
        gap: var(--s-3);
        z-index: 2;
    }

    .round {
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        border: 0;
        background: rgb(11 10 8 / 0.7);
        color: #F4EFE4;
        cursor: pointer;
        backdrop-filter: blur(6px);
    }

    .round.off {
        background: #F4EFE4;
        color: #12110D;
    }

    .round:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .round:focus-visible {
        outline-color: var(--volt);
    }

    .level {
        position: absolute;
        top: var(--s-3);
        right: var(--s-3);
        display: flex;
        align-items: flex-end;
        gap: 3px;
        padding: 6px 8px;
        border-radius: var(--r-pill);
        background: rgb(11 10 8 / 0.7);
    }

    .level i {
        width: 4px;
        height: 12px;
        border-radius: 2px;
        background: rgb(244 239 228 / 0.25);
    }

    .level i.lit {
        background: var(--volt);
    }

    .problem {
        display: flex;
        gap: var(--s-3);
        padding: var(--s-4);
        border-radius: var(--r-md);
        background: var(--surface);
        border: 2px solid var(--danger);
    }

    .problem :global(svg) {
        color: var(--danger);
        margin-top: 2px;
    }

    .problem div {
        display: grid;
        gap: var(--s-3);
        justify-items: start;
    }

    .devices {
        border-radius: var(--r-md);
        border: 2px solid var(--line);
        padding: 0 var(--s-4);
        background: var(--surface);
    }

    .devices[open] {
        padding-bottom: var(--s-4);
    }

    .devices summary {
        display: flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 52px;
        font-weight: 700;
        cursor: pointer;
        list-style: none;
    }

    .devices summary::-webkit-details-marker {
        display: none;
    }

    .join {
        display: grid;
        gap: var(--s-5);
        min-width: 0;
    }

    .head {
        display: grid;
        gap: var(--s-2);
    }

    .eyebrow {
        font-weight: 700;
        color: var(--volt-text);
        font-size: var(--text-sm);
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }

    h1 {
        font-size: var(--text-xl);
        overflow-wrap: anywhere;
    }

    h1:focus {
        outline: none;
    }

    .sub {
        color: var(--ink-muted);
    }

    .code {
        font-family: var(--font-mono);
        letter-spacing: 0.04em;
    }

    .pass {
        font-family: var(--font-mono);
        letter-spacing: 0.08em;
    }

    .note {
        display: flex;
        gap: var(--s-2);
        align-items: flex-start;
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .note :global(svg) {
        flex: none;
        margin-top: 1px;
    }

    .failure {
        padding: var(--s-3) var(--s-4);
        border-radius: var(--r-sm);
        background: color-mix(in srgb, var(--danger) 12%, transparent);
        color: var(--danger);
        font-weight: 700;
    }
</style>

<script lang="ts">
    let {
        stream,
        muted = false,
        mirror = false,
        fit = 'cover',
        sinkId = null,
        audioOnly = false,
        label,
    }: {
        stream: MediaStream | null
        /** My own picture is always muted, so I do not hear myself. */
        muted?: boolean
        mirror?: boolean
        fit?: 'cover' | 'contain'
        sinkId?: string | null
        /** Plays the sound of someone whose camera is off, without covering their avatar. */
        audioOnly?: boolean
        label: string
    } = $props()

    let video: HTMLVideoElement | undefined = $state()

    $effect(() => {
        if (! video) return
        if (video.srcObject !== stream) video.srcObject = stream
        // Autoplay with sound needs a click first; joining the meeting is one.
        video.play?.().catch(() => {})
    })

    $effect(() => {
        const el = video as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | undefined
        if (el?.setSinkId && ! muted) el.setSinkId(sinkId ?? '').catch(() => {})
    })
</script>

<video
    bind:this={video}
    class:mirror
    class:audio-only={audioOnly}
    style:object-fit={fit}
    autoplay
    playsinline
    {muted}
    aria-label={label}
></video>

<style>
    video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background: transparent;
    }

    .audio-only {
        opacity: 0;
        pointer-events: none;
    }

    .mirror {
        transform: scaleX(-1);
    }
</style>

<script lang="ts">
    /** A guest in the waiting room: what is happening, that it is fine to wait, and a way out. */
    import Button from '../../lib/ui/Button.svelte'
    import Notice from '../../lib/ui/Notice.svelte'
    import VideoEl from '../../lib/room/VideoEl.svelte'
    import type { Preview } from '../../lib/room/preview.svelte'

    let { name, hostName = null, preview, onleave }: { name: string, hostName?: string | null, preview: Preview, onleave: () => void } = $props()

    const hasVideo = $derived(Boolean(preview.stream?.getVideoTracks().length) && ! preview.cameraOff)
</script>

<Notice mood="waiting" title="Waiting for the host to let you in" live>
    <p>{hostName ?? 'The host'} knows you're here, {name}. You can keep this page open; we'll take you in as soon as they do.</p>
    {#snippet actions()}
        <div class="wrap">
            {#if hasVideo}
                <div class="mirror" aria-label="Your camera, ready">
                    <VideoEl stream={preview.stream} muted mirror label="Your camera preview" />
                </div>
            {/if}
            <p class="state">
                {preview.muted ? 'Your microphone is off.' : 'Your microphone is on.'}
                {preview.cameraOff || ! preview.stream?.getVideoTracks().length ? 'Your camera is off.' : 'Your camera is on.'}
            </p>
            <Button variant="secondary" icon="x" onclick={onleave}>Stop waiting</Button>
        </div>
    {/snippet}
</Notice>

<style>
    .wrap {
        display: grid;
        justify-items: center;
        gap: var(--s-4);
    }

    .mirror {
        position: relative;
        width: 220px;
        aspect-ratio: 4 / 3;
        border-radius: var(--r-md);
        overflow: hidden;
        background: #1F1C17;
        border: 2px solid var(--ink);
    }

    .state {
        color: var(--ink-muted);
        font-size: var(--text-sm);
    }
</style>

<script lang="ts">
    import CopyField from '../ui/CopyField.svelte'
    import Icon from '../ui/Icon.svelte'
    import { meetingUrl } from '../code'

    let { code, alone = false, locked = false }: { code: string, alone?: boolean, locked?: boolean } = $props()
</script>

<div class="seat" class:alone>
    {#if alone}
        <div class="inner">
            <span class="plus" aria-hidden="true"><Icon name="plus" size={28} /></span>
            <p class="title">You're the first one here</p>
            <p class="hint">{locked ? 'The meeting is locked. Unlock it to let people in.' : 'Send this link to the people you are meeting.'}</p>
            {#if ! locked}
                <div class="copy">
                    <CopyField id="seat-link" label="Meeting link" value={meetingUrl(code)} />
                </div>
            {/if}
        </div>
    {:else}
        <div class="inner small">
            <span class="plus" aria-hidden="true"><Icon name="plus" size={24} /></span>
            <p class="hint">Room for one more</p>
        </div>
    {/if}
</div>

<style>
    .seat {
        position: relative;
        min-width: 0;
        min-height: 0;
        border-radius: var(--r-lg);
        border: 2.5px dashed rgb(244 239 228 / 0.22);
        display: grid;
        place-items: center;
        padding: var(--s-5);
        overflow: auto;
    }

    .inner {
        display: grid;
        justify-items: center;
        text-align: center;
        gap: var(--s-2);
        width: 100%;
        max-width: 380px;
    }

    .plus {
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: rgb(244 239 228 / 0.08);
        color: var(--volt);
        margin-bottom: var(--s-2);
    }

    .small .plus {
        width: 44px;
        height: 44px;
    }

    .title {
        font-family: var(--font-display);
        font-weight: 750;
        font-size: var(--text-lg);
        letter-spacing: -0.02em;
    }

    .hint {
        color: var(--ink-muted);
        font-size: var(--text-sm);
    }

    .copy {
        width: 100%;
        margin-top: var(--s-3);
        text-align: left;
    }

    .copy :global(label) {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
    }

    @media (max-height: 520px) {
        .hint, .copy { display: none; }
    }
</style>

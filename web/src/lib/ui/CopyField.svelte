<script lang="ts">
    import Icon from './Icon.svelte'
    import { copyText } from '../clipboard'

    let {
        value,
        label,
        id,
        copyLabel = 'Copy link',
        secret = false,
    }: { value: string, label: string, id: string, copyLabel?: string, secret?: boolean } = $props()

    let copied = $state(false)
    let timer: ReturnType<typeof setTimeout> | undefined

    async function copy() {
        if (await copyText(value)) {
            copied = true
            clearTimeout(timer)
            timer = setTimeout(() => (copied = false), 2000)
        }
    }
</script>

<div class="copy-field">
    <label for={id}>{label}</label>
    <div class="row">
        <input {id} class="value" class:secret readonly {value} onfocus={(e) => e.currentTarget.select()} />
        <button type="button" class="copy" class:copied onclick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={18} />
            <span>{copied ? 'Copied' : copyLabel}</span>
        </button>
    </div>
    <span class="visually-hidden" aria-live="polite">{copied ? `${label} copied.` : ''}</span>
</div>

<style>
    .copy-field {
        display: grid;
        gap: var(--s-2);
        min-width: 0;
    }

    label {
        font-weight: 700;
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .row {
        display: flex;
        align-items: stretch;
        border: 2px solid var(--ink);
        border-radius: var(--r-pill);
        background: var(--surface);
        padding: 4px;
        min-width: 0;
    }

    .value {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        padding: 0 var(--s-3);
        font-family: var(--font-mono);
        font-size: max(16px, var(--text-sm));
        text-overflow: ellipsis;
        border-radius: var(--r-pill);
    }

    .value.secret {
        color: var(--ink-muted);
    }

    .copy {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: var(--s-2);
        min-height: 44px;
        padding: 0 var(--s-4);
        border: 0;
        border-radius: var(--r-pill);
        background: var(--ink);
        color: var(--bg);
        font-weight: 700;
        cursor: pointer;
        transition: background-color var(--t-fast) var(--ease-out);
    }

    .copy.copied {
        background: var(--volt);
        color: var(--on-volt);
    }
</style>

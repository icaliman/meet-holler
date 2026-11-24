<script lang="ts">
    import { extractCode, format } from '../code'

    let {
        value = $bindable(''),
        id,
        describedby,
        invalid = false,
        oninput,
    }: {
        value?: string
        id: string
        describedby?: string
        invalid?: boolean
        oninput?: () => void
    } = $props()

    function handle(event: Event & { currentTarget: HTMLInputElement }) {
        const input = event.currentTarget
        const raw = input.value
        const atEnd = input.selectionStart === raw.length
        const pasted = extractCode(raw)

        if (pasted && raw.includes('/')) {
            // A whole link: keep just the code.
            value = format(pasted)
        } else if (atEnd && ! /[/:]/.test(raw) && raw.length <= 14) {
            // Dashes go in by themselves as the groups fill up.
            value = format(raw) || raw
            input.value = value
        } else {
            value = raw
        }
        oninput?.()
    }
</script>

<input
    {id}
    class="input code-input"
    type="text"
    inputmode="text"
    autocomplete="off"
    autocapitalize="none"
    spellcheck="false"
    placeholder="abc-defg-hjk"
    aria-describedby={describedby}
    aria-invalid={invalid}
    {value}
    oninput={handle}
/>

<style>
    .code-input {
        font-family: var(--font-mono);
        letter-spacing: 0.06em;
        font-size: 1.125rem !important;
        background: var(--sunken) !important;
    }
</style>

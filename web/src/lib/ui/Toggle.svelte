<script lang="ts">
    let {
        checked = $bindable(false),
        label,
        description = null,
        id,
        disabled = false,
        onchange,
    }: {
        checked?: boolean
        label: string
        description?: string | null
        id: string
        disabled?: boolean
        onchange?: (checked: boolean) => void
    } = $props()
</script>

<div class="toggle">
    <div class="text">
        <label for={id} id="{id}-label">{label}</label>
        {#if description}<p id="{id}-desc">{description}</p>{/if}
    </div>
    <button
        {id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby="{id}-label"
        aria-describedby={description ? `${id}-desc` : undefined}
        {disabled}
        onclick={() => { checked = ! checked; onchange?.(checked) }}
    >
        <span class="knob"></span>
    </button>
</div>

<style>
    .toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s-4);
    }

    label {
        font-weight: 700;
        cursor: pointer;
    }

    p {
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    button {
        flex: none;
        position: relative;
        width: 56px;
        height: 32px;
        border-radius: var(--r-pill);
        border: 2px solid var(--ink);
        background: var(--sunken);
        cursor: pointer;
        padding: 0;
        transition: background-color var(--t-med) var(--ease-out);
    }

    button[aria-checked='true'] {
        background: var(--volt);
        border-color: var(--volt-outline);
    }

    .knob {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--ink);
        transition: transform var(--t-med) var(--ease-spring);
    }

    button[aria-checked='true'] .knob {
        transform: translateX(24px);
        background: var(--on-volt);
    }

    button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>

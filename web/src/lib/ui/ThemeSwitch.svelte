<script lang="ts">
    import Icon from './Icon.svelte'
    import { rememberTheme, savedTheme, type ThemeChoice } from '../storage'

    let theme = $state<ThemeChoice>(savedTheme())

    $effect(() => {
        const root = document.documentElement
        if (theme === 'auto') root.removeAttribute('data-theme')
        else root.setAttribute('data-theme', theme)
        rememberTheme(theme)
    })

    const options: Array<{ value: ThemeChoice, label: string, icon: 'auto' | 'sun' | 'moon' }> = [
        { value: 'auto', label: 'Match my system', icon: 'auto' },
        { value: 'light', label: 'Light', icon: 'sun' },
        { value: 'dark', label: 'Dark', icon: 'moon' },
    ]
</script>

<div class="theme" role="radiogroup" aria-label="Theme">
    {#each options as option (option.value)}
        <button
            type="button"
            role="radio"
            aria-checked={theme === option.value}
            aria-label={option.label}
            title={option.label}
            onclick={() => (theme = option.value)}
            onkeydown={(event) => {
                const i = options.findIndex((o) => o.value === theme)
                const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
                if (! step) return
                event.preventDefault()
                const group = event.currentTarget.parentElement
                theme = options[(i + step + options.length) % options.length].value
                // Arrow keys move the choice and the focus together, like native radios.
                requestAnimationFrame(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
            }}
            tabindex={theme === option.value ? 0 : -1}
        >
            <Icon name={option.icon} size={18} />
        </button>
    {/each}
</div>

<style>
    .theme {
        display: inline-flex;
        gap: 2px;
        padding: 3px;
        border-radius: var(--r-pill);
        border: 2px solid var(--line);
    }

    button {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--ink-muted);
        cursor: pointer;
    }

    button[aria-checked='true'] {
        background: var(--ink);
        color: var(--bg);
    }
</style>

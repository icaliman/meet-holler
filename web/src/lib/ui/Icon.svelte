<script lang="ts">
    import { icons, type IconName } from './icons'

    let { name, size = 20, label = null }: { name: IconName, size?: number, label?: string | null } = $props()
</script>

<svg
    class="icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden={label ? undefined : 'true'}
    role={label ? 'img' : undefined}
    aria-label={label ?? undefined}
    focusable="false"
>
    {@html icons[name]}
</svg>

<style>
    .icon {
        flex: none;
    }
</style>

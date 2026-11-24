<script lang="ts">
    /** The mark: a room seen from above, four seats, yours lit. `seats` lights more of them (0 to 4). */
    let { size = 32, seats = 3 }: { size?: number, seats?: number } = $props()
</script>

<svg class="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="10" fill="var(--mark-bg, #1A1712)" />
    <circle cx="11" cy="11" r="4.5" fill="#D4F53C" />
    {#each [[21, 11], [11, 21], [21, 21]] as [cx, cy], i}
        {#if i + 1 < seats}
            <circle {cx} {cy} r="4.5" fill="#F4EFE4" />
        {:else}
            <circle {cx} {cy} r="3.7" fill="none" stroke="#F4EFE4" stroke-width="1.6" stroke-dasharray="2.3 1.6" />
        {/if}
    {/each}
</svg>

<style>
    .mark {
        flex: none;
    }
</style>

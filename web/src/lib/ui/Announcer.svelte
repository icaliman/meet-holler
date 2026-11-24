<script lang="ts">
    import { announcement } from './announce.svelte'
</script>

<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement.text}</div>

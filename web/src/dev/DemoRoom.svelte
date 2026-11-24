<script lang="ts">
    /**
     * Dev only: /dev/room?people=3&share=1&waiting=1&off=2&poor=3&away=1&guest=1
     * shows the room with made-up people, for looking at layouts and states.
     */
    import { onDestroy } from 'svelte'
    import RoomView from '../lib/room/RoomView.svelte'
    import { DemoRoom } from './demo.svelte'

    const q = new URLSearchParams(location.search)
    const list = (key: string) => (q.get(key) ?? '').split(',').filter(Boolean).map(Number)
    const room = new DemoRoom({
        count: Number(q.get('people') ?? 4),
        share: q.get('share') === '1',
        waiting: Number(q.get('waiting') ?? 0),
        cameraOff: list('off'),
        poor: list('poor'),
        away: list('away'),
    })
    if (q.get('guest') === '1') room.isHost = false
    if (q.get('state')) room.state = q.get('state') as typeof room.state
    onDestroy(() => room.destroy())
</script>

<RoomView {room} onleave={() => {}} />

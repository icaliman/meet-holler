<script lang="ts">
    /** Microphone, camera and speaker menus; a choice applies at once and is remembered in this browser. */
    import type { DeviceKind, DeviceList } from '@packstub/holler'

    let {
        load,
        choose,
        idPrefix = 'dev',
    }: {
        load: () => Promise<DeviceList>
        choose: (kind: DeviceKind, id: string | null) => Promise<void>
        idPrefix?: string
    } = $props()

    let list = $state<DeviceList | null>(null)
    let failure = $state<string | null>(null)

    async function refresh() {
        try {
            list = await load()
        } catch {
            list = null
        }
    }

    $effect(() => {
        refresh()
        const onChange = () => refresh()
        navigator.mediaDevices?.addEventListener?.('devicechange', onChange)

        return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
    })

    async function change(kind: DeviceKind, value: string) {
        failure = null
        try {
            await choose(kind, value || null)
            await refresh()
        } catch {
            failure = kind === 'camera'
                ? "That camera didn't start. It may be in use by another app."
                : kind === 'microphone'
                    ? "That microphone didn't start. Pick another one."
                    : "We couldn't switch the speaker."
        }
    }

    const groups = $derived(list ? ([
        { kind: 'microphone', label: 'Microphone', devices: list.microphones, selected: list.selected.microphone },
        { kind: 'camera', label: 'Camera', devices: list.cameras, selected: list.selected.camera },
        { kind: 'speaker', label: 'Speaker', devices: list.speakers, selected: list.selected.speaker },
    ] as const) : [])
</script>

<div class="devices">
    {#each groups as group (group.kind)}
        {#if group.kind !== 'speaker' || group.devices.length}
            <label class="pick">
                <span>{group.label}</span>
                <select id="{idPrefix}-{group.kind}" value={group.selected ?? ''} onchange={(e) => change(group.kind, e.currentTarget.value)} disabled={! group.devices.length}>
                    <option value="">{group.devices.length ? 'System default' : `No ${group.label.toLowerCase()} found`}</option>
                    {#each group.devices as device, i (device.id)}
                        <option value={device.id}>{device.label || `${group.label} ${i + 1}`}</option>
                    {/each}
                </select>
            </label>
        {/if}
    {/each}
    {#if failure}<p class="failure" role="alert">{failure}</p>{/if}
</div>

<style>
    .devices {
        display: grid;
        gap: var(--s-4);
    }

    .pick {
        display: grid;
        gap: var(--s-2);
    }

    .pick span {
        font-weight: 700;
        font-size: var(--text-sm);
    }

    select {
        width: 100%;
        min-height: 48px;
        padding: 0 var(--s-6) 0 var(--s-3);
        border-radius: var(--r-sm);
        border: 2px solid var(--line-strong);
        background: var(--surface);
        color: var(--ink);
        font-size: max(16px, var(--text-sm));
        appearance: none;
        background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
        background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%;
        background-size: 5px 5px;
        background-repeat: no-repeat;
        text-overflow: ellipsis;
    }

    .failure {
        color: var(--danger);
        font-weight: 700;
        font-size: var(--text-sm);
    }
</style>

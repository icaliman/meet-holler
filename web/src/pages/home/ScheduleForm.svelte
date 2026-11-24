<script lang="ts">
    import Button from '../../lib/ui/Button.svelte'
    import Field from '../../lib/ui/Field.svelte'
    import Segmented from '../../lib/ui/Segmented.svelte'
    import Toggle from '../../lib/ui/Toggle.svelte'
    import { api } from '../../lib/api'
    import { explain } from '../../lib/messages'
    import { rememberCreated } from '../../lib/created'
    import { rememberHostKey, savedName, rememberName } from '../../lib/storage'
    import { navigate } from '../../lib/router.svelte'
    import { format } from '../../lib/code'
    import { dateInputValue, nextSlot, timeInputValue, timeZone } from '../../lib/time'
    import { DURATIONS, durationLabel, suggestPasscode, toInput, validate, type ScheduleErrors, type ScheduleValues } from '../../lib/schedule'

    let { oncancel }: { oncancel?: () => void } = $props()

    const slot = nextSlot()
    let values = $state<ScheduleValues>({
        title: '',
        date: dateInputValue(slot),
        time: timeInputValue(slot),
        durationMin: 30,
        visibility: 'public',
        passcode: suggestPasscode(),
        waitingRoom: false,
        hostName: savedName(),
    })
    let errors = $state<ScheduleErrors>({})
    let failure = $state<string | null>(null)
    let busy = $state(false)
    let submitted = $state(false)

    // Once someone tried to submit, errors follow their edits.
    $effect(() => {
        if (submitted) errors = validate(values)
    })

    async function submit(event: SubmitEvent) {
        event.preventDefault()
        if (busy) return
        submitted = true
        errors = validate(values)
        failure = null
        if (Object.keys(errors).length) {
            const first = (event.currentTarget as HTMLFormElement).querySelector<HTMLElement>('[aria-invalid="true"]')
            first?.focus()
            return
        }

        busy = true
        try {
            const input = toInput(values)
            const { meeting, hostKey } = await api.createMeeting(input)
            rememberHostKey(meeting.code, hostKey)
            if (values.hostName.trim()) rememberName(values.hostName)
            rememberCreated({ meeting, passcode: input.passcode ?? null })
            navigate(`/${format(meeting.code)}/ready`)
        } catch (error) {
            failure = explain(error)
        } finally {
            busy = false
        }
    }
</script>

<form class="schedule" novalidate onsubmit={submit} aria-labelledby="schedule-title">
    <div class="head">
        <h2 id="schedule-title" tabindex="-1">Schedule a meeting</h2>
        <p>You'll get a link to share and a calendar invite.</p>
    </div>

    <Field label="Title" id="s-title" optional error={errors.title}>
        {#snippet children({ id, describedby, invalid })}
            <input {id} class="input" type="text" maxlength="120" placeholder="Weekly sync" bind:value={values.title} aria-describedby={describedby} aria-invalid={invalid} />
        {/snippet}
    </Field>

    <fieldset class="when" aria-describedby="s-when-hint{errors.when ? ' s-when-error' : ''}">
        <legend>When</legend>
        <div class="row">
            <label class="sub">
                <span>Date</span>
                <input class="input" type="date" bind:value={values.date} aria-invalid={Boolean(errors.when)} min={dateInputValue(new Date())} required />
            </label>
            <label class="sub">
                <span>Time</span>
                <input class="input" type="time" step="300" bind:value={values.time} aria-invalid={Boolean(errors.when)} required />
            </label>
            <label class="sub">
                <span>Length</span>
                <select class="input" bind:value={values.durationMin}>
                    {#each DURATIONS as min}
                        <option value={min}>{durationLabel(min)}</option>
                    {/each}
                </select>
            </label>
        </div>
        {#if errors.when}
            <p class="error" id="s-when-error">{errors.when}</p>
        {/if}
        <p class="hint" id="s-when-hint">Times are in {timeZone()}. Guests see them in their own time zone.</p>
    </fieldset>

    <Segmented
        legend="Who can join"
        name="visibility"
        bind:value={values.visibility}
        options={[
            { value: 'public', label: 'Anyone with the link', icon: 'link' },
            { value: 'private', label: 'Link + passcode', icon: 'lock' },
        ]}
    />

    {#if values.visibility === 'private'}
        <Field label="Passcode" id="s-passcode" error={errors.passcode} hint="Send it separately from the link, so a forwarded link alone isn't enough.">
            {#snippet children({ id, describedby, invalid })}
                <div class="passcode">
                    <input {id} class="input code" type="text" autocomplete="off" spellcheck="false" bind:value={values.passcode} aria-describedby={describedby} aria-invalid={invalid} />
                    <Button size="sm" variant="ghost" icon="refresh" onclick={() => (values.passcode = suggestPasscode())}>New one</Button>
                </div>
            {/snippet}
        </Field>
    {/if}

    <Toggle id="s-waiting" label="Waiting room" description="You let each guest in yourself." bind:checked={values.waitingRoom} />

    <Field label="Your name" id="s-host" optional hint="Shown to guests as the host.">
        {#snippet children({ id, describedby })}
            <input {id} class="input" type="text" maxlength="40" autocomplete="name" bind:value={values.hostName} aria-describedby={describedby} />
        {/snippet}
    </Field>

    {#if failure}
        <p class="failure" role="alert">{failure}</p>
    {/if}

    <div class="actions">
        <Button type="submit" variant="primary" icon="calendar" {busy} busyLabel="Scheduling…">Schedule meeting</Button>
        {#if oncancel}
            <Button variant="ghost" onclick={oncancel}>Cancel</Button>
        {/if}
    </div>
</form>

<style>
    .schedule {
        display: grid;
        gap: var(--s-5);
    }

    .head {
        display: grid;
        gap: var(--s-2);
    }

    h2 {
        font-size: var(--text-lg);
    }

    h2:focus {
        outline: none;
    }

    .head p,
    .hint {
        color: var(--ink-muted);
        font-size: var(--text-sm);
    }

    fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        display: grid;
        gap: var(--s-2);
        min-width: 0;
    }

    legend {
        font-weight: 700;
        padding: 0;
        margin-bottom: var(--s-2);
    }

    .row {
        display: grid;
        grid-template-columns: 1.3fr 1fr 1.2fr;
        gap: var(--s-2);
    }

    @media (max-width: 520px) {
        .row {
            grid-template-columns: 1fr 1fr;
        }

        .row .sub:last-child {
            grid-column: 1 / -1;
        }
    }

    .sub {
        display: grid;
        gap: var(--s-1);
        min-width: 0;
    }

    .sub span {
        font-size: var(--text-sm);
        color: var(--ink-muted);
    }

    .input {
        width: 100%;
        min-height: 52px;
        padding: 0 var(--s-3);
        border-radius: var(--r-sm);
        border: 2px solid var(--line-strong);
        background: var(--surface);
        font-size: max(16px, var(--text-md));
        min-width: 0;
    }

    .input[aria-invalid='true'] {
        border-color: var(--danger);
    }

    select.input {
        appearance: none;
        background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
        background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%;
        background-size: 5px 5px;
        background-repeat: no-repeat;
        padding-right: var(--s-6);
    }

    .error {
        color: var(--danger);
        font-weight: 700;
        font-size: var(--text-sm);
    }

    .passcode {
        display: flex;
        gap: var(--s-2);
        align-items: center;
    }

    .passcode .input {
        flex: 1;
        font-family: var(--font-mono);
        letter-spacing: 0.08em;
    }

    .failure {
        padding: var(--s-3) var(--s-4);
        border-radius: var(--r-sm);
        background: color-mix(in srgb, var(--danger) 12%, transparent);
        color: var(--danger);
        font-weight: 700;
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--s-3);
        align-items: center;
    }
</style>

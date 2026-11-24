<script lang="ts">
    /**
     * The pointer and marks over a shared screen. Laid over the stage tile, it finds the
     * picture inside it (letterboxed by `object-fit: contain`) and works in that picture's own
     * space, so a mark lands on the same spot for everyone. With no tool picked it lets every
     * click through.
     */
    import { seatColour } from '../room/layout'
    import { markPoints, type Annotations, type Mark } from './annotations.svelte'
    import { arrowPath, contentRect, fromNormal, smoothPath, strokeWidth, toNormal, type Point, type Rect, type Size } from './geometry'

    let { annotations, container }: { annotations: Annotations, container: HTMLElement | undefined } = $props()

    let box = $state<Size>({ w: 0, h: 0 })
    let media = $state<Size | null>(null)
    let surface: HTMLDivElement | undefined = $state()
    let drawingWith: number | null = null
    let keyed: Point = { x: 0.5, y: 0.5 }
    /** Which name tags sit left of their dot (near the right edge), with some slack so a tag does not flick from side to side. */
    const flipped = new Map<string, boolean>()

    function flip(id: string, x: number): boolean {
        const was = flipped.get(id) ?? false
        const now = was ? x > 0.65 : x > 0.8
        flipped.set(id, now)

        return now
    }

    const rect = $derived(contentRect(box, media))
    const local = $derived<Rect>({ x: 0, y: 0, w: rect.w, h: rect.h })
    const tool = $derived(annotations.canAnnotate ? annotations.tool : null)

    // The box, and the picture's own size from the video inside it (which can be replaced).
    $effect(() => {
        if (! container) return
        const el = container
        let video: HTMLVideoElement | null = null
        const measure = () => {
            box = { w: el.clientWidth, h: el.clientHeight }
            media = video && video.videoWidth > 0 ? { w: video.videoWidth, h: video.videoHeight } : null
        }
        const watchVideo = () => {
            const found = el.querySelector<HTMLVideoElement>('video:not(.audio-only)')
            if (found === video) return
            video?.removeEventListener('resize', measure)
            video?.removeEventListener('loadedmetadata', measure)
            video = found
            video?.addEventListener('resize', measure)
            video?.addEventListener('loadedmetadata', measure)
            measure()
        }
        const resize = new ResizeObserver(measure)
        resize.observe(el)
        const mutations = typeof MutationObserver === 'function' ? new MutationObserver(watchVideo) : null
        mutations?.observe(el, { childList: true, subtree: true })
        watchVideo()
        measure()

        return () => {
            resize.disconnect()
            mutations?.disconnect()
            video?.removeEventListener('resize', measure)
            video?.removeEventListener('loadedmetadata', measure)
        }
    })

    function at(event: PointerEvent, clamp = false): Point | null {
        const bounds = surface?.getBoundingClientRect()
        if (! bounds) return null

        return toNormal(event.clientX - bounds.left, event.clientY - bounds.top, { x: 0, y: 0, w: bounds.width, h: bounds.height }, clamp)
    }

    function down(event: PointerEvent) {
        if (! tool || (event.pointerType === 'mouse' && event.button !== 0)) return
        const p = at(event)
        if (! p) return
        event.preventDefault()
        if (tool === 'pointer') {
            annotations.point(p)

            return
        }
        drawingWith = event.pointerId
        try {
            // Keeps the stroke going when the pen leaves the picture; drawing works without it.
            surface?.setPointerCapture?.(event.pointerId)
        } catch {
            // Not an active pointer (a synthetic event): no capture.
        }
        annotations.begin(p)
    }

    function move(event: PointerEvent) {
        if (! tool) return
        if (tool === 'pointer') {
            // A finger points only while it touches; a mouse whenever it is over the screen.
            if (event.pointerType !== 'mouse' && event.buttons === 0) return
            annotations.point(at(event))

            return
        }
        if (drawingWith !== event.pointerId) return
        const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
        const points = (events.length ? events : [event]).map((e) => at(e, true)).filter((p): p is Point => p !== null)
        annotations.extend(points)
    }

    function up(event: PointerEvent) {
        if (tool === 'pointer' && event.pointerType !== 'mouse') annotations.point(null)
        if (drawingWith !== event.pointerId) return
        drawingWith = null
        annotations.end()
    }

    function leave(event: PointerEvent) {
        if (tool === 'pointer' && event.pointerType === 'mouse') annotations.point(null)
    }

    /** Arrow keys move the pointer, so it works without a mouse too; Escape puts the tool down. */
    function key(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            annotations.setTool(null)
            event.preventDefault()

            return
        }
        if (tool !== 'pointer') return
        const step = event.shiftKey ? 0.1 : 0.02
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
        const delta = moves[event.key]
        if (! delta) return
        event.preventDefault()
        event.stopPropagation()
        keyed = { x: Math.min(1, Math.max(0, keyed.x + delta[0])), y: Math.min(1, Math.max(0, keyed.y + delta[1])) }
        annotations.point(keyed)
    }

    function paths(mark: Mark, area: Rect): { line: string, head: string | null } {
        const points = markPoints(mark).map((p) => fromNormal(p, area))
        if (mark.tool === 'arrow' && points.length >= 2) {
            const { shaft, head } = arrowPath(points[0], points[1], Math.max(14, strokeWidth('arrow', area.w) * 4.5))

            return { line: shaft, head }
        }

        return { line: smoothPath(points), head: null }
    }

    const label = $derived(tool === 'pointer'
        ? 'Shared screen. Move the mouse, or use the arrow keys, to point. Escape puts the pointer down.'
        : 'Shared screen. Draw with the mouse, a pen or a finger. Escape puts the tool down.')
</script>

<div class="layer" aria-hidden={tool ? undefined : 'true'}>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
        bind:this={surface}
        class="surface tool-{tool ?? 'none'}"
        class:active={tool !== null}
        style:left="{rect.x}px"
        style:top="{rect.y}px"
        style:width="{rect.w}px"
        style:height="{rect.h}px"
        role={tool ? 'application' : undefined}
        aria-label={tool ? label : undefined}
        tabindex={tool ? 0 : -1}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
        onpointerleave={leave}
        onkeydown={key}
    >
        <svg width={rect.w} height={rect.h} viewBox="0 0 {Math.max(1, rect.w)} {Math.max(1, rect.h)}" aria-hidden="true" focusable="false">
            {#each annotations.marks as mark (mark.key)}
                {@const d = paths(mark, local)}
                {@const width = strokeWidth(mark.tool, rect.w)}
                <g class="mark {mark.tool} seat-{seatColour(mark.seat)}" style:opacity={annotations.markOpacity(mark)}>
                    {#if mark.tool !== 'marker'}
                        <path class="halo" d={d.line} stroke-width={width + 2.5} />
                        {#if d.head}<path class="halo head" d={d.head} stroke-width="5" />{/if}
                    {/if}
                    <path class="ink" d={d.line} stroke-width={width} />
                    {#if d.head}<path class="ink head" d={d.head} />{/if}
                </g>
            {/each}
        </svg>

        {#each annotations.pointers as spot (spot.id)}
            {@const p = fromNormal(spot, local)}
            <div
                class="spot seat-{seatColour(spot.seat)}"
                class:flip={flip(spot.id, spot.x)}
                class:mine={spot.me}
                style:transform="translate({Math.round(p.x)}px, {Math.round(p.y)}px)"
                style:opacity={annotations.pointerOpacity(spot)}
            >
                <span class="dot"></span>
                <span class="tag">{spot.me ? 'You' : spot.name}</span>
            </div>
        {/each}
    </div>
</div>

<style>
    .layer {
        position: absolute;
        inset: 0;
        z-index: 6;
        pointer-events: none;
        overflow: hidden;
        border-radius: var(--r-lg);
    }

    .surface {
        position: absolute;
        pointer-events: none;
    }

    .surface.active {
        pointer-events: auto;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
    }

    .surface.tool-pointer {
        cursor: none;
    }

    .surface.tool-pen,
    .surface.tool-arrow,
    .surface.tool-marker {
        cursor: crosshair;
    }

    .surface:focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: -3px;
    }

    svg {
        position: absolute;
        inset: 0;
        overflow: visible;
    }

    .seat-0 { --seat: var(--seat-0); }
    .seat-1 { --seat: var(--seat-1); }
    .seat-2 { --seat: var(--seat-2); }
    .seat-3 { --seat: var(--seat-3); }

    .mark {
        transition: opacity 100ms linear;
    }

    .mark path {
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    /* A dark edge keeps a light colour readable on a white document. */
    .halo {
        stroke: rgb(18 17 13 / 0.45);
    }

    .ink {
        stroke: var(--seat);
    }

    .mark .halo.head {
        fill: rgb(18 17 13 / 0.55);
    }

    .mark .ink.head {
        fill: var(--seat);
        stroke-width: 2;
    }

    .marker .ink {
        stroke-linecap: butt;
        opacity: 0.55;
    }

    .spot {
        position: absolute;
        left: 0;
        top: 0;
        transition: transform 50ms linear, opacity 100ms linear;
        will-change: transform;
    }

    .dot {
        position: absolute;
        left: -8px;
        top: -8px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--seat);
        box-shadow: 0 0 0 2px #12110D, 0 0 0 7px color-mix(in srgb, var(--seat) 35%, transparent);
    }

    .tag {
        position: absolute;
        left: 12px;
        top: 10px;
        max-width: 160px;
        padding: 2px 8px;
        border-radius: var(--r-pill);
        background: var(--seat);
        color: #12110D;
        font-size: 0.75rem;
        font-weight: 700;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 0 0 1.5px #12110D;
    }

    .flip .tag {
        left: auto;
        right: 12px;
    }

    @media (prefers-reduced-motion: reduce) {
        .spot {
            transition: opacity 120ms linear;
        }
    }
</style>

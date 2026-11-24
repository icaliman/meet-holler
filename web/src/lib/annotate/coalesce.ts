// Many input events, few messages: values pushed between two flushes are merged, and a flush
// happens at most once per animation frame and never sooner than `interval` after the last.

export interface CoalesceOptions<T> {
    /** Combines what is waiting with a new value: the latest wins by default. */
    merge?: (waiting: T, next: T) => T
    /** At least this long between two flushes (ms): 33 is about 30 messages a second. */
    interval?: number
    now?: () => number
    /** Runs a callback on the next frame; returns a cancel function. */
    schedule?: (run: () => void) => () => void
}

const frame = (run: () => void): (() => void) => {
    if (typeof requestAnimationFrame === 'function') {
        const id = requestAnimationFrame(run)

        return () => cancelAnimationFrame(id)
    }
    const id = setTimeout(run, 16)

    return () => clearTimeout(id)
}

export class Coalescer<T> {
    private waiting: { value: T } | null = null
    private cancel: (() => void) | null = null
    private last = -Infinity
    private readonly merge: (waiting: T, next: T) => T
    private readonly interval: number
    private readonly now: () => number
    private readonly schedule: (run: () => void) => () => void

    constructor(private readonly flushTo: (value: T) => void, options: CoalesceOptions<T> = {}) {
        this.merge = options.merge ?? ((_, next) => next)
        this.interval = options.interval ?? 33
        this.now = options.now ?? (() => performance.now())
        this.schedule = options.schedule ?? frame
    }

    push(value: T): void {
        this.waiting = this.waiting ? { value: this.merge(this.waiting.value, value) } : { value }
        if (! this.cancel) this.cancel = this.schedule(() => this.tick())
    }

    /** Sends what is waiting now (the end of a stroke must not wait for a frame). */
    flush(): void {
        this.cancel?.()
        this.cancel = null
        if (! this.waiting) return
        const { value } = this.waiting
        this.waiting = null
        this.last = this.now()
        this.flushTo(value)
    }

    /** Forgets what is waiting without sending it. */
    drop(): void {
        this.cancel?.()
        this.cancel = null
        this.waiting = null
    }

    get pending(): boolean {
        return this.waiting !== null
    }

    private tick(): void {
        this.cancel = null
        if (this.now() - this.last < this.interval) {
            this.cancel = this.schedule(() => this.tick())

            return
        }
        this.flush()
    }
}

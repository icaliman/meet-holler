// Toasts: short messages at the bottom of the screen, read out by screen readers.
// A toast with actions (a guest waiting to be admitted) stays until it is answered.

export interface ToastAction {
    label: string
    variant?: 'primary' | 'secondary' | 'danger'
    run: () => void | Promise<void>
}

export interface Toast {
    id: number
    message: string
    /** A bold name in front of the message ("Ana" wants to join). */
    who?: string
    tone: 'info' | 'success' | 'error'
    actions: ToastAction[]
    /** Milliseconds before it goes away; 0 keeps it. */
    timeout: number
}

let ids = 0

/** `stage` while the meeting room is up: toasts sit above its control bar. */
export const toasts = $state<{ list: Toast[], placement: 'page' | 'stage' }>({ list: [], placement: 'page' })

export function toast(message: string, options: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
    const id = ++ids
    const actions = options.actions ?? []
    const item: Toast = {
        id,
        message,
        who: options.who,
        tone: options.tone ?? 'info',
        actions,
        timeout: options.timeout ?? (actions.length ? 0 : 4500),
    }
    toasts.list = [...toasts.list.slice(-3), item]
    if (item.timeout > 0) setTimeout(() => dismiss(id), item.timeout)

    return id
}

export function dismiss(id: number): void {
    toasts.list = toasts.list.filter((t) => t.id !== id)
}

export function clearToasts(): void {
    toasts.list = []
}

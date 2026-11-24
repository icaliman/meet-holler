// A small history router: the current route as state, and navigate() for links and redirects.

import { match, type Route } from './routes'

export const router = $state<{ route: Route, path: string }>({
    route: match(globalThis.location?.pathname ?? '/'),
    path: globalThis.location?.pathname ?? '/',
})

function sync() {
    router.path = location.pathname
    router.route = match(location.pathname)
}

export function navigate(path: string, { replace = false } = {}): void {
    if (replace) history.replaceState(null, '', path)
    else history.pushState(null, '', path)
    sync()
    // A new page starts at the top, and focus moves to its main heading (see Page.svelte).
    globalThis.scrollTo?.({ top: 0 })
}

export function startRouter(): () => void {
    const onPop = () => sync()
    addEventListener('popstate', onPop)

    // Same-origin links navigate without a page load.
    const onClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const anchor = (event.target as Element | null)?.closest?.('a')
        if (! anchor || anchor.target || anchor.hasAttribute('download') || anchor.origin !== location.origin) return
        if (anchor.pathname.startsWith('/api/')) return
        event.preventDefault()
        navigate(anchor.pathname + anchor.search + anchor.hash)
    }
    document.addEventListener('click', onClick)

    return () => {
        removeEventListener('popstate', onPop)
        document.removeEventListener('click', onClick)
    }
}

import '@testing-library/jest-dom/vitest'

// What jsdom leaves out and the components touch: Web Animations (Svelte transitions),
// scrollIntoView and matchMedia.
if (typeof Element !== 'undefined') {
    if (! Element.prototype.animate) {
        Element.prototype.animate = function () {
            const animation = {
                onfinish: null as null | (() => void),
                cancel() {},
                finish() {},
                play() {},
                pause() {},
                currentTime: 0,
                finished: Promise.resolve(),
            }
            queueMicrotask(() => animation.onfinish?.())

            return animation as unknown as Animation
        }
    }
    if (! Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
}

if (typeof window !== 'undefined' && ! window.matchMedia) {
    window.matchMedia = (query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
    }) as MediaQueryList
}

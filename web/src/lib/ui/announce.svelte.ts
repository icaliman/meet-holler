// Things a screen reader should hear that need no toast on screen ("Microphone off").
// Announcer.svelte renders the live region; the text is swapped so a repeat is read again.

export const announcement = $state<{ text: string, n: number }>({ text: '', n: 0 })

export function announce(text: string): void {
    announcement.n++
    announcement.text = text + (announcement.n % 2 ? '' : ' ')
}

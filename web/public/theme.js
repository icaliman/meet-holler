// The theme someone picked, before the first paint, so a dark page never flashes light.
// A file of its own, loaded by index.html before anything else: the Content-Security-Policy
// (public/_headers) allows no inline script.
try {
    const theme = JSON.parse(localStorage.getItem('holler:theme') || 'null')
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme)
} catch {}

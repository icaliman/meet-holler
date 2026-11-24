# Pointer and marks on a shared screen

While someone shares their screen, everyone in the meeting can point at it and draw on it: a laser pointer with their name, a pen, an arrow and a highlighter, in their seat colour. Marks fade a few seconds after they are drawn. Nothing is stored and nothing goes through the Worker: the messages travel between the browsers over a Holler data channel, next to the audio and video.

A browser cannot move the mouse or type on another computer, so this is the "remote control" a meeting gets: showing, not doing (docs/ARCHITECTURE.md).

## What people see

- A small palette at the top of the shared screen: **Pointer**, **Pen**, **Arrow**, **Highlighter**, then **Clear** and, for the person sharing, a switch to **let others point and draw**.
- With no tool picked the shared screen behaves as before: clicks go through, nothing is captured.
- The pointer is a dot in the person's seat colour with their name next to it ("You" for your own). It fades 1.5 s after it stops moving. With a mouse it follows the mouse over the screen; with a finger or a pen it shows while you touch.
- A mark stays 4 s after it is finished, then fades out in 0.8 s. **Clear** takes your own marks away; the person sharing and the host clear everyone's.
- The person sharing can turn the others off. Their tools are then disabled, with "Only Ana can point and draw now." under the palette, and their marks disappear. Every new share starts with everyone allowed.
- Someone who joins (or reloads) while a screen is shared starts with an empty screen: marks are moments, not a document.
- Everyone sees the pointer and the marks, the person sharing included, on the shared screen in the meeting. They are not drawn on the sharer's real screen outside the browser.

### Keyboard and screen readers

- The palette is a toolbar: <kbd>Tab</kbd> into it, arrows (and <kbd>Home</kbd>, <kbd>End</kbd>) along it, <kbd>Enter</kbd> or <kbd>Space</kbd> to pick a tool or put it down. Each button has a label and a tooltip with its shortcut.
- Shortcuts while a screen is shared: <kbd>P</kbd> pointer, <kbd>D</kbd> pen, <kbd>A</kbd> arrow, <kbd>H</kbd> highlighter, <kbd>Esc</kbd> puts the tool down. They never fire while typing in a field.
- With the pointer picked, the shared screen takes focus and the arrow keys move the pointer (<kbd>Shift</kbd> for bigger steps).
- Announced in the live region: picking a tool ("Pen on. Draw on the shared screen."), someone starting to point or draw ("Ana is pointing.", at most once every 8 s per person), clearing ("Ana cleared all marks."), and the sharer's switch.
- With `prefers-reduced-motion: reduce` the pointer jumps instead of gliding and fades are a 120 ms cross-fade.

## How it is built

| Piece | File |
| --- | --- |
| The wire format, `decode` and `encode` | `web/src/lib/annotate/protocol.ts` |
| Where the picture sits in its tile, normalising, smoothing, simplifying, fade timings | `web/src/lib/annotate/geometry.ts` |
| At most one message per animation frame, 30 a second | `web/src/lib/annotate/coalesce.ts` |
| The data channel (`CHANNELS` in `web/src/lib/holler.ts`, already opened by every client) | `web/src/lib/annotate/wire.ts` |
| State: tools, marks, pointers, the rules for what comes in | `web/src/lib/annotate/annotations.svelte.ts` |
| The overlay on the stage tile and the palette | `AnnotationLayer.svelte`, `AnnotateToolbar.svelte` |

The room (`room.svelte.ts`) makes one `Annotations` per meeting with a wire over its `CallClient` and hands it the roster on every change. The only line in `holler.ts` it relies on is the existing `CHANNELS = ['annotations']`, which every participant must list in the same order.

### Coordinates

Every point is a share of the **picture**, not of the window: `x` from 0 (left edge of the shared screen) to 1 (right edge), `y` from 0 (top) to 1 (bottom). The shared screen is shown with `object-fit: contain`, so in a tile of another shape it is letterboxed; the layer reads the video's own size (`videoWidth`, `videoHeight`), works out the rectangle the picture really fills (`contentRect`) and lays the drawing surface exactly over it. A mark at (0.75, 0.25) is on the same word for everyone, whatever the size of their window, the spotlight layout, or a phone.

Line widths scale with the picture's width too (pen 0.4 %, arrow 0.5 %, highlighter 2.2 %, with a floor in pixels), so a mark covers the same part of the screen for everyone.

## The protocol, version 1

One JSON object per data channel message, on the ordered, reliable channel labelled `annotations`. Every message has `v: 1`, a type `t`, and `s`: the participant id of the person whose screen it is about. A message about a screen that is not the one being shared now is ignored, so marks never jump from one share to the next.

```jsonc
// The pointer at a spot, or gone (left the screen, tool put down)
{ "v": 1, "t": "ptr", "s": "Qm9pX3a1c2Zk", "x": 0.4231, "y": 0.1875 }
{ "v": 1, "t": "ptr", "s": "Qm9pX3a1c2Zk", "x": null, "y": null }

// Part of a stroke. pen and marker: these points are added to stroke `id`.
// arrow: always the two ends [tailX, tailY, tipX, tipY], replacing the previous ones.
// `end: true` on the last message of the stroke.
{ "v": 1, "t": "stroke", "s": "Qm9pX3a1c2Zk", "id": 12, "tool": "pen", "pts": [0.1, 0.2, 0.1023, 0.2051], "end": false }

// Clear the sender's marks, or everyone's (`all`, honoured from the sharer and the host)
{ "v": 1, "t": "clear", "s": "Qm9pX3a1c2Zk", "all": true, "host": true }

// The sharer's setting for this share: may the others point and draw?
{ "v": 1, "t": "cfg", "s": "Qm9pX3a1c2Zk", "open": false }
```

`tool` is `pen`, `arrow` or `marker` (the highlighter). `id` is a whole number from 0 to 2³¹−1, counted per sender. Coordinates are rounded to four decimals on the way out.

A message never carries a name, a colour or any text. The receiver takes the sender from the **channel** it arrived on (the peer the channel belongs to), and their name and seat colour from its own roster.

### Sending

- The pointer is coalesced: however fast the mouse, at most one `ptr` per animation frame and never more than 30 a second. A `ptr` with `null` goes out at once.
- A stroke goes out frame by frame: the points of a frame are thinned (a hand at rest sends nothing), simplified with Ramer-Douglas-Peucker (within 0.06 % of the picture), and split into messages of at most 64 points. An arrow sends only its latest tip.
- A message goes to every peer whose `annotations` channel is open; a closed channel, or one with more than 256 KB waiting, just misses it.
- When the channel to someone opens (they joined, or either side reloaded), the person sharing sends them `cfg` with the current setting.

### Receiving: never trust a peer

Every message is checked before it changes anything; anything that fails a check is dropped without a word.

1. At most 4096 characters, valid JSON, an object with `v: 1` and a known `t`. A later version is ignored rather than guessed at.
2. `s` is an id (`[A-Za-z0-9_-]`, 1 to 64 characters); `x`, `y` and every point are finite numbers, clamped into 0..1; `pts` has an even length, 1 to 64 points (exactly two for an arrow); `id` is a whole number in range; booleans are `true` only when they are `true`.
3. The sender is in my roster and is not me; `s` is the person sharing now.
4. While the sharer has turned the others off, a `ptr` or `stroke` from anyone but the sharer is dropped, whatever the sender's own app thinks.
5. `cfg` counts only from the sharer about their own share.
6. `clear` with `all` clears everyone's marks when it comes from the sharer, or says `host` **and the sender is the host in my roster**; otherwise it clears only the sender's. `host` in a message is a claim, never proof.
7. A stroke keeps its tool, stops growing at 1500 points, and cannot be changed once it ended. One person has at most 30 marks on screen (the oldest goes). A stroke whose author goes quiet for 5 s counts as finished, so a dropped connection cannot leave a half line forever.
8. Names come from the roster and are rendered as text (Svelte escapes them); `displayName` also strips control and direction-changing characters and caps them at 40 characters.

**Who the host is.** The Worker says it: every entry of `peers` in the Holler poll has `role` (`host` or `guest`), taken from the participant's record, which only joining with the meeting's `hostKey` sets ([api.md](api.md#the-call-as-each-participant-sees-it)). The room keeps those roles (`rolesIn` in `web/src/lib/holler.ts`) and hands them to the roster as `host`; nothing a peer sends over the data channel can change them. A backend that sends no `role` names nobody: the sharer's "clear all" still works, a host's then clears only the host's own marks on the others' screens.

### Changing the protocol

Bump `v` for anything an older client would misread, and keep sending version 1 until every client in a meeting can read the new one; a client drops versions it does not know. Adding an optional field that older clients can ignore needs no bump.

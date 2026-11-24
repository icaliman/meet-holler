# Design

How meet-holler looks, moves and talks. The tokens below live in `web/src/styles/tokens.css`; a component never uses a raw colour, size or duration that is not a token. Change this file first when a rule changes.

## The idea: a room for four

A meeting holds four people at most (the WebRTC mesh). Instead of hiding that, the whole identity is built on it: **four seats, one room**.

- The **logo mark** is a room seen from above: a rounded ink square with four seats in it. One seat is lit in Volt (you), two are taken, the fourth is a dashed empty seat (room for one more).

  ![The mark](brand/mark.svg)

- The **home hero** is that mark grown into a live picture: a 2×2 grid of seat tiles where people "arrive" one after the other, the one talking lights up with a Volt ring, and the fourth seat says *your seat*. It explains the product (video, small groups, one click) before anyone reads a word.
- Every person in a meeting gets a **seat colour** (seat 0 to 3). It colours their avatar, their name tag and, later, their pointer and marks on a shared screen (#6), so "who is that" is answered by colour everywhere.
- **The room dims the lights.** Home, lobby and the other pages follow the system theme, light or dark. The meeting itself is always on the dark stage palette, whatever the theme, so faces and shared screens are the brightest thing on screen.

Not a Zoom or Meet clone: no blue, no grey toolbars, no generic cards. Warm paper and ink, one loud colour, chunky outlined controls, big friendly type.

## Colour

Warm paper and ink, one loud signal colour (Volt), a warm red for leaving and errors, four seat colours.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#F4EFE4` paper | `#12110D` night | page background |
| `--surface` | `#FFFCF5` | `#1C1A15` | panels, inputs, cards |
| `--sunken` | `#EAE3D3` | `#0B0A08` | wells, the code input, video placeholders |
| `--ink` | `#1A1712` | `#F4EFE4` | text, outlines of controls |
| `--ink-muted` | `#5C5546` | `#A9A08E` | secondary text (6.4:1 and 7.3:1) |
| `--line` | `#D8CFBD` | `#34302A` | dividers, decorative borders only |
| `--line-strong` | `#8A8170` | `#6D6658` | input borders (3:1 or more against `--surface`) |
| `--volt` | `#D4F53C` | `#D4F53C` | the primary action, speaking, "live", the lit seat |
| `--on-volt` | `#1A1712` | `#12110D` | text and icons on Volt (14:1) |
| `--volt-text` | `#4D6B00` | `#D4F53C` | Volt as text (links, "connected") where it must read on `--bg` |
| `--danger` | `#C8361C` | `#FF6B4A` | Leave, End for all, errors |
| `--on-danger` | `#FFFFFF` | `#12110D` | text on `--danger` (5.3:1 and 6.7:1) |
| `--focus` | `#1A1712` | `#D4F53C` | the focus ring |

Seat colours, the same in both themes, always with `--on-volt` ink on top (8:1 or more):

| Seat | Token | Colour |
| --- | --- | --- |
| 0 | `--seat-0` | `#D4F53C` Volt |
| 1 | `--seat-1` | `#B8A3FF` Lilac |
| 2 | `--seat-2` | `#74D0F5` Sky |
| 3 | `--seat-3` | `#FFAE82` Peach |

Rules:

- Volt is never text on paper (1.1:1). On light, a Volt button carries a 2 px ink outline; on dark it stands on its own.
- One Volt button per screen: the thing you most likely want next. Everything else is outlined (secondary) or plain text (tertiary).
- Red means leaving or broken, nothing else.
- Every pair of text and background is at least 4.5:1; control outlines and the focus ring at least 3:1.

The stage (the meeting) uses the dark values plus `--stage: #0B0A08` behind the tiles and `--tile: #1F1C17` for a tile without video.

## Type

No external requests: the fonts are bundled with the app (`@fontsource`, latin subset, `font-display: swap`) and fall back to the system stack.

| Role | Font | Fallback |
| --- | --- | --- |
| Display (headlines, numbers, the wordmark) | **Bricolage Grotesque** Variable, 700 to 800, tight tracking (`-0.03em`) | `ui-sans-serif, system-ui` |
| Text (everything else) | **Atkinson Hyperlegible**, 400 and 700: drawn for legibility, which matters for names and codes read off a screen | `ui-sans-serif, system-ui` |
| Codes (`abc-defg-hij`) | system monospace, `0.04em` tracking | `ui-monospace, SFMono-Regular, Menlo, Consolas` |

Scale (fluid with `clamp()` between 390 px and 1280 px wide):

| Token | Size | Use |
| --- | --- | --- |
| `--text-hero` | 44 → 88 px, line-height 0.95 | the home headline only |
| `--text-xl` | 30 → 44 px, 1.05 | page titles ("You're early") |
| `--text-lg` | 20 → 24 px, 1.25 | section titles, the meeting code |
| `--text-md` | 17 px, 1.5 | body, buttons, inputs (never below 16 px on inputs: no zoom on iOS) |
| `--text-sm` | 14 px, 1.4 | hints, name tags, toasts |

The wordmark is `holler` in Bricolage 800, lowercase, next to the mark.

## Space, shape, depth

- Spacing on a 4 px base: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32, `--s-7` 48, `--s-8` 72.
- Page gutter 16 px on phones, 32 px from 768 px; content column at most 1120 px; forms at most 440 px.
- Radii: `--r-sm` 10 px (inputs, chips), `--r-md` 18 px (cards, panels), `--r-lg` 28 px (video tiles, the hero), `--r-pill` for buttons and the control bar.
- Depth is a hard offset shadow, not a blur: `--lift: 0 4px 0 var(--ink)` on light for the primary button and cards that can be pressed; pressing moves it down 2 px (`translateY(2px)`, shadow 2 px). On dark, `--lift` is a 1 px Volt-tinted inner line instead. Overlays (dialogs, toasts) get one soft shadow, `--shadow-float`.
- Touch targets at least 44 × 44 px; the control bar buttons are 52 px (56 px on phones).

## Motion

Quick and springy, used to explain what changed, never to decorate.

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | most transitions |
| `--ease-spring` | `cubic-bezier(.34, 1.56, .64, 1)` | something arriving (a tile, a toast, a seat in the hero) |
| `--t-fast` | 120 ms | hover, press |
| `--t-med` | 240 ms | panels, toasts, tiles |
| `--t-slow` | 480 ms | the hero, page changes |

- A person arriving: their tile scales from 0.92 and fades in with `--ease-spring`. Leaving: fades out in `--t-med`.
- Speaking: the tile gets a Volt ring whose width follows the voice level (0 to 4 px, smoothed), not a looping pulse.
- The hero loops a short story (people arrive, one talks, then another) every 9 s.
- `prefers-reduced-motion: reduce`: no scaling, sliding or looping. Tiles and toasts appear with a 120 ms fade, the speaking ring is a steady 3 px outline while someone talks, the hero shows a still, full room.

## Components

Each lives in `web/src/lib/ui/` (generic) or `web/src/lib/room/` (the meeting).

- **Button**: `primary` (Volt, ink outline on light, `--lift`), `secondary` (outlined in ink), `ghost` (text only), `danger` (red). Pill shaped, 48 px tall (44 px `small`), icon left of the label. A busy button keeps its width, shows a small spinner and says what it does ("Starting…").
- **Field**: label above (always visible, never a placeholder as the label), hint below in `--ink-muted`, error below in `--danger` with an icon, connected with `aria-describedby`; the input gets `aria-invalid`.
- **CodeInput**: one text input in the system monospace, accepts a code with or without dashes or a whole meeting link, formats as you type (`abc-defg-hij`), says what is wrong in words ("A code has 10 letters and numbers. This one has 7.").
- **Toggle**: a switch with the label on the left and a one-line explanation under it ("Waiting room: you let each guest in yourself").
- **Segmented**: two or three choices as one pill (Public / Private).
- **Card**: `--surface`, `--r-md`, 1 px `--line`; the three home actions are cards on desktop and stacked on phones.
- **Notice**: a full-page state (not found, ended, full, waiting, denied, blocked camera): an illustration from the seat motif, a title, one sentence saying what happened, and the next step as a button. Never a dead end.
- **Toast**: bottom centre on phones, bottom left on desktop, above the control bar in a meeting; `role="status"` in an `aria-live="polite"` region; host admit requests are toasts with Admit and Deny buttons that stay until answered.
- **Mark / Logo**: the SVG mark, with the wordmark from 360 px wide.
- **Countdown**: days, hours, minutes and seconds in Bricolage digits with `font-variant-numeric: tabular-nums`; announces only the minute changes to screen readers.
- **Tile** (meeting): video or the person's initial on their seat colour, a name tag bottom left, icons for muted / camera off / weak connection, the speaking ring.
- **ControlBar** (meeting): mic, camera, share screen, more (devices, invite, host controls), leave. Pill of round buttons on the stage; a control that is off is shown filled in `--ink` on light-ink with a strike icon and says so in its label ("Turn microphone on").
- **Sheet**: a panel from the right on desktop and from the bottom on phones (people, waiting room, settings).

## Layout of the meeting

- 1 person: you, full stage, with "Waiting for others" and the invite link next to you.
- 2: side by side on wide screens, stacked on tall ones; you are never larger than the other person.
- 3 and 4: a 2 × 2 grid (3 leaves the fourth seat empty and dashed: "room for one more").
- Someone shares a screen: the screen takes the stage (spotlight), the cameras move to a strip on the right (bottom on phones).
- Phones: tiles fill the width, the control bar is fixed at the bottom with the safe-area inset, secondary controls go into More.

## Voice

Plain words, short sentences, warm. Say what happened and what to do next. Talk to one person ("you"), never "the user". No jargon: no "WebRTC", "peer", "ICE", "SDP", "token", "host key", "session" in the UI. A technical detail can go in the browser console.

| Situation | Say |
| --- | --- |
| Home headline | **A room for four. Open it in one click.** |
| Home intro | Video meetings in your browser. No account, no app, nothing to install. |
| The three actions | Start a meeting · Join with a code · Schedule for later |
| Meeting created | Your meeting is ready. Send this link to the people you're meeting. |
| Too early | You're early. This meeting opens in 12 minutes. |
| Not found | We can't find that meeting. Check the code, or start a new one. |
| Ended | This meeting has ended. Thanks for coming. |
| Full | This meeting is full. It holds four people, and four are in. Try again in a moment, or start a new meeting. |
| Locked | The host has locked this meeting. Ask them to unlock it. |
| Passcode | This meeting is private. Enter the passcode the host gave you. |
| Wrong passcode | That passcode doesn't match. Check with the host and try again. |
| Waiting room | Waiting for the host to let you in. You can keep this page open; we'll take you in. |
| Denied | The host didn't let you in this time. |
| Admit request (host) | **Ana** wants to join. Admit · Deny |
| Camera blocked | Your browser is blocking the camera. Allow it in the address bar, then try again. You can also join with the camera off. |
| No mic | We can't find a microphone. Others won't hear you, but you can still see and listen. |
| Reconnecting | Connection lost. Trying to get you back… |
| Weak connection | Ana's connection is weak. Video may freeze. |
| Alone | You're the first one here. Invite someone with the link. |
| You were removed | The host removed you from the meeting. |

Buttons say the action, as a verb: "Start a meeting", "Join now", "Copy link", "Admit", "Leave". Never "OK" or "Submit".

## Accessibility

- Everything works with the keyboard alone, in a visible order; the focus ring is 3 px `--focus` with a 2 px offset, on every interactive element, never removed.
- Every control has a visible label or, for icon buttons, an `aria-label` that says the action and a tooltip with the same words and its shortcut.
- Meeting events (someone joined, left, wants in, was admitted; you are muted; reconnecting) are announced in an `aria-live="polite"` region; errors that stop you in `role="alert"`.
- Keyboard shortcuts in the meeting: `M` microphone, `V` camera, `S` share screen, `?` lists them. Never on a single key while typing in a field.
- Colour is never the only signal: muted has an icon, speaking has a ring and the name tag says "speaking" to screen readers only when it starts, quality has a word.
- Zoom to 200 % keeps every page usable; nothing scrolls sideways at 320 px.

## Privacy

No tracking, no analytics, no third-party requests: fonts, icons and the illustration ship with the app. The only storage is `localStorage` for the host key of meetings you created on this device, your display name, and the devices you chose.

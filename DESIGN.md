---
name: Ascent
description: Mission control meets a modern game. The flight is plotted like a night-sky chart.
colors:
  mission-bg: "#090F1F"
  mission-stage: "#0B1326"
  mission-surface: "#101930"
  mission-surface-2: "#17213C"
  mission-line: "#24314F"
  mission-line-strong: "#5B6D96"
  mission-ink: "#EEF2FA"
  mission-ink-2: "#B3BDD3"
  mission-ink-3: "#8F9AB5"
  mission-grid: "#18233E"
  mission-grid-major: "#283759"
  flare-amber: "#FFB547"
  mission-eject: "#4BE3A4"
  mission-abort: "#FF7D6E"
  day-bg: "#E8EDF4"
  day-stage: "#F7F9FC"
  day-surface: "#FFFFFF"
  day-surface-2: "#EEF2F8"
  day-line: "#CBD3E1"
  day-line-strong: "#7D8AA3"
  day-ink: "#0B1430"
  day-ink-2: "#34425F"
  day-ink-3: "#4F5B78"
  day-grid: "#E3E8F1"
  day-grid-major: "#C7D0DF"
  day-amber-fill: "#F4A53C"
  day-amber-line: "#8F5200"
  day-eject: "#06774A"
  day-abort: "#BE3326"
  on-amber: "#1B1305"
typography:
  multiplier:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(3.25rem, 7.4vw, 6rem)"
    fontWeight: 780
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  brand:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    letterSpacing: "-0.02em"
  balance:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 750
  panel-title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    letterSpacing: "0.09em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
rounded:
  panel: "14px"
  control: "10px"
  chip: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
  "8": "64px"
components:
  button-go:
    backgroundColor: "{colors.flare-amber}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.control}"
    height: "60px"
  button-eject-live:
    backgroundColor: "{colors.flare-amber}"
    textColor: "{colors.on-amber}"
    rounded: "{rounded.control}"
    height: "76px"
  chip:
    rounded: "{rounded.chip}"
    height: "40px"
  input:
    rounded: "{rounded.control}"
    padding: "12px 14px"
  panel:
    backgroundColor: "{colors.mission-surface}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Ascent

> **Pre-build draft.** This file records the design direction as built in `frontend/mock_frontend.html` (October 2026). Once the real frontend exists, regenerate it from the code with `/impeccable document` so that it describes what actually ships.

## Overview

**Mission control meets a modern game.** The screen is a working game HUD first. Every control is a standard web control in the usual place. The world comes in through four things only: type, palette, density and one signature move.

**Signature move: the flight is plotted like a night-sky chart.** The multiplier is drawn as altitude on a real graticule, where the vertical axis is the multiplier and the horizontal axis is T+ seconds. Each whole multiplier the rocket passes is *catalogued* like a star, with a four-point mark labelled `2.00× · T+5.8 s`. The abort is marked with a nova and the eject point with a capsule-and-parachute glyph. A whole round can be read from the plot alone.

**The plot owns the stage.** The readout (phase chip, giant multiplier, status line) floats in the empty upper-left sky of the chart. The trajectory always climbs toward the upper right, so that corner stays clear.

**Two themes, one world.**
- **Mission mode** (dark, the default) is the night sky: deep navy, pale chart ink and one flare-amber accent.
- **Day mode** is the printed atlas: pale chart paper, navy ink and a darker amber for lines.

**Refuses:** neon casino styling, glowing edges, chrome gradients, a line chart with confetti, and cluttered side-by-side panels during flight.

## Colors

The color strategy is **restrained**: tinted neutrals, one accent, and two state colors that appear only where they carry meaning.

### Primary
- **Flare amber** (`#FFB547` mission; `#F4A53C` fill and `#8F5200` line in Day). This is the only accent. It is used for the live trajectory, the one currently enabled primary action, the selected chip, links and the focus ring. **At most one amber-filled button is on screen at any moment.**

### State colors (always paired with an icon and text)
- **Eject / win:** `#4BE3A4` mission, `#06774A` day. Used with the check-circle or capsule icon.
- **Abort / loss:** `#FF7D6E` mission, `#BE3326` day. Used with the burst icon.

### Neutral
- **Grounds:** `bg` for the page, `stage` for the chart and inputs, `surface` for panels, `surface-2` for the mock bar and hover.
- **Ink:** `ink` for primary text, `ink-2` for secondary, `ink-3` for labels and hints. All pass AA on every ground: ink-3 is at least 5.6:1 in Mission and at least 5.7:1 in Day.
- **Lines:** `line` is decorative (panel borders). `line-strong` marks control boundaries and is at least 3:1.
- **Grid:** `grid` and `grid-major` are the chart graticule, kept faint on purpose.

### Named rules
- **One amber.** If two things are amber, one of them is wrong.
- **Never color alone.** A win is green plus a check icon plus "Ejected"; an abort is coral plus a burst icon plus "Aborted".
- **Day mode lines use the dark amber** (`#8F5200`), never the fill amber, because the fill amber fails contrast as a line on paper.

## Typography

- **Archivo** (variable: width 62–125, weight 300–900) is used for everything. Width does the work a second family would: expanded and heavy for numbers, condensed caps for catalogue labels. Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`.
- **JetBrains Mono** is used only for hashes and seeds (real data, not decoration). Fallback: `ui-monospace, Menlo, Consolas, monospace`.
- All numbers use `font-variant-numeric: tabular-nums` so values don't jitter as they tick.

### Hierarchy
| Role | Size | Weight / width | Use |
| --- | --- | --- | --- |
| Multiplier | clamp(3.25rem, 7.4vw, 6rem) | 780 / 118% | The live readout. The "×" is a lighter, muted glyph |
| Balance | 1.5rem | 750 / 105% | Header |
| Brand | 1.375rem | 800 / 112% | "Ascent" |
| Button | 1.125rem (Eject in flight: 1.375rem) | 750 / 105% | Primary actions |
| Body / status | 1rem–1.0625rem | 400, with 700 for key words | Status line, hints |
| Panel title | 1rem | 700 | "Flight plan", "Mission log" |
| Label | 0.78rem caps, +0.09em | 600 / 78% | Catalogue voice: field captions, axis labels, "ROUND 48213" |
| Data | 0.8125rem mono | 400 | Hashes and seeds |

## Layout

- **Desktop (wider than 1080px):** a two-column grid, `minmax(0,1fr) 360px`.
  - Left column, top to bottom: stage, mission log, session stats.
  - Right column: Flight plan (controls), then Provably fair.
  - Stage height: `clamp(540px, 100vh − 190px, 760px)`, so the launch pad stays above the fold on a 1366×768 laptop.
- **Tablet (701–1080px):** a single column in task order: stage (520px), controls, log, then fair and session side by side.
- **Phone (700px and below):**
  - Single column with a 16px gutter. The readout sits above a 240px chart.
  - **During flight, Eject docks to the bottom of the screen** (fixed, inside the safe area) so it is always under the thumb.
- **The chart is fluid:** the SVG viewBox is recalculated from the container size, so the plot fills its box at every width. Axis labels keep a readable size, time labels thin to every 4 s when the chart is narrow, and the 1.00× label is dropped because the pad marks it.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64 px.

## Elevation & Depth

- Depth comes from **ground steps and 1px borders**, not shadows: page → stage → surface → surface-2.
- Shadows are used only on the enabled amber button and on the docked mobile Eject button. They are neutral and offset (`0 6px 16px -8px rgba(4,8,20,.45)`), never a colored glow.

## Shapes

- Panel radius 14px, control radius 10px, chips fully rounded (pill).
- Chart marks are crisp geometry: four-point catalogue stars, a 16-point nova and the capsule-and-parachute glyph. The rocket is an original inline SVG (body, fins, porthole, flame) and is drawn at 1.6× scale.
- **The mark is original:** a rounded tile with a horizon line, an amber ascent arc, and a catalogued star at its apex. It uses no agency insignia.

## Components

### Buttons: Place bet and Eject
Both buttons are always visible in the same place, with their state readable from the label as well as the style.

| Game state | Place bet | Eject |
| --- | --- | --- |
| Ready (boarding) | **Amber, enabled**: "Place bet · 100.00 credits". The betting-window bar sits directly above it | Disabled, dashed: "Eject · Opens after launch" |
| Flying | Disabled, dashed: "Bet placed · 100.00 credits riding" | **Amber, enabled, 76px tall**: "Eject · Collect 247.00", where the amount is the live payout |
| Cashed out | Disabled: "Next launch in 3 s" | Win-tinted, solid outline: check icon + "Ejected at 2.47×" |
| Crashed | Disabled: "Next launch in 3 s" | Abort-tinted, solid outline: burst icon + "Mission aborted" |

Disabled buttons carry an `aria-describedby` reason, for example "Eject becomes available once the rocket launches."

### Multiplier readout and status line
- The phase chip is "Boarding", "In flight", "Ejected" or "Aborted", each with an icon.
- The giant multiplier is muted in Ready, ink while flying, eject color after an eject and abort color after an abort.
- The status line is one sentence in the mission-control voice, and it is the `role="status"` polite live region.

### Rocket and altitude trail
- The trail is a 3px amber line with a faint amber area fill beneath it.
- The rocket launches vertical and pitches onto the trajectory over the first 3 s (a gravity turn).
- Catalogue stars appear as the rocket passes each whole multiplier.
- The flame flickers only in flight.

### Wager, chips and auto eject
- The wager input shows a "credits" unit and a Min/Max hint.
- Six quick-bet chips sit in one even row: 10, 50, 100, 250, ½ and 2×. The selected chip is amber-washed.
- The auto eject input shows a "×" unit and an optional hint.
- Inputs and chips are locked (dashed) while a bet is in flight.

### Mission log
- A horizontal strip of past rounds, newest first. Each entry shows the crash multiplier and the player's result: capsule icon with "+147.00", burst icon with "−100.00", or "No bet".
- Crashes under 2× are muted; crashes of 10× or more are amber.
- Nothing disappears: every outcome stays in the log.

### Provably fair panel
- Shows the commitment (SHA-256) in mono. The server seed shows a lock icon and "Sealed until the rocket aborts" until the crash, then is revealed.
- Includes a "Verify this mission" link and a collapsible "How verification works" section with three steps.

### Session stats
Rounds, net result (with an arrow icon and sign), best multiplier and session time, plus the reality-check line "Reality check every 30 min · next in 12 min".

### Settings
- **Language** is an EN/FR segmented control. It switches every string and number format (`fr-CA`: `1 150,00`, `2,47×`).
- **Theme** is a Mission/Day segmented control. The choice is remembered in localStorage.
- **Reduced motion:** with `prefers-reduced-motion`, the climb shows a still frame at 2.47× and every transition is turned off.

## Do's and Don'ts

**Do**
- Keep exactly one amber-filled action on screen.
- Pair every state color with an icon and a word.
- Let the plot fill the stage. The readout floats; it does not push the chart down.
- Use catalogue labels (condensed caps, +0.09em) for captions and axes.
- Use tabular numerals everywhere a number changes.
- Dock Eject to the thumb zone on phones during flight.

**Don't**
- Add colored glows, neon edges, gradient text or a confetti burst on a win.
- Show "you could have won" framing. The abort point after an eject belongs to fairness, not regret (open item, see below).
- Use NASA, CSA, ESA or any real agency's marks.
- Put meaning in color alone, or use the fill amber as a line color in Day mode.

**Open design items (from critique, not yet done)**
- After an eject, move "The rocket aborted at 3.86×" out of the status line, and draw the trail after the eject point as a ghosted line.
- Mock the error states: bet rejected, too late to eject, connection lost, not enough credits.
- Take the atlas grammar beyond the chart: catalogue-style log rows, a structured star field, and warmer chart paper for Day mode.

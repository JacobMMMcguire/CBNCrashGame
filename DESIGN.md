---
name: Ascent
description: A flat-vector night launch. The rocket, the sky and the sound tell the round before any number does.
colors:
  sky-0: "#0D0420"
  sky-1: "#1C0B33"
  hill-1: "#37185F"
  hill-2: "#2A1450"
  hill-3: "#150A26"
  panel: "rgb(30 13 56 / 0.82)"
  panel-solid: "#1E0D38"
  ink: "#F6F1FF"
  ink-2: "#CDBFE9"
  ink-3: "#A594C7"
  flame: "#FFD84A"
  flame-2: "#FFB547"
  on-flame: "#251500"
  eject: "#4BE3A4"
  on-eject: "#022416"
  abort: "#FF6B7D"
  coral: "#C9525F"
  smoke: "#F1F1F1"
  tier-low: "#FF8FA0"
  tier-mid: "#B3A1FF"
  tier-high: "#FFD84A"
typography:
  multiplier:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 17cqmin, 7.5rem)"
    fontWeight: 820
    fontStretch: "108%"
    letterSpacing: "-0.03em"
  brand:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    letterSpacing: "0.04em"
  action:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 820
    textTransform: "uppercase"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.4
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: "0.08em"
    textTransform: "uppercase"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
rounded:
  panel: "18px"
  stage: "22px"
  control: "11px"
  action: "14px"
  pill: "999px"
spacing:
  gutter-phone: "10px"
  gutter-desktop: "14px"
  panel-pad: "16px"
components:
  action-bet:
    backgroundColor: "{colors.flame}"
    textColor: "{colors.on-flame}"
    rounded: "{rounded.action}"
    height: "58–64px"
  action-eject:
    backgroundColor: "{colors.eject}"
    textColor: "{colors.on-eject}"
    rounded: "{rounded.action}"
    note: "pulses while a bet is riding"
  action-refill:
    backgroundColor: "{colors.tier-mid}"
    rounded: "{rounded.action}"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    backdropFilter: "blur(14px)"
  pill:
    rounded: "{rounded.pill}"
    fontFamily: "{typography.data.fontFamily}"
---

# Design System: Ascent

This file describes what ships in `frontend/` (tokens in `frontend/css/tokens.css`, layout in `frontend/css/app.css`, art in `frontend/js/scene/`).

## Overview

**A flat-vector night launch.** The art direction follows a flat illustration of a shuttle lifting off at night: a deep violet sky, layered purple hills, a white cloud bank, a white orbiter on a coral tank with grey boosters and a yellow flame. Everything on the stage is drawn on a canvas from those shapes and colours, so the picture explains the rules before anyone reads them: the rocket climbs while the multiplier rises, ejecting sends an astronaut tumbling clear, and the crash is an explosion.

**One screen, never scrolls.** All the data a player needs fits on one screen at every size.

- **Phone (portrait):** read data on top, the flight stage in the middle, controls at the bottom.
- **Desktop, tablet or phone in landscape:** the stage on the left; read data above controls on the right.
- Short screens drop the least essential pieces first: quick-bet chips, sub-labels, the "My flights" list.

**Refuses:** neon casino styling, chrome gradients, confetti, and anything that suggests the client knows the crash point (no pre-crash shake or warning).

## Colours

The palette is the sky, the rocket and three state colours.

- **Flame yellow** (`flame`) is the one accent: the Place bet button, the countdown bar, the focus ring and the readout glow above 10×.
- **Eject green** (`eject`) means money is coming back: the Eject button, the payout while riding, wins.
- **Abort red** (`abort`) means a loss: the exploded multiplier, lost wagers.
- **History tiers** colour each past crash point in the strip: under 2× (`tier-low`), 2–10× (`tier-mid`), 10× and above (`tier-high`).
- **Neutrals** are violet-biased (`ink`, `ink-2`, `ink-3` on `panel`), never pure grey.

The look is dark only, on purpose: the game is a night sky.

## Typography

**Archivo** for everything a player reads, set wide and heavy for the multiplier and the action button. **JetBrains Mono** for data that lines up or gets compared: crash-point pills, hashes, round ids. Every number uses tabular figures so it does not jitter while it climbs.

## The stage

| Phase | What the player sees and hears |
| --- | --- |
| Boarding | Rocket on a floodlit pad; "Launch in 4.2 s" with a shrinking flame-yellow bar; countdown ticks for the last three seconds |
| Lift-off | Ignition roar; a white cloud bank rolls out from the pad; the rocket holds 0.6 s, then rises slowly |
| Climb | Clouds rush past, the sky fades to deep space with nebulae, stars stretch into tinted streaks; a sub-pixel engine vibration; the engine sound rises in pitch and brightness with speed |
| Flyby | A body passes every 10×, in true order outward from Earth: Moon, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Proxima Centauri, Kepler-452b, then the Andromeda Galaxy (100×) and a quasar (1000×); the readout label announces it |
| Eject | An astronaut kicks clear and tumbles away, arms and legs flailing; a green toast with the profit |
| Explosion | Fireball, debris, smoke, a shockwave ring and a brief flash; the multiplier turns red |

Visual speed follows the flight clock and levels off at a top speed. It does not follow the exponential multiplier, so the picture never runs away.

## Motion and accessibility

- `prefers-reduced-motion` removes shake, streaks, flailing and the pulsing Eject button, and shortens the explosion.
- The status line is a polite live region that changes once per state, never per frame.
- Space ejects during flight; every control is reachable by keyboard with a visible flame-yellow focus ring.

## Sound

Kenney's CC0 "Sci-Fi Sounds" and "Interface Sounds", played through Web Audio after the first tap: countdown ticks, an ignition roar, an engine loop (`thrusterFire_004`) tuned to the climb speed, a flyby whoosh, bet and cash-out chimes, the explosion, and soft clicks. A limiter keeps them from clipping together. The speaker button mutes everything and is remembered.

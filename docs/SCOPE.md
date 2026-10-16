# Scope

The brief says judges prefer one polished game over a pile of unfinished features, so we finish the MVP first and add stretch features only in the order listed below.

## MVP (must ship)

- **Controls:** Place Bet and Eject (cash out), with clear enabled and disabled states for each round state.
- **Display:** balance, wager and a live multiplier shown as the rocket's altitude.
- **Balance tracking:** stored and updated only by the server, as an integer number of minor units.
- **Crash point and outcome:** a random crash point from a secure RNG, between 1.00× and `maxMultiplier`, with the round resolved to an eject or an abort.
- A single config file for every tunable value.
- A real-time channel that sends the round state and the multiplier ticks.

## Stretch (in priority order)

1. Provably fair: publish a commitment hash before each round, reveal the seed after, and add a verify panel.
2. Auto cash out.
3. Session history: a mission-log strip and a session summary.
4. English and French through a string catalog.
5. Accessibility: reduced motion, keyboard play and screen-reader announcements.
6. Configurable betting options: limits and quick-bet chips.
7. Analytics panel: session RTP, biggest win and longest streak.
8. Multiplayer rooms: a host screen, phones that join by QR code, and a leaderboard ranked by balance (play credits). Built on the `multiplayer-lobby` branch; see [HOW_IT_WORKS.md](HOW_IT_WORKS.md) and [LOCAL_SETUP.md](../LOCAL_SETUP.md).

## How the demo proves each rubric category

| Category | What we show |
| --- | --- |
| Presentation (10) | All four round states live on a laptop and a phone; Mission and Day themes; immediate win and abort feedback with icons and text. |
| Backend (10) | A double-clicked Eject pays once (idempotency); a cash out after the crash is rejected; a round is verified from its revealed seed. |
| Modularity (10) | Change `maxMultiplier` and the language in config, restart, and the behaviour and text change with no code edits. Walk through the module boundaries. |
| Creativity & Polish (20) | The rocket and altitude metaphor, the verify-the-mission panel, tasteful motion and mission-control copy. |

## Not building

- Real money, deposits, payments, or anything that looks like them.
- Chat, friends lists or other social features beyond the room lobby and the balance leaderboard.
- Registration with personal data. Accounts are play accounts only.
- Bonus rounds (cut to protect polish).
- Native mobile apps. The responsive web app covers phones.
- An admin dashboard. Configuration is a file.
- Copied space-agency branding. The logo is an original mark.

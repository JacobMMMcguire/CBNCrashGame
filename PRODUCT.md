# Product

<!-- impeccable:product-schema 1 -->

> **Ascent**: a space-launch crash game built for the Canadian Bank Note (CBN) Silver Sponsor challenge at ThunderHacks 2026.
> This file covers product facts. Visual decisions belong in [DESIGN.md](DESIGN.md); server rules in [docs/GAME_CONTRACT.md](docs/GAME_CONTRACT.md).

## Platform

Web: a desktop browser and a phone browser, from one responsive page.

## Stack

Python 3.11+ with FastAPI and uvicorn on the server; an HTTP API for commands and a WebSocket for live events. The frontend is plain HTML, CSS and JavaScript ES modules with no build step: the launch is drawn on a 2D canvas and sound plays through Web Audio. State is held in memory. Tests run on pytest.

## Users

1. **Hackathon judges (primary).** Canadian Bank Note reviewers score the demo against a 50-point rubric. They see the game for a few minutes, on a projector, a laptop or a phone. Their job is to find out whether it works, whether it is fair and secure, whether the code is well built, and whether it is memorable.
2. **Players.** Casual players with a few minutes to spare who want a short, tense round, alone or with friends. They play with **credits**: play money with no cash value. Their job is to place a bet, feel the tension of the climb, choose when to eject, and understand at once what happened.

## Product Purpose

Ascent is a casino-style crash game. A player stakes credits during boarding and the rocket launches. The multiplier rises as the rocket climbs. The player can **eject** at any time to collect `wager × current multiplier`. If the rocket **explodes** first, the wager is lost. Each round's crash point is random, falls between 1.00× and a configurable maximum, and is fixed by the server before boarding opens. Everyone connected flies the same rocket.

Success means a reliable, fair and good-looking game that meets all four MVP requirements, scores well in every rubric category, and is remembered for one idea: **a launch you can verify**.

## Positioning

Most crash games are a line on a chart with neon trim. Ascent changes three things:

- **The picture carries the mechanic.** The multiplier is the rocket's climb, cashing out is an astronaut ejecting, and the crash is an explosion. A planet passes every 10×, in true order outward from Earth. Players understand the rules from the picture.
- **Fairness is shown, not claimed.** Before each launch the server publishes SHA-256 of that round's seed; after the explosion it reveals the seed, and the page recomputes the crash point in the browser. The odds table and a Transparency section explain RTP, the RNG, auto cash out and server idempotence in plain words.
- **It is honest about the odds.** The crash distribution is the one the industry uses (`P(crash ≥ m) = RTP ÷ m`), so no eject strategy beats the house or is punished by it.

## Operating Context

- Judged at a live demo at ThunderHacks 2026.
- Runs in a desktop browser and on a phone; the whole game fits one screen at every size.
- A round is a 5-second boarding window, a flight (about half of all rounds reach 2×, which takes 11.6 s), and a 3-second pause.
- Play money only: no deposits, withdrawals, payments, real-money wagering, or sign-up with personal data. A player who runs out of credits can refill them.

## Capabilities and Constraints

**MVP (required by the brief): all built**
1. Place Bet and Cash Out controls (one action button: Place bet → Eject · Cash out).
2. A display of the account balance, wager amount and current multiplier.
3. Account balance tracking, owned by the server.
4. A random crash point and round resolution.

**Enhancements built**
1. Provably fair RNG with in-browser verification.
2. Auto cash out, run by the server at exactly the target.
3. Session history and stats (recent crash points, my flights, session result, best eject, wagered).
4. English and French.
5. Accessibility: reduced motion, keyboard play (Space ejects), screen-reader announcements.
6. Configurable betting options (limits and quick chips from config).
7. Multiplayer presence: pilot names, a live roster of the current launch, an online count, a feed of other players' cash outs.
8. Sound effects (CC0) with a mute button.
9. A reality-check reminder and an odds table.

**Not built:** bonus rounds (cut to protect polish), chat, leaderboards.

**Hard constraints**
- The server owns the multiplier clock, the crash point and the balance. The client only displays them.
- The crash point and seed never reach a client before the crash.
- Bet and cash-out requests carry idempotency keys.
- Other players see a pilot name, wager and result, never an account id or an auto-eject target.

**Terminology** (used consistently in code, copy and docs)

| Term | Meaning |
| --- | --- |
| Credits | Play-money unit. Never "dollars" or "cash". |
| Launch / round | One game cycle: boarding, flight, explosion. |
| Multiplier | The number that climbs; shown as `2.47×`. |
| Eject | Cash out. The button says "Eject" with "Cash out 26.20" under it. |
| Explosion | The crash. The rocket explodes at the crash point. |
| Pilot | A player, shown by a chosen name or a callsign such as "Comet-27". |
| Recent launches | The history strip of past crash points. |
| Auto eject | Auto cash out: a multiplier the player sets in advance; the server cashes out there. |
| RNG | The random number generator that decides the crash point. |
| Server idempotence | Sending the same request again gives the same result as sending it once. |
| RTP | Return to Player: the long-term average payout percentage (97%). |

## Brand Commitments

- The name is **Ascent**.
- The space-launch theme is binding: the rocket climbs, the astronaut ejects, the rocket explodes.
- The logo and art are original. No NASA, CSA, ESA, SpaceX or other agency marks.
- **Voice:** calm and precise, like mission control: short, factual and active ("Ejected at 2.47× · +147.00"). Never "WIN BIG", flashing urgency, or language that pushes the player to keep betting.

## Evidence on Hand

- `ThunderHacksII_CBN_Problem_Statement.pdf` is the official brief: the MVP list, rubric and glossary.
- No real player data exists. Mock mode (`?mock=1`) plays a fixed sample list of crash points and is labelled "Mock mode" on screen.

## Product Principles

1. **One finished game beats ten half features.** The MVP is polished before any enhancement.
2. **The server is the source of truth.** The client never decides an outcome or a balance.
3. **Show, don't claim, fairness.** Every round can be verified by the player.
4. **Every state reads at a glance.** Boarding, flying, ejected and exploded each have their own picture, text and sound, never colour alone.
5. **Play stays play.** Credits only, honest odds and history, and no dark patterns.

## Anti-goals

- Neon casino styling, slot-machine sound walls, or flashing "jackpot" effects.
- More than one thing competing for attention during a flight.
- Real money, deposits, payments, or anything that looks like them.
- Copied space-agency branding.
- Anything that hints at the crash point before it happens (no pre-crash shake or warning).
- Mechanics that encourage chasing losses (no "you almost won!" and no streak pressure).

## Success Criteria (mapped to the judging rubric)

| Rubric category | Points | We succeed when… |
| --- | --- | --- |
| Presentation Layer | 10 | Every round state is clear at a glance on desktop and phone; Bet and Eject are always in the same place with clear enabled and disabled states; wins and losses get immediate picture, text and sound. |
| Backend Layer | 10 | The server owns the clock, crash point and balance; the RNG is cryptographically secure and provably fair; a repeated bet or eject never double-charges or double-pays; a failed round refunds active bets. |
| Modularity & Configurability | 10 | Every tunable value lives in one config file; UI strings come from EN and FR catalogs; the engine, ledger, RNG, fairness, transport and UI are separate modules. |
| Creativity & Polish | 20 | The launch makes the rules self-explanatory; the planet flybys, the ejecting astronaut and the in-browser verifier are what judges remember; motion respects reduced-motion settings. |

## Accessibility & Inclusion

- Readable contrast on the dark theme; colour is never the only signal.
- `prefers-reduced-motion` removes shake, streaks and flailing.
- Fully playable by keyboard; Space ejects during a flight.
- Screen readers hear each state once through a polite live region.
- English and French throughout.
- A reality-check reminder every 30 minutes shows the time played and the session result.

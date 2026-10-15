# Product

<!-- impeccable:product-schema 1 -->

> Working name: **Ascent**. A space-mission crash game built for the Canadian Bank Note (CBN) Silver Sponsor challenge at ThunderHacks 2026.
> This file covers product facts only. Visual decisions belong in [DESIGN.md](DESIGN.md). Scope belongs in [docs/SCOPE.md](docs/SCOPE.md).
> Anything still undecided is marked **TBD**. Where this file infers something that the team brief did not state, it is labelled *(assumed)*.

## Platform

web

## Stack

TBD. The team has not chosen a language or framework yet. The only architectural commitment is an HTTP API plus a real-time channel (WebSocket or SSE). See the open items in [docs/HANDOFF.md](docs/HANDOFF.md).

## Users

There are two audiences, and both matter.

1. **Hackathon judges (primary).** Canadian Bank Note reviewers will score the demo against a 50-point rubric. They see the game for a few minutes, probably on a projector or a laptop, and possibly at the end of a long judging day. Their job is to find out whether the game works, whether it is fair and secure, whether the code is well built, and whether it is memorable.
2. **Players (the people the game is designed for).** These are casual players with a few minutes to spare who want a short, tense round. They play with **credits**, which are play money with no cash value. Their job is to place a bet, feel the tension of the climb, choose when to eject, and understand straight away what happened.

## Product Purpose

Ascent is a casino-style crash game. A player stakes credits and a rocket launches. The multiplier rises in step with the rocket's altitude. The player can **eject the capsule** at any time to collect `wager × current multiplier`. If the rocket **aborts** (crashes) before they eject, the wager is lost. Each round's abort point is random, falls between 1.00x and a configurable maximum, and is decided by the server before launch.

Success means a reliable, fair and good-looking game that meets all four MVP requirements, scores well in every rubric category, and is remembered for one strong idea: **a mission you can verify**.

## Positioning

Most crash games are a line on a chart with neon trim. Ascent changes two things:

- **The metaphor carries the mechanic.** The multiplier is shown as altitude, cashing out is shown as ejecting the capsule, and the crash is shown as a mission abort. Players understand the rules from the picture without reading them.
- **Fairness is visible, not just claimed.** Before each launch the server publishes a hash of that round's abort point. After the round it reveals the seed, so any player can check that the outcome was fixed in advance. This is the "provably fair" enhancement, and it maps directly to the rubric's RNG and security criteria.

## Operating Context

- The game will be judged at a live demo at ThunderHacks 2026. The demo length is TBD.
- It runs in a desktop browser and must still work on a phone, because the rubric scores responsiveness.
- Rounds are short, probably 3 to 20 seconds of flight *(assumed)*. Players play many rounds back to back.
- There is play money only. There are no deposits, withdrawals, payments, real-money wagering or account sign-up with personal data.

## Capabilities and Constraints

**MVP (required by the brief)**
1. Place Bet and Cash Out controls.
2. A display of the account balance, wager amount and current multiplier.
3. Account balance tracking.
4. A random crash point plus round resolution.

**Planned enhancements (optional, in priority order)**
1. Provably fair RNG: commit to a hash before the round, then reveal the seed afterwards.
2. Auto cash out at a multiplier the player sets.
3. Session history (the round history strip and a session summary).
4. English and French localization through a string catalog.
5. Accessibility: reduced motion, play by keyboard alone, and screen-reader announcements.
6. Configurable betting options (min/max bet, quick-bet chips).
7. Analytics panel: session RTP, biggest win and longest streak.

**Hard constraints**
- The server owns the multiplier clock, the crash point and the balance. The client only displays them.
- The crash point is never sent to the client before the crash happens.
- Bet and cash-out requests carry idempotency keys.
- Multiplayer is out of scope.

**Terminology** (use these words consistently in code, copy and docs)

| Term | Meaning |
| --- | --- |
| Credits | Play-money unit. Never call it "dollars" or "cash". |
| Launch / round | One game cycle. |
| Altitude / multiplier | The same number. The UI shows it as `2.47×`. |
| Eject | Cash out. In UI copy, use "Eject" on the button and "cash out" in help text. |
| Abort | The crash. The rocket aborts at the crash point. |
| Mission log | The history of past rounds. |
| Auto Cash Out | A multiplier the player sets in advance. The server cashes them out automatically when the multiplier reaches it. |
| RNG | The random number generator that decides the crash point. |
| Server idempotence | Sending the same request again gives the same result as sending it once. |
| RTP | Return to Player: the long-term average payout percentage. |

**Undecided:** tech stack, hosting, demo length, task owners, and the exact house edge (target RTP). All are TBD.

## Brand Commitments

- The name is **Ascent** (a working name that may still change).
- The space-mission theme is binding: the rocket climbs, the capsule ejects and the mission aborts.
- The logo must be an **original mark**. Do not use NASA, CSA, ESA, SpaceX or any other real agency's logos, insignia, meatball, worm or wordmarks.
- **Voice:** calm and precise, like mission control. It is short, factual and active ("Capsule ejected at 2.47×. +147 credits."), never shouting. Do not use "WIN BIG", flashing urgency, or language that pushes the player to keep betting.
- **Tone:** mission control meets a modern game. It should be dramatic in the moment and calm the rest of the time.

## Evidence on Hand

- `ThunderHacksII_CBN_Problem_Statement.pdf` is the official brief and is the source for the MVP list, rubric and glossary.
- No real player data, testimonials, partners or statistics exist. All numbers in mocks are illustrative and must be labelled as sample data. Do not invent player counts or payout claims.

## Product Principles

1. **One finished game beats ten half features.** This comes straight from the brief. Ship the MVP polished before starting any enhancement.
2. **The server is the source of truth.** The client never decides an outcome or a balance.
3. **Show, don't claim, fairness.** Every round can be verified by the player.
4. **Every state reads at a glance.** Ready, flying, ejected and aborted must each be clear from shape, text and icon, not from color alone.
5. **Play stays play.** Use credits only, keep history visible and session summaries honest, and never use dark patterns.

## Anti-goals

- Neon casino styling, slot-machine sound walls, or flashing "jackpot" effects.
- A cluttered layout with more than one thing competing for attention during a flight.
- Real money, deposits, payments, or anything that looks like them.
- Copied space-agency branding.
- Multiplayer, chat, leaderboards or social features.
- Mechanics designed to encourage chasing losses (no "you almost won!" messages and no streak-loss pressure).

## Success Criteria (mapped to the judging rubric)

| Rubric category | Points | We succeed when… |
| --- | --- | --- |
| Presentation Layer | 10 | All four round states are clear at a glance on desktop and phone; the light and dark themes are consistent; Bet and Eject are always in the obvious place with clear enabled and disabled states; win and abort feedback is immediate. |
| Backend Layer | 10 | The server owns the clock, crash point and balance; the RNG is cryptographically secure and provably fair; a repeated bet or eject request never double-charges or double-pays; balance changes are atomic. |
| Modularity & Configurability | 10 | Every tunable value (bet limits, max multiplier, growth rate, RTP, language) lives in one config; UI strings come from a catalog with EN and FR; the game engine, accounts, transport and UI are separate modules. |
| Creativity & Polish | 20 | The rocket and altitude metaphor makes the rules self-explanatory; the verify-the-mission panel is a feature judges remember; motion is dramatic but tasteful and respects reduced motion; the copy reads like mission control. |

## Accessibility & Inclusion

- Target **WCAG 2.1 AA** in both themes.
- Respect `prefers-reduced-motion`; the climb becomes a static readout.
- The game is fully playable by keyboard. The Space or Enter key ejects while the rocket is flying *(assumed key binding)*.
- Screen readers hear state changes through a polite live region (launch, every whole multiplier, eject result and abort).
- Color is never the only signal. Every state pairs color with an icon and text.
- English and French are supported. Allow at least 30% extra text length for French.
- An optional reality-check reminder shows elapsed session time and net result. Its interval is configurable and TBD.

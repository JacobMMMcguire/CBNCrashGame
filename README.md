# Ascent: CBN Crash Game

**Launch the rocket, watch the altitude climb, and eject before the mission aborts.** Ascent is a provably fair, space-themed crash game that uses play credits. We built it for the **Canadian Bank Note** sponsor challenge at **ThunderHacks 2026**.

> Full brief: [`ThunderHacksII_CBN_Problem_Statement.pdf`](ThunderHacksII_CBN_Problem_Statement.pdf)

---

## The problem

A **crash game** is a simple, tense wagering game. You place a bet and a multiplier starts climbing from 1.00×: 1.10×, 1.50×, 2.00× and up. You can cash out at any moment and win your bet times the current multiplier. At a random point that nobody can see in advance, the multiplier "crashes". If you have not cashed out by then, you lose your bet. Every round is a choice between taking a small, safe win now and holding on for a bigger one.

Canadian Bank Note asks teams to build one in any tech stack. A working game is only the starting point. The judges score **architecture, usability, maintainability, extensibility and overall product quality**, and they prefer a thoughtfully designed, polished product over a long list of half-finished features. The randomness also has to be trustworthy, the balance has to be correct, and the code has to be easy to change.

## Our solution

**Ascent** turns the multiplier into a rocket launch. Altitude is the multiplier, cashing out means **ejecting the capsule**, and the crash is a **mission abort**. The picture explains the rules before anyone reads them.

| What the brief asks for | How Ascent does it |
| --- | --- |
| Place Bet and Cash Out controls | **Place bet** and **Eject** buttons whose enabled, disabled and active states change with the round |
| Balance, wager and multiplier on screen | A HUD with the balance in the header, a wager panel, and a large multiplier readout that follows the rocket |
| Balance tracking | The server owns the balance, stores it as integers, and updates it atomically |
| Random crash point and outcome | A cryptographically secure, **provably fair** RNG: the server publishes a hash before launch and reveals the seed afterwards so players can verify the round |

How it maps to the rubric:
- **Presentation:** four round states that are clear at a glance, Mission (dark) and Day (light) themes, and a layout that works from phone to desktop.
- **Backend:** the server is the authority for the clock, crash point and balance; requests use idempotency keys; rounds can be verified.
- **Modularity:** one config file and an EN/FR string catalog, with the engine, accounts, transport and UI kept separate.
- **Creativity & Polish:** the space-mission metaphor, the verify-the-mission panel, and motion that respects reduced-motion settings.

Ascent uses play credits only. It has no deposits or payments, and it includes light responsible-play features: a visible round history, a session summary and an optional reality-check reminder.

## Gameplay flow

1. Player places a wager and starts a round.
2. The wager is deducted from the balance.
3. A random crash point is generated between 1.00x and the maximum multiplier.
4. The multiplier increases in real time.
5. Cashing out before the crash adds `wager × current multiplier` to the balance.
6. If the crash happens first, the wager is lost.
7. The game resets for the next round.

## MVP requirements

- [ ] **Controls**: Place Bet and Cash Out
- [ ] **Display**: account balance, wager amount, current multiplier
- [ ] **Balance tracking**
- [ ] **Crash point & outcome**: random crash point between 1.00x and a configurable maximum, with round resolution

## Judging rubric (50 pts)

| Category | Points | Focus |
| --- | --- | --- |
| Presentation Layer | 10 | UI quality, responsiveness, theme consistency, usability, gameplay feedback |
| Backend Layer | 10 | Game logic, account management, RNG, security, reliability |
| Modularity & Configurability | 10 | Code quality, maintainability, extensibility, localization |
| Creativity & Polish | 20 | Innovation, visual appeal, engagement, overall impact |

## Planned enhancements

The brief lists these optional enhancements: auto cash out, configurable betting options, session history, bonus rounds, analytics, accessibility, localization and multiplayer. Our plan, in priority order:

| # | Enhancement | Why it matters | Rubric category |
| --- | --- | --- | --- |
| 1 | Provably fair RNG (commit hash, reveal seed, verify) | Players can verify that every outcome was fixed before the round started | Backend; Creativity & Polish |
| 2 | Auto cash out | Lets players set a target in advance; the server enforces it | Backend; Presentation |
| 3 | Session history and summary | Keeps play transparent and supports responsible play | Presentation; Creativity & Polish |
| 4 | English and French localization (string catalog) | Shows that every string is configurable; fits a Canadian sponsor | Modularity & Configurability |
| 5 | Accessibility (reduced motion, keyboard, screen reader) | More people can play, and it is part of UI quality | Presentation |
| 6 | Configurable betting options | Limits and quick-bet chips come from config | Modularity & Configurability |
| 7 | Analytics panel (session RTP, biggest win, longest streak) | Engaging and honest numbers about the session | Creativity & Polish |
| – | Bonus rounds | **Cut** to protect polish | – |
| – | Multiplayer | **Out of scope** | – |

## Tech stack

| Layer | Choice | Status |
| --- | --- | --- |
| Server language / framework | TBD | Open, see [HANDOFF](docs/HANDOFF.md) |
| Real-time channel | WebSocket or SSE | TBD |
| Frontend | TBD | Open |
| Storage | TBD (in-memory is acceptable for the MVP) | Open |
| Testing | TBD | Open |
| Hosting | TBD | Open |

## Project structure (planned)

```
CBNCrashGame/
├── README.md               # this file
├── PRODUCT.md              # product truth: users, goals, principles
├── DESIGN.md               # visual system: palette, type, components
├── docs/                   # scope, workflow, contract, handoff, prompt log
├── config/                 # game.config.*: every tunable value
├── server/
│   ├── config/             # config loader and validation
│   ├── rng/                # provably fair RNG
│   ├── engine/             # round state machine and multiplier curve
│   ├── accounts/           # wallet, balances, idempotency store
│   ├── api/                # HTTP routes and errors
│   └── realtime/           # WebSocket/SSE broadcaster
├── frontend/
│   ├── mock_frontend.html  # static design mock (exists now)
│   ├── i18n/               # en.*, fr.* string catalogs
│   └── …                   # real app (structure depends on the stack)
└── tests/
```

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/HANDOFF.md](docs/HANDOFF.md) | **Start here.** Read order, decisions, open items, first tasks |
| [docs/SCOPE.md](docs/SCOPE.md) | MVP, stretch, how the demo covers the rubric, what we will not build |
| [docs/GAME_CONTRACT.md](docs/GAME_CONTRACT.md) | Server rules, state machine, config, API and events |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Build order with inputs, outputs and "done when" |
| [docs/PROMPTS.md](docs/PROMPTS.md) | Log of AI-assisted prompts |
| [PRODUCT.md](PRODUCT.md) | Users, purpose, principles, success criteria |
| [DESIGN.md](DESIGN.md) | Palette, typography, spacing, HUD components |
| [frontend/mock_frontend.html](frontend/mock_frontend.html) | Static mock of the game screen (open it by double-clicking) |

## Getting started

_Coming soon. These steps will be filled in once the stack is decided._

1. Prerequisites: **TBD**
2. Install: **TBD**
3. Configure: copy `config/game.config.*` (**TBD**)
4. Run the server: **TBD**
5. Run the frontend: **TBD**
6. Run the tests: **TBD**

To see the design mock now, open `frontend/mock_frontend.html` in any browser. It needs no server.

## Team

_Add team members here._

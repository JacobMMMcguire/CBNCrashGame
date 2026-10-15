# Ascent: CBN Crash Game

**Launch the rocket, watch the multiplier climb, and eject before it explodes.** Ascent is a provably fair, space-themed crash game played with play credits. We built it for the **Canadian Bank Note** sponsor challenge at **ThunderHacks 2026**.

> Full brief: [`ThunderHacksII_CBN_Problem_Statement.pdf`](ThunderHacksII_CBN_Problem_Statement.pdf)

---

## Run it

Prerequisite: **Python 3.11 or newer**. Nothing else; the frontend has no build step.

| | Windows (PowerShell) | macOS / Linux / Git Bash |
| --- | --- | --- |
| Set up and start | `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1` | `sh scripts/dev.sh` |
| Run the tests | `.venv\Scripts\python -m pytest` | `.venv/bin/python -m pytest` |

The script creates `.venv`, installs `requirements.txt`, checks the environment and starts the server. Then open **<http://127.0.0.1:8001/app/>**.

- **Mock mode:** <http://127.0.0.1:8001/app/?mock=1> runs rounds in the browser from a fixed list (including 24.6× and 104.5× rounds, so every planet flyby can be seen quickly).
- **Configure:** edit [`config/game.json`](config/game.json) and restart. Invalid values stop the server with a readable message.
- **Play from a phone on the same Wi-Fi:** set `ASCENT_HOST=0.0.0.0` before starting, then open `http://<your PC's IP>:8001/app/`.
- **Testing cheat:** with `ASCENT_DEV_CHEATS=1` set, typing `rectangle` during a flight jumps the multiplier ahead by +5.00×. The crash point is untouched, so rounds still verify. Without the variable the cheat does not exist (the endpoint returns 404). Never enable it outside local testing.

## How Ascent meets the brief

| The brief asks for | Ascent |
| --- | --- |
| **Controls:** Place Bet and Cash Out | One action button that follows the round: **Place bet** while boarding, **Eject · Cash out 26.20** in flight (also the Space key), **Bet next launch** to queue a bet during a flight |
| **Display:** balance, wager amount, current multiplier | The read-data panel shows **Balance**, **Your wager**, the live **Multiplier** and the **Payout** you would get now; the multiplier is also the large readout over the rocket |
| **Balance tracking** | The server owns every balance, keeps it in integer hundredths, debits the wager when the bet is placed and credits `wager × multiplier` on cash out, atomically |
| **Random crash point and outcome resolution** | A 256-bit seed from a cryptographically secure RNG per round, turned into a crash point with HMAC-SHA256. `P(crash ≥ m) = RTP ÷ m`, the formula Stake, Bustabit and Aviator use, between 1.00× and a configurable maximum (10,000×) |
| **Gameplay flow 1–7** | Bet during boarding → wager deducted → crash point fixed before launch → multiplier climbs in real time (`m(t) = e^(0.06·t)`) → eject pays `wager × multiplier` → explosion loses the wager → the next round opens automatically |

| Rubric | What to look at |
| --- | --- |
| **Presentation (10)** | One screen that never scrolls, on a phone and on a desktop; every state has its own look, sound and screen-reader message; reduced-motion support; keyboard play |
| **Backend (10)** | The server is the authority for the clock, crash point, cash-out timing and balance; idempotency keys on bet and cash out; auto cash out runs on the server; a failed round refunds active bets; 74 tests including a 200,000-round RTP simulation |
| **Modularity (10)** | Every tunable value in one config file; English and French string catalogs; the engine, ledger, RNG, fairness, transport and UI are separate modules behind interfaces |
| **Creativity & Polish (20)** | The launch: smoke, lift-off, clouds, star streaks, a planet flyby every 10× in true order from Earth, an explosion, and an astronaut who tumbles away when you eject; CC0 sound effects |

**Optional enhancements built:** auto cash out (server-side), configurable betting options (limits and quick chips from config), session history and stats, analytics (session result, best eject, wagered), accessibility, localization (EN/FR), and a **provably fair** verifier that recomputes each round in your browser. **Not built:** bonus rounds (cut to protect polish). Rounds are shared, so everyone connected sees the same rocket, but other players' bets are not shown.

**Mission control** (the ☰ button) holds the rules, the odds table, the provably fair verifier and a **Transparency** section that explains each term in the brief's glossary: RNG, RTP, auto cash out and server idempotence.

Ascent uses play credits only. It has no deposits or payments. It includes responsible-play features: a visible round history, session stats, an odds table and a reality-check reminder every 30 minutes. A player who runs out can refill their play credits.

## Tech stack

| Layer | Choice |
| --- | --- |
| Server | Python 3.11+, FastAPI, uvicorn |
| Real-time | WebSocket (`/api/v1/ws`) with reconnect and resync |
| Frontend | Plain HTML, CSS and JavaScript ES modules; the launch is drawn on a 2D canvas; sound through Web Audio |
| Storage | In memory: balances and history reset when the server restarts |
| Tests | pytest + httpx (FastAPI TestClient), 74 tests |

## Project structure

```
CBNCrashGame/
├── config/game.json        # every tunable value
├── contract/               # JSON examples and schemas for every request, response and event
├── backend/
│   ├── app/                # config, engine, rng, fairness, ledger, api, realtime, main
│   └── tests/              # pytest suite
├── frontend/
│   ├── index.html          # the game (served at /app/)
│   ├── css/                # tokens.css, app.css
│   ├── js/                 # main, store, api, realtime, live, audio, fairness, mock
│   │   ├── components/     # stage, data, controls, menu
│   │   └── scene/          # scene (the launch), art (vector drawings), milestones (planets)
│   ├── locales/            # en.json, fr.json
│   └── assets/sfx/         # sound effects (CC0)
├── docs/                   # contract, skeleton notes, handoff, AML handoff, prompt log
└── scripts/                # dev.ps1, dev.sh, check_env.py, export_schemas.py
```

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/GAME_CONTRACT.md](docs/GAME_CONTRACT.md) | Server rules, state machine, config, crash-point formula, API and events |
| [docs/SKELETON.md](docs/SKELETON.md) | How the code is organised, what is real and what is still in memory, run and test commands, contract changes |
| [DESIGN.md](DESIGN.md) | Palette, type, layout, motion and sound |
| [docs/AML_HANDOFF.md](docs/AML_HANDOFF.md) | For the AML export work: what the game stores today and what is missing |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Original team handoff and demo checklist |
| [PRODUCT.md](PRODUCT.md) | Users, purpose, principles |

## Credits

Sound effects: [Kenney](https://www.kenney.nl) "Sci-Fi Sounds" and "Interface Sounds" (CC0), converted to MP3 in `frontend/assets/sfx/`.

## Team

_Add team members here._

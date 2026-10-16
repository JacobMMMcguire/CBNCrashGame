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
- **Persistent storage:** set `DATABASE_URL` to a PostgreSQL connection string and accounts, bets, finished rounds and idempotency keys survive restarts. Without it everything stays in memory.

## Deploy (Render + Supabase)

[`render.yaml`](render.yaml) describes one Render web service that serves the API, the WebSocket and the game, deployed from `main`.

1. **Supabase:** create a project in **East US (Ohio)**. Under *Connect*, copy the **Session pooler** URI (port 5432, user `postgres.<project-ref>`) and put the database password in it. The server creates its tables (with row-level security on) the first time it starts; the SQL is in [`db/schema.sql`](db/schema.sql).
2. **Render:** *New → Blueprint*, pick this repository, and paste the URI as `DATABASE_URL` when asked.
3. Open `https://<service>.onrender.com/app/` on a phone.

Things to know:

- **One instance only.** The round loop and live connections live in the server process; a second instance or worker would run a second, separate game. `render.yaml` pins one.
- **Free tier sleep.** Render's free plan sleeps after 15 idle minutes; the first visit then takes about a minute and open connections drop. Balances and history are safe in Supabase.
- **Supabase pausing.** Free Supabase projects pause after 7 days of low activity; restore the project from the dashboard if the game cannot connect.
- **Bets riding during a restart** are refunded at 1.00× when the server starts again, as for a failed round.
- **Postgres tests:** `backend/tests/test_postgres.py` runs only when `TEST_DATABASE_URL` points at a throwaway database (it drops the tables). See the file for a one-line Docker setup.

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
| **Backend (10)** | The server is the authority for the clock, crash point, cash-out timing and balance; idempotency keys on bet and cash out; auto cash out runs on the server; a failed round refunds active bets; live multiplayer roster over WebSocket; 80 tests including a 200,000-round RTP simulation |
| **Modularity (10)** | Every tunable value in one config file; English and French string catalogs; the engine, ledger, RNG, fairness, transport and UI are separate modules behind interfaces |
| **Creativity & Polish (20)** | The launch: smoke, lift-off, clouds, star streaks, a planet flyby every 10× in true order from Earth, an explosion, and an astronaut who tumbles away when you eject; CC0 sound effects |

**Optional enhancements built:** auto cash out (server-side), configurable betting options (limits and quick chips from config), session history and stats, analytics (session result, best eject, wagered), accessibility, localization (EN/FR), multiplayer (below), and a **provably fair** verifier that recomputes each round in your browser. **Not built:** bonus rounds (cut to protect polish).

## Multiplayer

Everyone connected to the same server flies the same rocket and sees each other:

- **Pilot names:** a callsign such as "Comet-27" until you choose a name in Mission control → Pilots.
- **Who's flying:** the green counter shows *pilots in this launch / online*; the desktop panel lists each pilot's wager and result as it happens.
- **Live feed:** "Rocket Sam cashed out at 2.31× · +13.10" appears on the stage, and their astronaut ejects from the rocket too.
- **Private stays private:** others see your name, wager and result, never your account id or auto-eject target.

To play together on the same Wi-Fi, start the server with `ASCENT_HOST=0.0.0.0` and have friends open `http://<your PC's IP>:8001/app/`. To try it alone on one computer, open a second tab with `?player=2`.

### Multiplayer rooms (host screen + QR join)

For a group in one place, a host can run a separate room on a big screen:

- **Host:** open `/host` and click **Host a game**. The screen shows a QR code, a 4-character room code and the join link, then the lobby, the round and a large leaderboard. The host can start, lock the room and remove players.
- **Players:** scan the QR code (or open `/join` and type the code), pick a name, and bet and cash out with big phone buttons. Each phone keeps a server-issued session token, so reopening the page returns the same seat and balance.
- **Leaderboard:** ranked by balance in play credits, ties share a rank, updated after each round's payouts, with each player's own row highlighted.
- Rooms run on the same server rules: the server owns each room's round, clock and balances, and logs every bet and cash out for the AML export.

How it works: [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md). Running it with phones on the same Wi-Fi (Windows): [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Mission control

**Mission control** (the ☰ button) holds the rules, the odds table, the provably fair verifier and a **Transparency** section that explains each term in the brief's glossary: RNG, RTP, auto cash out and server idempotence.

Ascent uses play credits only. It has no deposits or payments. It includes responsible-play features: a visible round history, session stats, an odds table and a reality-check reminder every 30 minutes. A player who runs out can refill their play credits.

## Tech stack

| Layer | Choice |
| --- | --- |
| Server | Python 3.11+, FastAPI, uvicorn |
| Real-time | WebSocket (`/api/v1/ws`) with reconnect and resync |
| Frontend | Plain HTML, CSS and JavaScript ES modules; the launch is drawn on a 2D canvas; sound through Web Audio |
| Storage | PostgreSQL (Supabase) through psycopg when `DATABASE_URL` is set; in memory otherwise. Multiplayer rooms: SQLite by default (`STORAGE_BACKEND`) |
| Hosting | Render web service (`render.yaml`) |
| Tests | pytest + httpx (FastAPI TestClient), TBD_PYTEST tests, plus 10 PostgreSQL tests against a throwaway database; Playwright browser tests for multiplayer rooms in `e2e/` (TBD_E2E tests) |

## Project structure

```
CBNCrashGame/
├── config/game.json        # every tunable value
├── contract/               # JSON examples and schemas for every request, response and event
├── backend/
│   ├── app/                # config, engine, rng, fairness, ledger, postgres, players, api, realtime, main
│   └── tests/              # pytest suite
├── frontend/
│   ├── index.html          # the game (served at /app/)
│   ├── css/                # tokens.css, app.css
│   ├── js/                 # main, store, api, realtime, live, audio, fairness, mock
│   │   ├── components/     # stage, data, controls, menu
│   │   └── scene/          # scene (the launch), art (vector drawings), milestones (planets)
│   ├── locales/            # en.json, fr.json
│   └── assets/sfx/         # sound effects (CC0)
├── db/schema.sql           # PostgreSQL tables (run by the server on start)
├── docs/                   # contract, skeleton notes, handoff, AML handoff, prompt log
├── scripts/                # dev.ps1, dev.sh, check_env.py, export_schemas.py
└── render.yaml             # Render deployment
```

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/GAME_CONTRACT.md](docs/GAME_CONTRACT.md) | Server rules, state machine, config, crash-point formula, API and events |
| [docs/SKELETON.md](docs/SKELETON.md) | How the code is organised, what is real and what is still in memory, run and test commands, contract changes |
| [DESIGN.md](DESIGN.md) | Palette, type, layout, the launch, multiplayer, motion and sound |
| [docs/AML_HANDOFF.md](docs/AML_HANDOFF.md) | For the AML export work: what the game stores today and what is missing |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Original team handoff and demo checklist |
| [PRODUCT.md](PRODUCT.md) | Users, purpose, positioning, principles, terminology |
| [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md) | Multiplayer rooms, leaderboard and QR join, as built |
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Windows commands to run multiplayer rooms and join from phones on the same Wi-Fi; Playwright tests |

## Credits

Sound effects: [Kenney](https://www.kenney.nl) "Sci-Fi Sounds" and "Interface Sounds" (CC0), converted to MP3 in `frontend/assets/sfx/`.

**Multiplayer:** open <http://127.0.0.1:8001/host>, click **Host a game**, and scan the QR code with phones on the same Wi-Fi. Phones need `ASCENT_HOST=0.0.0.0` and `PUBLIC_BASE_URL=http://<laptop LAN IP>:8001` in `.env`; [LOCAL_SETUP.md](LOCAL_SETUP.md) has the exact steps, the firewall prompt and what to do when the Wi-Fi blocks phones.

## Team

Jacob McGuire, Sineru Dulmina and Ellison Naz.

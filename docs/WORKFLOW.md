# Build Workflow

Build the steps in this order. Each step depends on the one before it. Steps 1 to 3 can be built and tested without any network code.

File names below show the planned folder and file stem. The extension (`.*`) depends on the stack, which is **TBD**. Owners are **TBD**; fill them in during the team kickoff.

The rules every step must follow are in [GAME_CONTRACT.md](GAME_CONTRACT.md).

---

## Step 1: Config and game rules

| | |
| --- | --- |
| **What to build** | A single config file holding every tunable value, plus a loader that validates it at startup. The loader fails fast with a clear message if a value is missing or out of range. |
| **Inputs** | GAME_CONTRACT.md §3 (config table) |
| **Outputs** | `config/game.config.*` (values), `server/config/load-config.*` (loader and validation), `tests/config.test.*` |
| **Done when** | Changing any value in the config file changes behaviour without a code edit; invalid values (for example `minBet > maxBet`) stop the server at startup with a readable error; tests pass. |
| **Owner** | TBD |

## Step 2: RNG and round engine

| | |
| --- | --- |
| **What to build** | (a) The provably fair RNG: seed generation, commitment hash and crash-point formula. (b) The round state machine (`idle → betting → in-flight → crashed → settled`) with the multiplier curve and crash timing. The engine is pure logic with no network code, and its clock is injected so tests can control time. |
| **Inputs** | Config from Step 1; GAME_CONTRACT.md §2, §4, §5 |
| **Outputs** | `server/rng/provably-fair.*`, `server/engine/round-engine.*`, `server/engine/multiplier.*`, `tests/rng.test.*`, `tests/round-engine.test.*`, `tests/rtp-simulation.*` |
| **Done when** | The same seed and roundId always give the same crash point; a simulation of 1,000,000 rounds gives an RTP within ±0.5% of `targetRtp`; no crash point is ever below 1.00 or above `maxMultiplier`; state transitions happen only in the allowed order. |
| **Owner** | TBD |

## Step 3: Account and balance

| | |
| --- | --- |
| **What to build** | Play accounts with integer balances; atomic place-bet (debit) and cash-out (credit); settlement of lost bets at the crash; an idempotency store. |
| **Inputs** | Engine from Step 2; GAME_CONTRACT.md §6, §7 |
| **Outputs** | `server/accounts/account-store.*`, `server/accounts/wallet.*`, `server/accounts/idempotency.*`, `tests/wallet.test.*` |
| **Done when** | A balance can never go negative; repeating a bet or cash out with the same key changes the balance once; a second bet in the same round is rejected; a cash out after the crash is rejected; the balance is always correct after 10,000 random simulated actions. |
| **Owner** | TBD |

## Step 4: API and real-time channel

| | |
| --- | --- |
| **What to build** | The HTTP endpoints and real-time events from GAME_CONTRACT.md §8 and §9; the error format; a basic token check; the `seq` counter on events. |
| **Inputs** | Steps 1–3; GAME_CONTRACT.md §8, §9 |
| **Outputs** | `server/api/routes.*`, `server/api/errors.*`, `server/realtime/broadcaster.*`, `server/main.*`, `tests/api.test.*`, `docs/API_EXAMPLES.http` (optional request collection) |
| **Done when** | Every endpoint returns the JSON shapes in the contract; a client that connects mid-round can resync from `GET /rounds/current`; no response or event includes the crash point or seed before the crash (an automated test checks this). |
| **Owner** | TBD |

## Step 5: Frontend

| | |
| --- | --- |
| **What to build** | The real game screen, built from `frontend/mock_frontend.html` and [DESIGN.md](../DESIGN.md): the HUD, the rocket and trail, the controls and their states, the history strip, the provably fair panel, session stats, the theme toggle and the EN/FR string catalog. It renders only what the server sends. |
| **Inputs** | Mock and DESIGN.md; the API and events from Step 4 |
| **Outputs** | `frontend/` app source (structure depends on the stack), `frontend/i18n/en.*`, `frontend/i18n/fr.*`, `frontend/theme/tokens.*` |
| **Done when** | All four states match the mock on a 390 px phone and a 1440 px desktop; the Eject button sends an idempotency key and shows the server's result; animation follows server ticks without visible jumps; WCAG AA contrast passes in both themes; the game is playable by keyboard. |
| **Owner** | TBD |

## Step 6: Enhancements

| | |
| --- | --- |
| **What to build** | Stretch features in the order set in [SCOPE.md](SCOPE.md): verify panel, auto cash out, session history and summary, French, accessibility pass, betting options, analytics. **Do not start one until the previous one is polished.** |
| **Inputs** | A working MVP from Steps 1–5 |
| **Outputs** | Changes within the existing modules, plus `server/api/verify.*` and `frontend/` analytics and verify components |
| **Done when** | Each enhancement is demo-ready on its own, with tests where it touches the server. Anything unfinished is hidden behind a config flag rather than shipped half-done. |
| **Owner** | TBD |

## Step 7: Demo

| | |
| --- | --- |
| **What to build** | A demo script (see the rubric table in SCOPE.md), a seeded "demo mode" config so the crash points can be predicted on stage, a backup screen recording, and a hosted URL or a reliable local run. |
| **Inputs** | Everything above |
| **Outputs** | `docs/DEMO_SCRIPT.md`, `config/game.config.demo.*`, `demo/backup-recording.*` |
| **Done when** | Two full rehearsals have run within the time limit (**TBD**) with no live fixes needed, and the backup recording is ready. |
| **Owner** | TBD |

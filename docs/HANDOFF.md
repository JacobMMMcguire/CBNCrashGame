# Handoff: start here

You are joining **Ascent**, our crash game for the Canadian Bank Note challenge at ThunderHacks 2026. This page tells you what to read, what has already been decided, and what to do first.

## 1. Read in this order (about 30 minutes)

1. [README.md](../README.md) (5 min): the problem, our solution and the rubric.
2. [docs/SCOPE.md](SCOPE.md) (3 min): what we are and are not building.
3. [docs/GAME_CONTRACT.md](GAME_CONTRACT.md) (10 min): the server rules, state machine, config, API and events. **Required reading for backend work.**
4. [docs/WORKFLOW.md](WORKFLOW.md) (5 min): the build order and "done when" checks.
5. [docs/SKELETON.md](SKELETON.md) (5 min): the running skeleton, what is stubbed (SKELETON ONLY), how to run and test it, and which module each track owns.
6. Open [frontend/mock_frontend.html](../frontend/mock_frontend.html) by double-clicking it and click through all four states. **Required for frontend work.**
7. [DESIGN.md](../DESIGN.md) and [PRODUCT.md](../PRODUCT.md): read these when you build UI or write copy.
8. [docs/PROMPTS.md](PROMPTS.md): log every AI-assisted prompt here.

## 2. Already decided

- **Concept:** "Ascent", a space mission. The multiplier is the rocket's altitude, cashing out is "Eject", and the crash is "Abort".
- **Money:** play credits only. There are no payments.
- **Architecture:** an HTTP API for commands plus a real-time channel for the round state and ticks. The server owns the clock, the crash point and the balance.
- **Fairness:** provably fair RNG (commit hash, reveal seed, verify). This is the first enhancement after the MVP.
- **Safety:** idempotency keys on bet and cash out; balances stored as integer minor units.
- **Config:** every tunable value lives in one config file. UI strings live in an EN/FR catalog.
- **Look:** deep-space "Mission" theme and a "Day" theme with one amber accent, as shown in the mock and DESIGN.md.
- **Out of scope:** multiplayer, real money, bonus rounds, native apps.

## 3. Still TBD

| Item | Notes |
| --- | --- |
| Tech stack (server and frontend) | Must support an HTTP API and WebSocket or SSE |
| WebSocket or SSE | Decide together with the stack |
| Final house edge / `targetRtp` | 0.97 is the working value |
| Account identity | Guest token or a simple sign-in |
| Hosting | Where the demo runs |
| Demo length | Ask the organisers |
| Owners for each workflow step | Assign at kickoff |
| Reality-check interval | 30 min is the working value |
| Team member list in the README | |

## 4. Recommended first three tasks

1. **Decide the stack and record it.** Fill in the Tech stack table in README.md and the Stack section of PRODUCT.md, then scaffold the folders shown under "Project structure" in the README.
2. **Build Step 1 and Step 2 together** (config, RNG and round engine, as pure logic with tests). This is the riskiest part and needs no UI, so it can start at once. Run the RTP simulation test early.
3. **In parallel, start Step 5 from the mock.** Turn `frontend/mock_frontend.html` into real components that run against a fake event stream following GAME_CONTRACT.md §9. Swap in the real server when Step 4 lands.

## 5. Definition of done for the demo

- [ ] All four MVP requirements work end to end against the real server.
- [ ] A full round (bet, climb, eject or abort, reset) runs with no console errors.
- [ ] Double-clicking Eject pays once, and a cash out after the crash is rejected; both are shown live.
- [ ] At least one round is verified from its revealed seed in the UI.
- [ ] The game works on a phone (390 px) and a laptop, in both themes, in English and French.
- [ ] Reduced motion and keyboard-only play both work.
- [ ] Changing a config value (for example `maxMultiplier`) changes behaviour with no code edit.
- [ ] RNG and wallet tests pass, and the RTP simulation is within tolerance.
- [ ] Two rehearsals have been completed within the time limit, and a backup recording exists.
- [ ] README "Getting started" lets a stranger run the game in under 5 minutes.

## 6. Open items

| # | Open item | Who should decide | Status |
| --- | --- | --- | --- |
| 1 | Tech stack and WebSocket vs SSE | Whole team, led by the backend owner | TBD |
| 2 | Owner for each workflow step (1–7) | Team lead, at kickoff | TBD |
| 3 | Hosting for the demo (hosted URL or local laptop) | Backend owner, with the team lead | TBD |
| 4 | Demo length and format | Team lead (confirm with the organisers) | TBD |
| 5 | Final `targetRtp` | Backend owner | TBD (0.97 working) |
| 6 | Account identity approach | Backend owner | TBD |
| 7 | Final product name (keep "Ascent"?) | Whole team | TBD |

# Prompt Log

This file records every AI-assisted build prompt, so the team (and judges, if asked) can see how each part was made and what went wrong.

**How to add an entry:** copy the template below under the matching step. Fill it in **immediately after** the session, while the details are fresh. Paste the exact prompt rather than a summary.

```markdown
### <short title> (<date>, <who>)

**Context to paste**
<files, docs or snippets given to the model>

**Exact prompt**
<the prompt, verbatim>

**Expected output**
<files or behaviour you expected>

**How we test it**
<commands, manual checks, acceptance criteria from WORKFLOW.md>

**What went wrong and how we fixed it**
<problems, follow-up prompts, manual fixes; "Nothing" is a valid answer>
```

---

## Docs and frontend mock

### Docs, PRODUCT/DESIGN and static mock (2026-10-15, TBD)

**Context to paste**
README.md, ThunderHacksII_CBN_Problem_Statement.pdf. The prompt itself contained the full product context: the Ascent space-mission concept, the planned enhancements and the design tone.

**Exact prompt**
> /impeccable init
>
> FIRST, BEFORE ANYTHING ELSE (branch check): confirm or create `docs-and-frontend-mock`; no other git commands.
> Then: do not write game logic. Create or update PRODUCT.md, DESIGN.md, docs/SCOPE.md, docs/WORKFLOW.md, docs/PROMPTS.md, README.md (reorganised, keeping all existing facts), docs/HANDOFF.md, docs/GAME_CONTRACT.md; add `.claude/settings.local.json`, `.playwright-cli/`, `.impeccable/review/` to .gitignore. Stack stays TBD and stack-neutral. Part B: use /impeccable shape for the main game screen and build a single self-contained `/frontend/mock_frontend.html` (four-state switcher, looped decorative climb, Mission/Day theme toggle, EN/FR toggle; no game logic, no fetch). Then run /impeccable critique and apply the top 3 fixes; update DESIGN.md to match; log the prompt here. Do not commit or push.
>
> *(This is an abridged copy. The full prompt included the complete context block and the per-file requirements listed above.)*

**Expected output**
Eight documentation files, the `.gitignore` additions, and one mock HTML file that opens by double-clicking it.

**How we test it**
- Open `frontend/mock_frontend.html` directly from disk in Chrome, Firefox and Safari.
- Switch through all four states; toggle the theme and the language; resize to 390 px wide.
- Turn on "reduce motion" in the operating system and confirm the climb becomes a still image.
- Tab through every control and confirm focus is visible.
- Check that README.md still contains the MVP checklist, gameplay flow, rubric table, optional enhancements and the PDF link.

**What went wrong and how we fixed it**
- Impeccable's `init` and `shape` normally interview the user. The prompt said "do not ask questions", so PRODUCT.md was written from the brief, with assumptions labelled *(assumed)* and gaps marked TBD.
- Impeccable's direction roll would normally open a decision page. The brief already pinned the direction ("mission control meets modern game"), so the pinned direction was used. The roll's open dimensions were translated into it: a star-atlas chart grammar for the flight plot.
- There was no interactive browser tool, but headless Microsoft Edge could take screenshots. So the critique used real renders (desktop 1440, laptop 1366×768, tablet 900, and phone 390 through an iframe, because headless Edge clamps windows to about 496px) as well as code review. The live detector overlay could not be injected.
- The design hook flagged a colored glow on the amber button (replaced with a neutral shadow) and a 2px keycap border on `<kbd>` (replaced with a uniform border and an inset shadow).

**Critique results** (`/impeccable critique`, two independent assessments)
- Score before the fixes: **22/40** (Nielsen heuristics, "Acceptable"). Detector: one finding (keycap border), fixed, so now **0**.
- **Top 3 fixes applied:**
  1. **Eject button showed "Collect 184.00" after a crash** (and "Collect …" in Ready and Cashed out). The decorative climb loop was overwriting the button label in every state. The live payout now has its own element and exists only during Flying. Also fixed a float bug that displayed 2.26× as 2.25×.
  2. **The stage wasted the hero.** The chart was letterboxed, leaving a band of about 130px, and the launch pad sat below the fold on a laptop. The chart's viewBox now resizes to fill the stage, and the readout floats over the empty upper-left sky. The stage has a bounded height. The rocket is 1.6× larger and launches vertically before pitching over. The betting-window bar moved next to Place bet.
  3. **The phone layout was broken.** The page was 1,222–1,325px wide at 390px because screen-reader text escaped the log strip, and Eject was below the fold during flight. Fixed by positioning the log strip, docking Eject to the bottom of the screen during flight, and thinning the axis labels. The quick-bet chips now sit in one even row.
- Also fixed: the Day-mode "In flight" chip contrast (4.33 raised to above 5:1, using a darker line amber).
- **Not done yet (recorded in DESIGN.md as open items):**
  - Regret framing after an eject ("The rocket aborted at 3.86×" in the status line).
  - No error states mocked.
  - The atlas grammar stops at the chart edge.
  - The Space hint shows in every state.
  - "Verify this mission" doesn't open the details panel.

---

## Skeleton

### Runnable walking skeleton, backend and frontend (2026-10-15, TBD)

**Context to paste**
README.md, PRODUCT.md, DESIGN.md, docs/SCOPE.md, docs/WORKFLOW.md, docs/GAME_CONTRACT.md, docs/HANDOFF.md, frontend/mock_frontend.html and the problem statement PDF (the prompt tells the model to read them).

**Exact prompt**
```text
BRANCH CHECK (first):
Run `git branch --show-current` and `git status`. Check that PRODUCT.md, DESIGN.md, docs/GAME_CONTRACT.md and frontend/mock_frontend.html exist. If any is missing, stop and tell me which branch has them. If the current branch is not main or master, run `git checkout -b skeleton` (switch to it if it already exists). Never work on main or master. Run no other git command that changes anything until PART B.

GOAL: Build a runnable walking skeleton for the CBN crash game ("Ascent") that the backend and the frontend can be developed on in parallel. Stack: Python 3.11+, FastAPI, WebSocket, plain HTML/CSS/JS with ES modules and no build step. This is a foundation, not the finished game: real game logic stays as clearly marked stubs.

READ FIRST: README.md, PRODUCT.md, DESIGN.md, docs/SCOPE.md, docs/WORKFLOW.md, docs/GAME_CONTRACT.md (the source of truth for states, config, endpoints and events), docs/HANDOFF.md, frontend/mock_frontend.html (the visual reference) and the problem statement PDF. If docs/BLUEPRINT.md and docs/WIREFRAMES.md exist, follow them too.

HARD RULES:
- Play money only; no real money, payments or accounts.
- The server owns the multiplier clock, the crash point and the balance. The crash point must never appear in any message before the crash.
- Do NOT implement the real RNG, the provably fair flow, or the real ledger rules. Provide interfaces plus clearly labelled SKELETON ONLY stubs: a deterministic, insecure fixed-sequence crash-point provider; a placeholder fairness hash; an in-memory ledger. Never describe the stubs as fair or secure.
- Never write any secret or key. Add .env.example with names only.
- Do not edit PRODUCT.md or DESIGN.md. Do not copy NASA or any real agency's logos or wordmarks. Do not add any confidentiality note.
- Follow docs/GAME_CONTRACT.md exactly; if it must change, list the proposal under "Contract changes proposed" in docs/SKELETON.md and do not edit it.

BUILD:
1. Structure: backend/app/ (config, schemas, engine, ledger, rng, fairness, api, realtime, main), backend/tests/, frontend/ (index.html, css/, js/, locales/), contract/ (examples and JSON schemas for every request, response and event), config/game.json, scripts/, docs/.
2. Config: config/game.json with the keys and example values from the contract, loaded and validated at startup with clear error messages. A public subset is exposed at GET /api/config. Include a contract_version.
3. Interfaces: define the module interfaces (for example CrashPointProvider, Ledger, RoundEngine, Clock) with docstrings that say what the real implementation must do and which contract section it comes from. Each stub carries a TODO and a "SKELETON ONLY" label.
4. Round engine: the state machine (idle, betting, in-flight, crashed, settled) with guarded transitions and a real server-clock loop that emits ticks at the configured interval, using the stub crash points.
5. API per the contract: place bet and cash out with idempotency keys, current state, history, config and health. A WebSocket endpoint emitting round_state, tick, crashed and history events. Validated inputs, structured error codes from the contract, and CORS settings in config.
6. Frontend shell: the layout regions of mock_frontend.html (header with balance, language and theme; stage with multiplier readout and status line; controls with wager input, quick-bet chips, auto cash out placeholder, Place Bet and Cash Out; history strip; provably fair panel placeholder; session stats placeholder). Use the tokens from DESIGN.md as CSS variables. Modules: api.js, realtime.js (WebSocket with reconnect and a visible connection status), store.js, i18n.js with locales/en.json and locales/fr.json, and one small module per component. Buttons enable and disable correctly per game state. This is a shell: working structure and semantics, minimal styling, no polish.
7. Mock mode: opening the frontend with ?mock=1 runs a local fake round loop that emits the same events from contract/examples/, so the frontend can be developed without the backend.
8. Accessibility baseline: semantic HTML, labelled inputs, an aria-live status announcement per game state, visible focus, keyboard operation of Place Bet and Cash Out, prefers-reduced-motion respected.
9. Tests (pytest, httpx): config validation; state transitions; idempotent bet and cash-out; the crash point never appears before the crash; a WebSocket smoke test; and every file in contract/examples validates against its schema.
10. Tooling: requirements.txt with minimal pinned dependencies (fastapi, uvicorn, websockets, httpx, pytest), scripts/dev.ps1 and scripts/dev.sh that create the venv, install, and start one server that also serves the frontend at /app, and scripts/check_env.py that imports each dependency and prints a plain message if Windows Application Control blocks a package, instead of a raw traceback. Add .env.example and extend .gitignore (.venv, __pycache__, .env, .claude/).
11. Docs: docs/SKELETON.md (how the skeleton is organised, what is stubbed, who owns which module, how to replace a stub, run and test commands, "Contract changes proposed"); replace the TBD "Getting started" and "Tech stack" in README.md with the real commands and stack; add docs/SKELETON.md to the documentation index in README.md and to the read order in docs/HANDOFF.md; log this prompt and its result in docs/PROMPTS.md under "Skeleton".

CHECKS BEFORE FINISHING:
1. Run scripts/check_env.py. If a package is blocked by Application Control, report it plainly and do not work around the block.
2. Run the tests and report the results.
3. Start the server and verify with real requests: health, config, state, a bet, an idempotent repeat of the same bet, a cash out, and a WebSocket session showing ticks and a crash event. Confirm that no message before the crash contains the crash point.
4. If a browser is available, load /app and ?mock=1, confirm the shell renders, buttons change per state, and the connection status and language toggle work. If not, say so.
5. Run /impeccable audit on the shell for an accessibility baseline, report the findings, and fix only trivial ones. Visual polish comes later with /impeccable polish.
6. `git status`: only expected files; no secrets; no .claude/.
Then STOP. Print the check results, what is stubbed, who can start on what, "Contract changes proposed", and the open issues. Wait for me to reply "go". Do not run any git command that changes anything until I do.

PART B: LOCAL COMMIT ONLY (after I reply "go")
Run `git branch --show-current` (must be skeleton), then `git status`. Stage the new and changed files by name (never `git add .` or `git add -A`), excluding .venv, .env and .claude/. Commit with the message: "Add runnable skeleton for backend and frontend (stubs marked SKELETON ONLY)". Do not push. Print the branch, commit hash and files committed, and remind me that I may not have push access to this repository, so a fork or the owner's permission may be needed.
```

The session was cut off by a network error. It was resumed with a second prompt that repeated the hard rules, asked for a state report and a check of half-applied edits, moved the dev server to port 8001 (to avoid another project's server), and asked for the remaining checks (a)–(e) before stopping for "go".

**Expected output**
A server that runs rounds on its own clock with stub crash points, the full API and event set from the contract, a frontend shell that plays against it or against `?mock=1`, contract examples and schemas, tests, dev scripts and docs/SKELETON.md.

**How we test it**
- `.venv\Scripts\python scripts\check_env.py`: all packages import (no Application Control block on this machine).
- `.venv\Scripts\python -m pytest`: 63 passed.
- Live requests against `http://127.0.0.1:8001`: health, config, current round, a bet and the same bet repeated with the same key (identical body, `Idempotent-Replayed: true`, balance debited once), a cash out repeated with the same key (identical, paid once), and a WebSocket session with ticks, private `round.cashout` / `balance.updated`, and `round.crashed`. Of 100 messages before the crash, none contained the crash point or the seed.
- Headless Microsoft Edge driven over the DevTools protocol: `/app/` and `/app/?mock=1` render; Place bet (keyboard Enter) and Eject (Space) change state as specified; EN/FR and Mission/Day toggle and are remembered; stopping the server shows "Reconnecting…" and disables Place bet with "Waiting for the connection to mission control"; restarting recovers to "Live" and re-enables the controls; no horizontal scroll at 390 px.

**What went wrong and how we fixed it**
- `python` on PATH was the Microsoft Store stub; the dev scripts use the `py` launcher (or its default install path) to create the venv.
- Windows can map `.js` to `text/plain`, which breaks ES modules; `main.py` registers the right MIME types.
- The first live-check script miscounted messages before the crash (it counted a crash from the round it joined midway). After the fix, the leak check ran on 100+ messages.
- The browser check found three label bugs, all fixed: Place bet still said "credits riding" after an eject; Eject's disabled reason was wrong after an eject; the countdown could show "6 s" for a 5 s window.
- The session was cut off by a network error during the browser checks; the resumed session re-ran every check from the start on port 8001.

**Audit results** (`/impeccable audit` on the shell, accessibility focus)
- Detector on files: 0 failures, 16 advisories (font sizes and two radii off the DESIGN.md front-matter scale, carried over from the mock). Detector on the live page: 1 finding (mission-log entries are cards inside a panel, as in the mock).
- Trivial fixes applied: placeholder contrast (4.0:1 raised by using `--ink-3`), phase-chip glyphs hidden from screen readers, an invalid `aria-labelledby` on the balance removed, selection and caret themed from the palette.
- Left for later (`$impeccable adapt` / `$impeccable polish`): Unicode glyphs instead of SVG icons (phase chip and the ✓/✷ in button labels); segmented buttons (36 px) and chips (40 px) below 44 px touch targets; disabled buttons drop out of the tab order, so their reasons are only reachable by screen-reader browsing; no announcement of whole multipliers during flight; phone layout (header wraps loosely, controls below the fold, no Eject dock); off-ramp font sizes and radii.

---

## Step 1: Config and game rules

_No entries yet._

## Step 2: RNG and round engine

_No entries yet._

## Step 3: Account and balance

_No entries yet._

## Step 4: API and real-time channel

_No entries yet._

## Step 5: Frontend

_No entries yet._

## Step 6: Enhancements

_No entries yet._

## Step 7: Demo

_No entries yet._

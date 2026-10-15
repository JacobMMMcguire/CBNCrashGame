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

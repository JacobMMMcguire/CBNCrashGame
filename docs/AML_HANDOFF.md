# AML export: handoff notes

These notes are for the teammates building the staff-only dataset export for the AML tool. They record what the game stores today, where it lives in the code, and what an export will need that does not exist yet. The export format itself comes from the AML tool's input contract (`docs/cbn-input-contract.md` and its sample fixture in the OLG repo), which is **not** in this repo yet. Add it before mapping any fields.

## The game today

| Topic | Today | Where |
| --- | --- | --- |
| Stack | Python 3.11+, FastAPI, uvicorn; plain JavaScript frontend | `backend/app/`, `frontend/` |
| Identity | No sign-up and no staff. Each browser invents a guest token; the server derives an account id from it: `acc_` + the first 12 hex digits of SHA-256(token) | `backend/app/auth.py` |
| Roles | None. Every valid token is a player | `backend/app/auth.py`, `api.current_account` |
| Public identity | Other players see a `playerId` (hash of the account id) and a pilot name the player can set; neither is personal data | `backend/app/players.py` |
| Storage | In memory only. A restart wipes accounts, bets and history | `backend/app/ledger.py` (`InMemoryLedger`), `engine._finished` |
| History kept | The last 100 finished rounds (`HISTORY_KEEP`) | `backend/app/engine.py` |
| Money | Integer hundredths of a play credit (`10000` = 100.00 credits). The API sends strings with two decimals, such as `"100.00"` | `backend/app/money.py` |
| Multipliers | Integer hundredths (`247` = 2.47×) | `backend/app/money.py` |
| Time | Server clock in epoch milliseconds; sent as ISO-8601 UTC with milliseconds (`2026-10-15T18:04:12.350Z`) | `backend/app/clock.py` (`iso_ms`) |
| Currency | Play credits only. No deposits, withdrawals or real money | |

### What a bet records (`ledger.Bet`)

| Field | Type and unit | Notes |
| --- | --- | --- |
| `bet_id` | string, `b_<n>` | Counter restarts at 1 when the server restarts |
| `account_id` | string, `acc_<12 hex>` | Pseudonymous; no personal data behind it |
| `round_id` | string, `r_<n>` | Counter restarts at 1 when the server restarts |
| `wager` | int, hundredths of a credit | |
| `auto_cash_out` | int hundredths or null | Auto-eject target |
| `status` | `active`, `cashed-out` or `lost` | A refund after a failed round is a cash out at 1.00× |
| `multiplier` | int hundredths or null | Set when cashed out |
| `payout` | int hundredths or null | Set when cashed out |
| `auto` | bool | True when the server cashed out at the auto target |

### What a round records (`engine.Round`)

`round_id`, the crash point (hundredths), the server seed and its SHA-256 commitment, and the times boarding closed (`closes_at`), the rocket launched (`launched_at`) and it crashed (`crash_at`), all in epoch milliseconds.

## Gaps an AML export will hit

1. **No timestamps on bets.** Nothing records when a bet was placed or cashed out. The engine has the clock at both moments (`engine.place_bet`, `engine._apply_cash_out`), so they can be recorded there.
2. **Ids are not unique over time.** `b_<n>` and `r_<n>` restart at 1 after a restart.
3. **No player identity**, and no deposits or withdrawals, because the game uses play credits only.
4. **No staff accounts or roles**, so a server-side role check has nothing to check against yet.
5. **No permanent storage**, so there is nothing to export after a restart.

## Where to plug in

- **Storage:** `Ledger` in `backend/app/ledger.py` is an interface. A persistent implementation (for example SQLite, which ships with Python) can replace `InMemoryLedger` in one place: `create_app()` in `backend/app/main.py`.
- **Events:** every bet, cash out, crash and balance change already passes through `RoundEngine` (`place_bet`, `_apply_cash_out`, `crash`, `refill`), which is the natural place to record timestamps or an audit trail.
- **Routes:** add staff routes on their own `APIRouter` and include it in `create_app()`, the way `api.dev_router` is included only when enabled.
- **Tests:** `backend/tests/conftest.py` has fixtures for a manual clock, an engine and a test client.

## Decisions still open (for the AML owner)

- The contract file and sample fixture: add them to this repo.
- Storage: a local database such as SQLite, or something else.
- Staff sign-in: for example a staff key in an environment variable, or real staff accounts.

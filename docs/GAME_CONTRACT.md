# Game Contract

This is the plain-English contract between the game server and every client. The backend developer builds to this document, and the frontend developer reads from it.

It does not depend on any particular stack. It assumes only an **HTTP API** for commands and a **real-time channel** (WebSocket or SSE) for live updates.

Sections marked ⚠️ **Non-trivial** are the parts that are easy to get subtly wrong. Read those twice.

---

## 1. Ground rules

1. **The server owns the clock, the crash point and the balance.** The client never computes an outcome. It only animates what the server tells it.
2. **The crash point never leaves the server before the crash.** No API response or real-time event may include it, or anything it can be derived from (such as the unhashed seed), while a round is in flight.
3. **Every bet and cash-out request carries an idempotency key.** Sending the same request again must return the original result and must not apply it a second time.
4. **Money is stored as whole integers.** Balances and wagers are stored as integer *minor units* (1 credit = 100 units) to avoid floating-point errors. The API sends credits as strings with two decimals, for example `"100.00"`.
5. **Credits are play money.** Nothing here touches real payments.

---

## 2. Round state machine

Each round moves through the states below in order. One shared round runs at a time, and every connected player sees the same rocket.

```
          ┌──────────────────────────────────────────────────────────┐
          ▼                                                          │
 ┌──────┐   open bets    ┌─────────┐  window ends  ┌───────────┐  crash  ┌─────────┐  payouts done  ┌─────────┐
 │ idle │ ─────────────▶ │ betting │ ────────────▶ │ in-flight │ ──────▶ │ crashed │ ─────────────▶ │ settled │
 └──────┘                └─────────┘               └───────────┘         └─────────┘                └─────────┘
```

| State | What is happening | Player can | Server does on entry |
| --- | --- | --- | --- |
| `idle` | Between rounds. This state is brief or skipped, and it is the state when the server first boots. | Nothing | Generates the next server seed and computes the crash point. Stores both secretly. |
| `betting` | The betting window is open for `bettingWindowMs`. | **Place bet** (once per round), and set or clear auto cash out | Publishes `round.betting`, which includes the **commitment hash**. |
| `in-flight` | The multiplier climbs from 1.00× according to the growth curve. | **Cash out** (eject), once | Records the server start time. Publishes `round.launched`, then `round.tick` every `tickIntervalMs`. Runs auto cash outs. |
| `crashed` | The multiplier has reached the crash point. | Nothing | Publishes `round.crashed` with the crash point and the **revealed seed**. All bets that did not cash out are lost. |
| `settled` | Results are final and the history is updated. | Nothing (this lasts `settleDelayMs`) | Publishes `round.settled` and `history.updated`, then moves to `idle` or `betting`. |

**Transition rules**
- Only the server moves a round between states. No client request can advance the state.
- A bet is accepted only in `betting`. A cash out is accepted only in `in-flight`.
- If the crash point is exactly `1.00`, the round crashes the moment it launches. Nobody can cash out, and that is expected behaviour.

---

## 3. Configuration

All tunable values live in **one config file** (planned path: `config/game.config.*`). Values are read when the server starts. They must never be hard-coded in the engine or the UI.

| Key | Meaning | Example value | Notes |
| --- | --- | --- | --- |
| `minBet` | Smallest wager allowed, in credits | `1.00` | |
| `maxBet` | Largest wager allowed, in credits | `1000.00` | |
| `startingBalance` | Balance a new play account starts with | `1000.00` | Play credits only |
| `maxMultiplier` | Highest crash point the RNG can produce | `10000.00` | The brief calls this the "predefined maximum multiplier". Real games cap far above typical play (Stake: 1,000,000×); a low cap piles about 1% of rounds onto exactly the cap |
| `growthRate` | How fast the multiplier climbs: `m(t) = e^(growthRate × t)`, where t is in seconds | `0.06` | Bustabit's curve (`e^(0.00006 × ms)`). Every doubling takes the same 11.6 s: 2× at 11.6 s, 10× at 38.4 s, 100× at 76.8 s |
| `targetRtp` | Long-run return to player (1 − house edge) | `0.97` | Equivalent to a 3% house edge. The final value is **TBD** |
| `bettingWindowMs` | How long the betting window stays open | `5000` | |
| `settleDelayMs` | Pause after a crash before the next round | `3000` | |
| `tickIntervalMs` | How often `round.tick` is sent | `100` | Clients interpolate smoothly between ticks |
| `multiplierDecimals` | Decimal places for multipliers | `2` | Always round **down** (floor) |
| `autoCashOutMin` | Lowest auto cash out a player may set | `1.01` | |
| `defaultLanguage` | Language used when the client sends none | `"en"` | |
| `supportedLanguages` | Languages the client may request | `["en", "fr"]` | Strings live in a separate catalog, not here |
| `quickBetChips` | Shortcut wager buttons in the UI | `[10, 50, 100, 250]` | Display-only. The server still validates every bet |
| `realityCheckMinutes` | How often the reality-check reminder appears (0 = off) | `30` | **TBD** |

---

## 4. Crash point generation ⚠️ Non-trivial

The crash point must be **random, fixed before the round starts, and verifiable afterwards.** This is the "provably fair" design.

### 4.1 Per-round seed
- Before the round, generate `serverSeed`: 32 bytes from a **cryptographically secure** RNG, written as 64 hex characters. Do not use an ordinary `Math.random`-style generator.
- Compute `commitment = SHA-256(serverSeed)`, written as hex. Publish `commitment` in `round.betting`.
- Keep `serverSeed` secret until the round crashes.

### 4.2 From seed to crash point
```
h        = HMAC-SHA256(key = serverSeed, message = roundId)      // hex
r        = first 13 hex chars of h, as an integer                // 52 bits
u        = r / 2^52                                              // 0 ≤ u < 1
raw      = targetRtp / (1 − u)
crash    = min( maxMultiplier, max( 1.00, floor(raw × 100) / 100 ) )
```
- **Why this formula:** the chance that the crash point is at least `m` equals `targetRtp / m`. That means every cash-out target returns `targetRtp` on average, and the house edge holds whatever strategy the player uses.
- About 4% of rounds (when `targetRtp` is `0.97`: `1 − 0.97 / 1.01 ≈ 3.96%`) crash at exactly 1.00×. That is the house edge at work, not a bug.
- Encoding: the HMAC key and the SHA-256 input are the 64-character hex `serverSeed` as ASCII bytes; the message is `roundId` as UTF-8.
- Capping at `maxMultiplier` slightly lowers RTP for players aiming above the cap. Document this in the UI help. Whether to adjust for it is **TBD**.
- Mixing in a client seed so players can contribute to the randomness is **TBD** and out of scope for the MVP. If added, the message becomes `roundId:clientSeed`.

### 4.3 How a player verifies a round
1. Before launch, note the `commitment` hash shown in the Provably Fair panel.
2. After the crash, the server reveals `serverSeed`.
3. Check that `SHA-256(serverSeed)` equals the commitment you noted. This proves the seed was not changed.
4. Run the formula in 4.2 with `serverSeed` and `roundId`, and check that the result equals the crash point shown.
5. `GET /api/v1/rounds/{roundId}/verify` returns every input and the result, so the UI can run this check for the player. The check uses only public inputs, so anyone can repeat it independently.

---

## 5. Timing and cash-out resolution ⚠️ Non-trivial

- The server records `launchedAt`, its own clock reading at launch. The multiplier at any moment is `floor(e^(growthRate × elapsedSeconds) × 100) / 100`.
- The crash time is calculated in advance: `crashAtMs = launchedAt + ln(crash) / growthRate × 1000`.
- A cash out is judged by the **time the server receives it**, never by any time or multiplier the client reports:
  - If the receive time is before `crashAtMs`, the payout is `wager × m(receiveTime)`, rounded down to 2 decimals.
  - If the receive time is at or after `crashAtMs`, the request is rejected with `TOO_LATE` and the wager is lost.
- **Auto cash out** is handled on the server. When `m` reaches the player's target, the server cashes them out at exactly that target. It does this even if the player's connection has dropped.
- Network lag works against the player, which is normal for this genre. The UI should label the button with the live multiplier so expectations stay honest.

---

## 6. Accounts and balance ⚠️ Non-trivial

- Each play account holds `accountId`, `balanceUnits` (an integer) and `language`.
- **Placing a bet** debits the wager in the same atomic operation that records the bet. If the balance is too low, nothing changes.
- **Cashing out** credits the payout in the same atomic operation that marks the bet as cashed out. A bet can be cashed out only once.
- **A crash** marks every bet that did not cash out as lost. The balance is not touched, because the wager was already debited.
- How accounts are identified (an anonymous guest token or a simple sign-in) is **TBD**. Assume a bearer token in the `Authorization` header.

---

## 7. Idempotency ⚠️ Non-trivial

- The client generates a unique `Idempotency-Key` (a UUID v4) for **each** bet or cash-out *attempt* and sends it in the request header.
- The server stores `(accountId, key) → response` for at least the life of the round.
- If the same key arrives again with the **same** body, the server returns the stored response with the same status and body. It does not repeat the side effect.
- If the same key arrives with a **different** body, the server rejects it with `409 IDEMPOTENCY_KEY_REUSED`.
- Two different keys sending a second bet in the same round are rejected with `ALREADY_BET`. Two different keys sending a second cash out return the original cash-out result. They never pay twice.

---

## 8. HTTP API (proposed)

Base path: `/api/v1`. All bodies are JSON. Credits are strings with 2 decimals, and multipliers are numbers with 2 decimals.

### 8.1 Get account
`GET /api/v1/account`
```json
{
  "accountId": "acc_7Hq2",
  "balance": "1000.00",
  "currency": "credits",
  "language": "en"
}
```

### 8.2 Get current round
`GET /api/v1/rounds/current`
```json
{
  "roundId": "r_48213",
  "state": "in-flight",
  "commitment": "9f2c4e1ab07d3c58e6f1a2b9d4c7e03f5a8b16d2c9e4f7a0b3d6c1e8f5a2b9c4",
  "launchedAt": "2026-10-15T18:04:12.350Z",
  "growthRate": 0.12,
  "serverTime": "2026-10-15T18:04:15.910Z",
  "myBet": { "wager": "100.00", "autoCashOut": 2.00, "status": "active" }
}
```
`serverTime` allows the client to correct for the difference between its clock and the server's. `crash` and `serverSeed` are **absent** until the round has crashed.

### 8.3 Place bet
`POST /api/v1/rounds/{roundId}/bets`
Headers: `Idempotency-Key: 3b1f8c2e-6a4d-4e0b-9b7a-2f5c1d8e4a90`
```json
{ "wager": "100.00", "autoCashOut": 2.00 }
```
`201 Created`
```json
{
  "betId": "b_99a1",
  "roundId": "r_48213",
  "wager": "100.00",
  "autoCashOut": 2.00,
  "status": "active",
  "balance": "900.00"
}
```

### 8.4 Cash out
`POST /api/v1/rounds/{roundId}/cashout`
Headers: `Idempotency-Key: 7d2e9a41-0c3b-4f6e-8a5d-1b9c2e7f4a63`
Body: `{}`
`200 OK`
```json
{
  "betId": "b_99a1",
  "status": "cashed-out",
  "multiplier": 2.47,
  "payout": "247.00",
  "profit": "147.00",
  "balance": "1147.00"
}
```

### 8.5 History
`GET /api/v1/history?limit=20`
```json
{
  "rounds": [
    { "roundId": "r_48212", "crash": 1.84, "myResult": { "wager": "100.00", "status": "lost", "profit": "-100.00" } },
    { "roundId": "r_48211", "crash": 3.12, "myResult": { "wager": "100.00", "status": "cashed-out", "multiplier": 2.47, "profit": "147.00" } },
    { "roundId": "r_48210", "crash": 12.40, "myResult": null }
  ]
}
```

### 8.6 Verify a round
`GET /api/v1/rounds/{roundId}/verify` (only after the round has crashed)
```json
{
  "roundId": "r_48212",
  "commitment": "9f2c4e1a…b9c4",
  "serverSeed": "c41e7b9a…02fd",
  "hmac": "5e0b3c…",
  "targetRtp": 0.97,
  "maxMultiplier": 100.00,
  "crash": 1.84,
  "valid": true
}
```

### 8.7 Errors
Every error uses one shape. `message` is English text for logs. The UI translates `code` through the string catalog.
```json
{ "error": { "code": "TOO_LATE", "message": "Round crashed before cash-out was received." } }
```
| Code | HTTP | When |
| --- | --- | --- |
| `BET_WINDOW_CLOSED` | 409 | Bet placed outside `betting` |
| `BET_OUT_OF_RANGE` | 422 | Wager below `minBet` or above `maxBet` |
| `INSUFFICIENT_BALANCE` | 422 | Wager is more than the balance |
| `ALREADY_BET` | 409 | A second bet in the same round |
| `NO_ACTIVE_BET` | 409 | Cash out with no active bet |
| `TOO_LATE` | 409 | Cash out received at or after the crash |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same key, different body |
| `UNAUTHORIZED` | 401 | Missing or invalid token |

---

## 9. Real-time events (proposed)

Every event uses one envelope. `seq` increases by one with each event, so a client can tell when it has missed something and should resync through `GET /rounds/current`.

```json
{ "type": "round.tick", "seq": 18233, "roundId": "r_48213", "data": { } }
```

| Event | Sent to | When |
| --- | --- | --- |
| `round.betting` | Everyone | The betting window opens |
| `round.launched` | Everyone | The rocket lifts off |
| `round.tick` | Everyone | Every `tickIntervalMs` while in flight |
| `round.cashout` | That player only | That player's cash out (manual or auto) was accepted |
| `round.crashed` | Everyone | The crash point is reached |
| `round.settled` | Everyone | Results are final |
| `balance.updated` | That player only | That player's balance changed |
| `history.updated` | Everyone | A round was added to the history |

`round.betting`
```json
{ "type": "round.betting", "seq": 18200, "roundId": "r_48213",
  "data": { "commitment": "9f2c4e1a…b9c4", "closesAt": "2026-10-15T18:04:12.350Z" } }
```

`round.launched`
```json
{ "type": "round.launched", "seq": 18201, "roundId": "r_48213",
  "data": { "launchedAt": "2026-10-15T18:04:12.350Z", "growthRate": 0.12 } }
```

`round.tick`
```json
{ "type": "round.tick", "seq": 18233, "roundId": "r_48213",
  "data": { "multiplier": 1.47, "elapsedMs": 3210 } }
```

`round.cashout` (private)
```json
{ "type": "round.cashout", "seq": 18240, "roundId": "r_48213",
  "data": { "betId": "b_99a1", "multiplier": 2.47, "payout": "247.00", "auto": false } }
```

`round.crashed`
```json
{ "type": "round.crashed", "seq": 18262, "roundId": "r_48213",
  "data": { "crash": 3.86, "serverSeed": "c41e7b9a…02fd", "commitment": "9f2c4e1a…b9c4" } }
```

`balance.updated` (private)
```json
{ "type": "balance.updated", "seq": 18263, "data": { "balance": "1147.00", "reason": "cashout" } }
```

`history.updated`
```json
{ "type": "history.updated", "seq": 18264,
  "data": { "round": { "roundId": "r_48213", "crash": 3.86 } } }
```

---

## 10. Open questions

| Question | Status |
| --- | --- |
| Final `targetRtp` / house edge | **TBD** |
| Account identity (guest token or sign-in) | **TBD** |
| Mixing in a client seed | **TBD**, not in MVP |
| WebSocket or SSE | **TBD**, decided together with the stack |
| Whether history is stored across server restarts | **TBD** |

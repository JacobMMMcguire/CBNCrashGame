# How it works: multiplayer rooms

This page describes the multiplayer code on the `multiplayer-lobby` branch **as it is written**: hosting a room, the leaderboard and the QR join. To run it with real phones, see [LOCAL_SETUP.md](../LOCAL_SETUP.md).

Everything uses **play money only**. There are no deposits, payments or prizes, and every room page shows a "Play money" banner.

Conventions used below:
- Money is stored as **integer units**, where 1 play credit = 100 units. JSON shows credits as strings with two decimals (`"18.20"`). Multipliers are stored as **integer hundredths** (182 = 1.82×).
- Every message the server sends on a room socket has the envelope `{type, seq, roundId?, data}`. `seq` counts up by 1 per connection.
- "The design" means the brief this branch was built from. Each section ends with **Differences from the design**.

---

## Hosting Multiplayer

### Files

| File | Role |
| --- | --- |
| `backend/app/rooms.py` | `RoomRegistry` creates rooms and finds them by code. `Room` owns one round engine, a ledger, an idempotency store, a broadcaster and the seats. It also handles tokens, seat holds, host controls and lobby messages. |
| `backend/app/rooms_api.py` | HTTP routes (`/api/v1/rooms…`), the room WebSocket, message handling and the `/host` and `/join` pages. |
| `backend/app/commands.py` | `place_bet`, `cash_out` and `run_idempotent`. The single-player HTTP routes (`api.py`) and the room WebSocket both call these, so there is one copy of the logic. |
| `backend/app/engine.py` | The existing `RoundEngine`. Rooms construct it with `round_prefix="K7QX-"`. |
| `backend/app/recording_ledger.py` | Wraps the in-memory ledger and writes every bet, cash-out and loss to the event log. |
| `backend/app/storage.py` | The `Storage` interface with `SQLiteStorage`, `InMemoryStorage` and a `SupabaseStorage` placeholder. |
| `backend/app/settings.py` | The `.env` loader, `PUBLIC_BASE_URL`, `STORAGE_BACKEND`, `SEAT_HOLD_SECONDS` and `MAX_PLAYERS_PER_ROOM`. |
| `backend/app/realtime.py` | `Broadcaster`, a per-connection queue and `seq`. Each room has its own instance. |
| `backend/app/main.py` | Wires the registry into the app and starts the seat sweeper. On shutdown it closes the rooms. |
| `frontend/host.html`, `frontend/js/room/host.js` | The host screen. |
| `frontend/join.html`, `frontend/js/room/join.js` | The phone page. |
| `frontend/js/room/socket.js` | The room WebSocket client: hello, replies matched by `ref`, and reconnect with backoff. |
| `frontend/js/room/round.js` | Turns server events into the multiplier, phase and recent crashes on screen. |
| `backend/tests/test_rooms.py` | Tests for hosting, joining, names, host controls, payouts, the event log and reconnecting. |

### Room creation

`POST /api/v1/rooms` (no body) makes `RoomRegistry.create_room()`:

1. It picks a **4-character code** from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, which leaves out 0/O and 1/I/L because people read the code off a screen. A code is never reused: it is checked against the live rooms **and** every room in storage. The code is also the room's `room_id`.
2. It makes a **host token** with `secrets.token_urlsafe(32)` (256 random bits) and stores only its SHA-256 hash.
3. It writes a `rooms` row, then builds the `Room`:
   - its own `RoundEngine`, which draws round 1's crash point right away;
   - its own `InMemoryLedger` wrapped in a `RecordingLedger`;
   - its own idempotency store and `Broadcaster`;
   - an empty seat list.
4. Response `201`: `{roomCode, hostToken, publicBaseUrl, playMoney: true}`. The host page saves `hostToken` in `localStorage` under `ascent-host:<code>` and changes its URL to `/host?room=<code>`, so a reload reconnects as host.

### WebSocket connections

Endpoint: `GET /api/v1/rooms/{code}/ws`. The room code is in the path. The token goes in the **first message**, not the URL, so it never appears in access logs:

```json
{"type": "hello", "role": "host",   "token": "<host token>"}
{"type": "hello", "role": "player", "token": "<session token>"}
```

The server accepts the socket and waits up to 10 s for the hello.
- **Host:** `hmac.compare_digest(sha256(token), room.host_token_hash)`.
- **Player:** looks up `sha256(token)` in storage. The player must belong to **this** room and still hold an active seat.

Close codes:

| Code | Meaning | What the page does |
| --- | --- | --- |
| `4401` | No hello, bad token, wrong room, or the seat was released | Phone: forget the token and show the name form. Host: forget the token and show "Host a game". |
| `4403` | The host removed this player | Shows "The host removed you". |
| `4404` | No open room with that code | Shows "Room not found". |
| `4408` | Client too slow to read its messages (the queue filled up) | Reconnects. |

After the hello, the connection is registered with the room's broadcaster, using `account_id = player_id` for players and `None` for the host. The server tracks who is connected **per seat**: `Seat.connections` counts open sockets, and `Seat.disconnected_at_ms` records when the last one closed. The first message is always a `welcome` with the full state:

```json
{"type": "welcome", "seq": 1, "data": {
  "role": "player",
  "room": {"roomCode": "K7QX", "locked": false, "started": true, "publicBaseUrl": "http://192.168.1.23:8001", "playMoney": true},
  "you": {"playerId": "p_3f9c0a1b2c3d4e5f", "name": "Ana", "balance": "990.00"},
  "round": {"roundId": "K7QX-r_4", "state": "betting", "closesAt": "…", "myBet": {"wager": "10.00", "autoCashOut": null, "status": "active"}, "…": "…"},
  "history": [{"roundId": "K7QX-r_3", "crash": 3.12}],
  "config": {"minBet": "1.00", "maxBet": "1000.00", "quickBetChips": ["10.00", "50.00", "100.00", "250.00"], "…": "…"},
  "lobby": {"roomCode": "K7QX", "locked": false, "started": true, "players": [{"playerId": "p_…", "name": "Ana", "connected": true}]},
  "leaderboard": {"basis": "balance", "label": "Balance (play credits)", "entries": ["…"]},
  "serverTime": "…"}}
```

For the host, `you` is `null`. `round` is the same snapshot as `GET /api/v1/rounds/current`.

### Messages between server and phones

Client → server (each can carry a `ref`; the server echoes it in the reply):

| Message | Who | Fields |
| --- | --- | --- |
| `place_bet` | player | `roundId`, `wager` (`"10.00"`), optional `autoCashOut` (2.0), `idempotencyKey` (UUID v4) |
| `cash_out` | player | `roundId`, `idempotencyKey` |
| `start` | host | – |
| `lock` | host | `locked`: `true` or `false` |
| `kick` | host | `playerId` |

Every action gets exactly one reply, shaped like an HTTP response:

```json
{"type": "reply", "seq": 9, "data": {"ref": "7", "action": "cash_out", "status": 200,
  "body": {"betId": "b_12", "status": "cashed-out", "multiplier": 1.82, "payout": "18.20", "profit": "8.20", "balance": "1008.20"},
  "replayed": false}}
```

Errors use the same `{"error": {"code", "message"}}` body as HTTP. Unknown message types get `422 INVALID_REQUEST`. Room-specific codes are `ROOM_NOT_FOUND`, `ROOM_LOCKED`, `ROOM_FULL`, `NAME_TAKEN` and `FORBIDDEN`.

Server → clients:

| Event | To | When |
| --- | --- | --- |
| `round.betting` | everyone | Betting opens. Carries `closesAt`. |
| `round.launched` | everyone | Flight starts. |
| `round.tick` | everyone | Every `tickIntervalMs` (100 ms) with the server's multiplier. |
| `round.crashed` | everyone | Carries the crash point and the revealed seed. |
| `round.settled`, `history.updated` | everyone | The round is finished. |
| `balance.updated` | that player only | After their bet or cash-out. |
| `round.cashout` | that player only | Their manual or auto cash-out was applied. |
| `lobby.updated` | everyone | Join, connect, disconnect, kick, seat expiry, lock or start. |
| `leaderboard.updated` | everyone | See [Leaderboard](#leaderboard). |

### The round loop and its phases

When the host sends `start`, `Room.start()` sets `started` and creates one asyncio task running `engine.run_forever()`, which is the same loop as single-player. From then on the server alone drives the round:

1. **idle → betting:** the server opens betting for `bettingWindowMs` (5 s). `round.betting` carries `closesAt`.
2. **betting → in-flight:** at `closesAt` the server launches, records `launched_at`, and computes `crash_at = launched_at + ln(crash)/growthRate`.
3. **Ticks:** every 100 ms it sends `round.tick` with `m(t) = floor(e^(growthRate·t) · 100)` and runs any auto cash-outs that have been reached.
4. **Crash:** at `crash_at` the round becomes `crashed`. Auto targets below the crash are paid, every other active bet is marked `lost`, and the crash point and seed are revealed.
5. **Settle:** `round.settled`, then the room's leaderboard step (below), then `history.updated`.
6. **Pause and repeat:** after `settleDelayMs` (3 s) the server draws the next round's sealed crash point and returns to step 1.

Phones only send `place_bet` and `cash_out`. Each message is handled on the event loop, the same thread as the round loop, so a command cannot interleave with a tick.

### Server-side fairness

- The crash point is drawn by the room's `CrashPointProvider` **when the round is created**, before betting opens. It is sealed in `RoundSecret`, whose `repr` hides it, and it is never sent before `round.crashed`.
- A cash-out is judged at the moment the server **handles the message**: `engine.cash_out()` reads `clock.now_ms()`. If that is before `crash_at`, the player is paid `floor(wager × m(now))`. Otherwise the reply is `TOO_LATE`. The phone never sends a multiplier and the server never reads one.
- The **same** `commands.place_bet` / `commands.cash_out` / `commands.run_idempotent` functions serve HTTP and WebSocket, so the validation, limits, ledger calls and idempotency keys are identical. A retried tap with the same `idempotencyKey` returns the stored reply (`"replayed": true`) and moves no money. The same key with a different request returns `409 IDEMPOTENCY_KEY_REUSED`. The phone reuses its key for a given round and action until it gets a reply.

### Shared round_id

Each room's engine is built with `round_prefix = "<code>-"`, so every player in the room sees the same id, for example `K7QX-r_1`, `K7QX-r_2`. Ids never collide across rooms because codes are never reused. Bet ids `b_N` come from **one counter shared by all rooms**, which starts after the highest bet id already in storage, so they stay unique across rooms and restarts.

### Host controls

`start`, `lock` and `kick` are accepted only on a socket whose hello carried the room's host token; a player socket gets `403 FORBIDDEN`.

| Control | Effect |
| --- | --- |
| **Start** | Starts the round loop once. A second Start does nothing. |
| **Lock** | New joins get `409 ROOM_LOCKED`. Players already in the room can still reconnect. Unlock reverses it. |
| **Kick** | Marks the seat `kicked` in memory and storage, closes the player's sockets with `4403`, and removes them from the lobby and the leaderboard. Their session token stops working, and their name becomes free again. |

### Reconnecting

1. When a phone's last socket closes, the server sets `disconnected_at_ms` and broadcasts `lobby.updated` with `connected: false`. The host shows the player as "reconnecting…".
2. The seat (name, balance and any active bet) is held for `SEAT_HOLD_SECONDS` (default 120 s). Bets in flight resolve as normal: auto cash-out, otherwise lost.
3. When the page reopens, `join.js` finds `ascent-session:<code>` in `localStorage` and sends it in the hello. The server finds the same `player_id`, and the `welcome` carries the same balance and the current round, including the player's own `myBet`. The socket client also reconnects by itself after network drops, when the tab becomes visible again, and whenever it notices a gap in `seq`.
4. If the hold runs out, the seat becomes `expired` and the token stops working (`4401`). The phone then asks for a name again. Expiry is checked by a sweeper every 5 s, after every round, and on every reconnect attempt.

### The event log

`RecordingLedger` sits between the engine and the in-memory ledger. **Reads** (`get_account`, `get_bet`, `bets_for_round`) go to memory, because the engine calls them on every tick. Only the three money operations also write to storage, one row each in `ledger_events`:

| Column | Example (cash-out) | Notes |
| --- | --- | --- |
| `event_id` | 3 | Autoincrement |
| `room_id` | `K7QX` | |
| `round_id` | `K7QX-r_1` | |
| `player_id` | `p_3f9c0a1b2c3d4e5f` | |
| `bet_id` | `b_12` | |
| `kind` | `cashout` | `bet`, `cashout` or `lost` |
| `timestamp_ms` | 1790000005000 | Server clock, epoch ms |
| `wager_units` | 1000 | 10.00 credits |
| `amount_units` | 1820 | Bet: wager debited. Cash-out: payout credited. Lost: 0. |
| `multiplier_hundredths` | 182 | Cash-outs only. Otherwise null. |
| `auto` | 0 | 1 if the server cashed out at the player's target |
| `balance_after_units` | 100820 | |

After a bet or cash-out, the player's `players.balance_units` is also updated. Amounts are in **units and hundredths, exactly as the ledger stores them**. The staff export for the AML tool is **not built yet**: it will read `ledger_events` and convert units to dollars (÷ 100) when it writes its file.

### What is stored

| Where | What |
| --- | --- |
| Storage (`STORAGE_BACKEND`: SQLite by default, `data/ascent.sqlite3`) | `rooms` (code, host-token hash, created time, locked, open/closed); `players` (id, room, name, session-token hash, joined time, last balance, active/kicked/expired); `ledger_events` (above). Tokens are stored only as SHA-256 hashes. |
| Memory only | The live `Room` objects: engine and current round, in-memory ledger (the authoritative balances), idempotency keys, seats and connection counts, sockets. |

**Run exactly one server process.** Rooms, round loops and sockets live in the process's memory: two uvicorn workers or two instances would mean two different games. When the server restarts, every live room ends. At startup, rooms left `open` are marked `closed`, and their rows stay for the export. A phone from before the restart gets `4404` and can join a new room.

### Flow

1. The host opens `/host` and clicks **Host a game**, which sends `POST /api/v1/rooms`. The server returns the code and host token, and the host page stores the token.
2. The host page opens `/api/v1/rooms/K7QX/ws` and sends `hello` (host). The server replies with `welcome`.
3. Players join (see [QR Code](#qr-code)). Each phone opens the socket and sends `hello` (player). The host sees `lobby.updated`.
4. The host clicks **Start**. The server starts the room's round loop and everyone receives `round.betting` with the same `roundId`.
5. A phone sends `place_bet`. The server debits, logs a `bet` row, and replies `201` plus a private `balance.updated`.
6. The server launches and sends ticks. A phone sends `cash_out`, and the server pays at its own clock's multiplier, logs a `cashout` row, and replies `200`.
7. At the crash, the server marks unpaid bets `lost` (logging `lost` rows), then settles, recomputes the leaderboard, waits 3 s and opens the next round.
8. A phone drops and comes back within the seat hold. Its hello with the stored session token gets back the same seat and balance.

### Differences from the design

- **No stop or end-room control.** After Start, rounds run until the server stops. Lock only blocks new joins.
- **Host controls are checked once per socket.** The host token is checked at hello, and the socket's role decides later commands; the token is not re-sent with every command.
- **Live rooms do not survive a restart.** Storage keeps the rows for the export, but rooms are not rebuilt from them.
- **Crash points are still the SKELETON ONLY stub.** Every room cycles through the same fixed list (1.84, 3.12, 1.00, 2.47, …), so outcomes are predictable. This branch deliberately does not replace it. A real RNG is needed before any demo.
- **The phone page has no auto cash-out field yet.** `place_bet` accepts `autoCashOut` and the server enforces it.
- **RoundId pattern widened.** The schema's `RoundId` changed from `^r_\d+$` to `^([A-Z0-9]{4}-)?r_\d+$`, so room ids can carry the code. Single-player ids are unchanged.
- **Extra event-log fields:** `bet_id`, `kind` (including `lost` rows), `auto` and `balance_after_units`.

---

## Leaderboard

### Files

| File | Role |
| --- | --- |
| `backend/app/leaderboard.py` | `rank()`: sorting and tie handling. Also defines `BASIS = "balance"` and `LABEL = "Balance (play credits)"`. |
| `backend/app/rooms.py` | `Room.after_round_settled`, `leaderboard_entries`, `refresh_leaderboard` and `on_roster_changed`. |
| `frontend/js/room/leaderboard.js` | Draws the rows the server sent and marks the viewer's own row. |
| `frontend/host.html`, `frontend/join.html`, `frontend/css/room.css` | A large board on the host screen and a compact board on the phone. |
| `backend/tests/test_leaderboard.py` | Tests for ordering, ties, newcomers, update timing and fake messages. |

### What is ranked and why

Players are ranked by **wallet balance in play credits**, labelled **"Balance (play credits)"** on both screens. Everyone starts with the same `startingBalance` (1000.00), so ranking by balance and by profit gives the same order. Balance is the number each player already sees on their own phone.

The balance used is the server's ledger balance **as of the last settled round**. A wager that is still in flight, or a cash-out in a round that has not settled yet, does not move the board until settle. This keeps the board steady during flight and changes it once per round.

### When updates are sent

`Room.refresh_leaderboard()` recomputes the entries and broadcasts **only if they differ from the last entries sent**. It is called:
- after each round's payouts, from `after_round_settled`, which runs on `round.settled` after every cash-out and loss of the round has been applied;
- when the roster changes: a player joins, is kicked, or their seat expires.

A round in which nobody bet changes nothing, so nothing is sent. Every connection also gets the current board in its `welcome`, whether or not it changed.

### What the message contains

```json
{"type": "leaderboard.updated", "seq": 31, "data": {
  "basis": "balance",
  "label": "Balance (play credits)",
  "playMoney": true,
  "afterRoundId": "K7QX-r_3",
  "entries": [
    {"rank": 1, "playerId": "p_…", "name": "Ana", "balance": "1082.00"},
    {"rank": 2, "playerId": "p_…", "name": "Cat", "balance": "1000.00"},
    {"rank": 2, "playerId": "p_…", "name": "Dev", "balance": "1000.00"},
    {"rank": 4, "playerId": "p_…", "name": "Ben", "balance": "900.00"}
  ]}}
```

`afterRoundId` is the last settled round, or `null` before the first one.

### Ties and new joiners

- **Ties share a rank** using standard competition ranking: 1, 2, 2, 4. Within a tie, players are listed in the order they joined.
- **New joiners** enter with the starting balance (they have no settled round yet). A newcomer is listed **after** everyone already holding the same balance, so before any round is played, players appear at the bottom in join order.

### Why the server is the only source of truth

The ranking is computed only on the server, from its own ledger. No client message can set a balance, a rank or a name after joining. Phones can send only `place_bet` and `cash_out`, and anything else (`set_rank`, a fake `leaderboard.updated`) gets `422 INVALID_REQUEST`. The page draws the rows exactly as received and never sorts them; the only thing it does locally is highlight the row whose `playerId` matches its own.

On the host screen the board is large (one row per player, about 22 px text). On a phone it is compact: it shows the top 5 and always includes the player's own row, outlined in amber and labelled "(you)".

### Flow

1. A player joins. The roster changes, the board is recomputed (newcomer at 1000.00), and `leaderboard.updated` goes to everyone.
2. During a round, bets and cash-outs change ledger balances, but the board is not recomputed.
3. The round crashes, then settles. `after_round_settled` copies each seated player's ledger balance into the settled snapshot.
4. `refresh_leaderboard()` ranks the snapshot. If the entries changed, it broadcasts `leaderboard.updated`. Otherwise it sends nothing.
5. Phones and the host redraw from the message.

### Differences from the design

- **"New players appear at the bottom with their starting balance"** holds before anyone has lost. Because the ranking is by balance, a newcomer at 1000.00 ranks **above** players who have dropped below 1000.00. Among players tied at 1000.00, the newcomer is last.
- Players whose seat expired, or who were kicked, are removed from the board.

---

## QR Code

### Files

| File | Role |
| --- | --- |
| `frontend/js/room/host.js` | `joinUrl()` builds the link. `renderJoin()` draws the QR code, the room code and the link, and shows a warning when the link is localhost. |
| `frontend/js/room/qr.js` | Builds an SVG from the encoder's module matrix. |
| `frontend/vendor/qrcode-generator/` | qrcode-generator 1.4.4 (MIT), vendored unchanged, with `LICENSE` and a README giving the source and SHA-256. |
| `frontend/join.html`, `frontend/js/room/join.js` | The phone page: code entry, name form, play view. |
| `backend/app/rooms_api.py` | `GET /join`, `GET /join/{code}` (lowercase codes redirect to uppercase), `GET /api/v1/rooms/{code}`, `POST /api/v1/rooms/{code}/players`. |
| `backend/app/rooms.py` | `Room.join`, `clean_name`, `name_key`; token and id creation. |
| `backend/app/settings.py` | `PUBLIC_BASE_URL`. |
| `backend/tests/test_qr_join.py`, `backend/tests/test_rooms.py` | Tests for pages, the encoder, the base URL, joining and names. |

### How the link and QR are generated

1. The server reads `PUBLIC_BASE_URL` from `.env` or the environment at startup (default `http://localhost:8001`, trailing `/` removed). It returns this value in `POST /api/v1/rooms` and in the host's `welcome.room.publicBaseUrl`.
2. The host page builds the link **in the browser**: `` `${publicBaseUrl}/join/${code}` ``, for example `http://192.168.1.23:8001/join/K7QX`.
3. `qr.js` asks the vendored encoder for the smallest QR version that fits, at error-correction level M. It reads the dark modules and builds an `<svg>` (one path, black on white, quiet zone included) with DOM calls, so no HTML string is inserted. It is drawn black on white in both themes because scanners need that contrast.
4. Under the QR code, the page shows the **room code** in large type and the full link, so a player can type either one. If the link's host is `localhost` or `127.0.0.1`, the page shows a warning that phones cannot open it.

The encoder works with no internet connection; nothing is fetched from a CDN. During development the output was checked by decoding generated codes for a LAN link, an https link and a localhost link back to the exact URLs.

### What happens on scan

1. The phone camera opens `http://<PUBLIC_BASE_URL host>/join/K7QX` in the browser. No app is needed.
2. The server returns `join.html`. The page reads the code from the path and calls `GET /api/v1/rooms/K7QX`.
   - `404`: the page shows "There is no open room with that code".
   - `200`: the page shows "Room K7QX" and "You start with 1,000.00 play credits".
3. If this device already has `ascent-session:K7QX` in `localStorage`, it skips the form and reconnects (see [Reconnecting](#reconnecting)). Otherwise it shows the name form.

`/join` without a code shows a code-entry form, which goes to `/join/<CODE>`.

### The join and the name check

The phone sends `POST /api/v1/rooms/K7QX/players` with `{"name": "Ana"}`. `Room.join`:

1. Cleans the name: trims it and collapses inner spaces. It must be 1–16 characters, and control or invisible characters are rejected (`422 INVALID_REQUEST`).
2. Rejects the join if the room is locked (`409 ROOM_LOCKED`) or already holds `MAX_PLAYERS_PER_ROOM` active players (`409 ROOM_FULL`).
3. **Checks the name is unique among the room's active seats**, ignoring case, spacing and Unicode compatibility forms (NFKC + casefold). "Ana", "ana" and " ANA " clash: `409 NAME_TAKEN`. The same name in a different room is fine. A name is freed when its seat is kicked or expires.

### How player_id and the session token are created

- `player_id = "p_" + secrets.token_hex(8)`: random and stable for the life of the seat. It is also the ledger account id and the `player_id` in the event log.
- `session token = secrets.token_urlsafe(32)` (256 random bits). The server stores only `sha256(token)` in `players.session_token_hash`. A token made up by the client is never accepted.
- The ledger account is created with the dummy `startingBalance` (play credits).
- Response `201`: `{roomCode, playerId, name, sessionToken, balance: "1000.00", playMoney: true}`. The phone keeps the token in `localStorage` (`ascent-session:K7QX`) and opens the room socket with it.

### How the lobby updates

`Room.join` broadcasts `lobby.updated` straight away, so the new player appears on the host screen with `connected: false`. When the phone's socket says hello, a second `lobby.updated` shows them `online`. The leaderboard gains their row at the same moment as the join. Everyone who used the same code is in the same `Room`, because there is exactly one live room per code.

### Phone UI

The phone page is a single column at most 480 px wide.
- **Play-money label:** a sticky "Play money" banner at the top, and the balance labelled "play credits".
- **Wager:** a 56 px-tall input and quick-bet chips.
- **Main button:** one 84 px button that is always reachable at the bottom. It changes between **Place bet · 10.00**, **CASH OUT** (green) and waiting states.
- **Leaderboard:** the compact board, with the player's own row outlined.
- **Motion:** respects reduced-motion settings.

Strings are in EN and FR (`frontend/locales`).

### How PUBLIC_BASE_URL changes between local and hosted use

| Where it runs | `PUBLIC_BASE_URL` | `ASCENT_HOST` |
| --- | --- | --- |
| Just this laptop (no phones) | `http://localhost:8001` (default) | `127.0.0.1` (default) |
| Laptop + phones on the same Wi-Fi | `http://<laptop LAN IP>:8001`, e.g. `http://192.168.1.23:8001` (from `ipconfig`) | `0.0.0.0` |
| Phone hotspot | `http://<laptop IP on the hotspot>:8001` | `0.0.0.0` |
| Tunnel (e.g. Cloudflare Tunnel, ngrok) | The tunnel's `https://…` URL | `127.0.0.1` is enough |
| Hosted (e.g. Render, later) | The public `https://…` URL | The platform's setting |

Only the link and QR code depend on it. The pages always call the API and WebSocket on whatever host served them, using `wss://` automatically under https, so nothing else changes. At startup the server prints the address it guesses for the LAN.

### Flow

1. The host screen receives `publicBaseUrl` and builds `<PUBLIC_BASE_URL>/join/K7QX`.
2. The browser draws it as an SVG QR code with the code `K7QX` underneath.
3. A player scans it, and the phone browser opens `/join/K7QX`, where the page checks `GET /api/v1/rooms/K7QX`.
4. The player types a name, which sends `POST /api/v1/rooms/K7QX/players`. The server checks the name and lock, creates `player_id`, the session token and a 1000.00 play balance, and writes a `players` row.
5. The host screen gets `lobby.updated` and `leaderboard.updated`, and the player appears.
6. The phone stores the token and opens the socket with `hello`. It receives `welcome`, and the host sees the player go `online`.

### Differences from the design

- **Default port is 8001.** The original brief said `http://localhost:8000`. The repo's port 8001 was kept by decision, so the default `PUBLIC_BASE_URL` is `http://localhost:8001`.
- **Binding to 0.0.0.0 is opt-in.** The server's built-in default stays `127.0.0.1`. `.env.example` sets `ASCENT_HOST=0.0.0.0`, so copying it to `.env` (as LOCAL_SETUP.md says) makes the server listen on the LAN.
- **Names are limited to 16 characters**, and duplicate checks ignore case and spacing.

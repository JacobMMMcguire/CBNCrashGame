# Local setup: multiplayer on Windows

How to run Ascent on a Windows laptop and play multiplayer from phones on the same Wi-Fi. Every command is for **Windows PowerShell**, run from the repository folder. Play money only: there are no payments anywhere.

For how the multiplayer code works, see [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

## 1. Install (once)

You need **Python 3.11 or newer** ([python.org/downloads](https://www.python.org/downloads/); tick "Add python.exe to PATH" in the installer) and **Git**.

```powershell
git clone https://github.com/JacobMMMcguire/CBNCrashGame.git
cd CBNCrashGame
git checkout multiplayer-lobby
```

The dev script below creates `.venv` and installs `requirements.txt` the first time it runs. To do it by hand instead:

```powershell
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python scripts\check_env.py
```

## 2. Configure `.env`

```powershell
Copy-Item .env.example .env
```

Find the laptop's LAN address, the IPv4 address of the Wi-Fi adapter:

```powershell
(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi").IPAddress
```

If that prints nothing (some adapters have another name), run `ipconfig` and read **IPv4 Address** under "Wireless LAN adapter Wi-Fi". It looks like `192.168.1.23` or `10.0.0.42`.

Open `.env` and set these two lines (use your address; keep port 8001):

```powershell
notepad .env
```

```ini
ASCENT_HOST=0.0.0.0
PUBLIC_BASE_URL=http://192.168.1.23:8001
```

- `ASCENT_HOST=0.0.0.0` makes the server listen on the network, not just this laptop.
- `PUBLIC_BASE_URL` is the address the QR code points to. If it says `localhost`, phones cannot open it, and the host screen shows a warning.
- `.env` is git-ignored. Never commit it. Nothing in it is secret today, but Supabase keys will go here later.

The server reads `.env` only at startup, so restart it after every change.

## 3. Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

The server prints something like:

```
Ascent skeleton: game at http://0.0.0.0:8001/app/  (mock mode: /app/?mock=1)
Multiplayer: host screen at http://0.0.0.0:8001/host  (join links use PUBLIC_BASE_URL=http://192.168.1.23:8001, storage=sqlite)
```

Stop it with **Ctrl+C**.

Run **one** server process only. Rooms and rounds live in its memory, so never add `--workers`. Restarting the server (including `-Reload` picking up a code change) ends every live room.

### The Windows Firewall prompt

The first time the server listens on `0.0.0.0`, Windows Defender Firewall asks whether **python.exe** may communicate on networks:

1. Tick **Private networks** (home or work Wi-Fi). Leave **Public networks** unticked unless you are on a network you trust.
2. Click **Allow access**.

For this to work, the Wi-Fi must be marked **Private**. Check it:

```powershell
Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory
```

If it says `Public`, go to **Settings → Network & internet → Wi-Fi → (your network) → Network profile type → Private**.

If you clicked **Cancel** or never saw the prompt, add a rule yourself. Open PowerShell **as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "Ascent dev server 8001" -Direction Inbound -Protocol TCP -LocalPort 8001 -Action Allow -Profile Private
```

Remove it when you are done:

```powershell
Remove-NetFirewallRule -DisplayName "Ascent dev server 8001"
```

## 4. Host a game and join from a phone

1. On the laptop, open the host screen and put it where everyone can see it:

   ```powershell
   Start-Process "http://localhost:8001/host"
   ```

2. Click **Host a game**. The screen shows a QR code, the room code (e.g. `K7QX`) and the join link.
3. On each phone, connected to the **same Wi-Fi** as the laptop, open the **camera** and point it at the QR code, then tap the link. No app is needed.
   - No camera scan? In the phone browser, type the link under the QR code, or open `http://192.168.1.23:8001/join` and type the room code.
4. Each player types a name and taps **Join the game**. They appear in the host's player list and on the leaderboard.
5. The host clicks **Start the game**. Rounds then run on their own: bet during the countdown, tap **CASH OUT** during the flight.
6. If a phone locks or drops, reopening the page puts the player back in the same seat with the same balance, as long as they return within `SEAT_HOLD_SECONDS` (120 s by default).

### Quick checks if a phone cannot connect

From the **phone** browser, open `http://192.168.1.23:8001/api/v1/health`. You should see `{"status":"ok",...}`.

From the **laptop**:

```powershell
Test-NetConnection -ComputerName 192.168.1.23 -Port 8001
```

`TcpTestSucceeded : True` means the server is reachable on the LAN address.

| Symptom | Fix |
| --- | --- |
| Host screen shows the yellow "uses localhost" warning | Set `PUBLIC_BASE_URL` in `.env` to the LAN IP, then restart. |
| Laptop test fails | Check `ASCENT_HOST=0.0.0.0` in `.env` and restart. Check the firewall section above. |
| Laptop test works but the phone cannot load the health page | The Wi-Fi blocks device-to-device traffic. See section 5. |
| It worked yesterday and not today | The laptop's IP changed. Find it again and update `PUBLIC_BASE_URL`. |
| Phone says "This device is not in the room right now" | Its session is no longer valid: it was away longer than `SEAT_HOLD_SECONDS`, or the host removed it and the page was reopened. (After a server restart the phone says the room no longer exists instead.) Enter a name to join again. |

## 5. When the Wi-Fi blocks phones from reaching the laptop

Guest, campus, hotel and hackathon networks often use **client isolation**: every device can reach the internet but not each other. You have two workarounds.

### Option A: phone hotspot (simplest, no internet needed for play)

1. Turn on **Personal Hotspot / Mobile hotspot** on one phone.
2. Connect the laptop **and every player's phone** to that hotspot.
3. Find the laptop's new address and put it in `.env`:

   ```powershell
   (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi").IPAddress
   notepad .env
   ```

4. Windows may mark the hotspot as a new **Public** network. Set it to **Private** (section 3) or allow the firewall prompt for it.
5. Restart the server and click **Host a game** again.

The hotspot phone can play too; it reaches the laptop like any other device.

### Option B: a tunnel (works through any network, needs internet)

A tunnel gives the laptop a public `https://` address. Anyone with the link can open it, so share it only with players and stop the tunnel afterwards. Example with Cloudflare's free quick tunnel (no account needed):

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8001
```

It prints an address like `https://random-words.trycloudflare.com`. Keep that window open, then in another PowerShell window:

```powershell
notepad .env          # set PUBLIC_BASE_URL=https://random-words.trycloudflare.com
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

With a tunnel, `ASCENT_HOST` can stay `127.0.0.1`, and the firewall prompt does not matter, because the tunnel connects from the laptop itself. The pages switch to `wss://` automatically. `ngrok http 8001` works the same way but needs a free ngrok account.

## 6. Data, tests and reset

- **Storage:** with `STORAGE_BACKEND=sqlite` (the default), rooms, players and the money event log go to `data\ascent.sqlite3` (git-ignored). Set `STORAGE_BACKEND=memory` to keep nothing.
- **Look at the event log** (amounts in units, 100 units = 1 play credit):

  ```powershell
  .venv\Scripts\python -c "import sqlite3; db=sqlite3.connect('data/ascent.sqlite3'); [print(r) for r in db.execute('SELECT room_id, round_id, player_id, kind, timestamp_ms, amount_units, multiplier_hundredths FROM ledger_events ORDER BY event_id DESC LIMIT 20')]"
  ```

- **Start from scratch:** stop the server, then:

  ```powershell
  Remove-Item data\ascent.sqlite3
  ```

- **Run the tests** (they use in-memory storage and never touch `data\` or your `.env` values):

  ```powershell
  .venv\Scripts\python -m pytest
  ```

## 7. End-to-end browser tests (Playwright)

The `e2e/` folder holds Playwright tests that drive one host screen and two emulated phones (Pixel 7 viewport, touch on) through a full room: create, QR code, join, duplicate name, a round with a cash-out, leaderboard ranks and ties, reload and reconnect, kick, and an invented session token. They are separate from pytest: `pytest` never collects them, and they need Node.js.

**Install (once).** You need Node.js 20 or newer (`node --version`) and Microsoft Edge, which comes with Windows. The tests use the installed Edge, so you don't need to run `npx playwright install`. Everything installs inside `e2e\node_modules` (git-ignored) at the exact version pinned in `e2e\package-lock.json`:

```powershell
cd e2e
npm ci
```

**Run.** Do the Python setup from section 1 first (the tests start the server with `.venv`):

```powershell
cd e2e
npm test
```

- The tests start their **own** server on port **8799** with `STORAGE_BACKEND=memory` and the fast config `e2e\game.e2e.json` (2.5 s betting, faster climb). They never reuse a running server and never open `data\ascent.sqlite3`; `e2e\serve.py` refuses to start without memory storage.
- The server is stopped when the run ends. If the run is killed, `serve.py` notices within about a second that the test runner is gone and exits, so no Python process is left behind. To check:

  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'serve\.py' }
  ```

  No output means nothing is left over.
- If port 8799 is already taken, the run stops with an error instead of using whatever is listening there.

**When a test fails**, Playwright keeps a screenshot of every page (host and phones) and a trace in `e2e\test-results\` (git-ignored). Open them with:

```powershell
npx playwright show-report
npx playwright show-trace test-results\<test folder>\trace.zip
```

Useful options: `npx playwright test --headed` watches the browsers; `npx playwright test --repeat-each=5` checks for flakiness.

## Settings reference (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ASCENT_HOST` | `127.0.0.1` | Interface to listen on. `0.0.0.0` for phones on the LAN. |
| `ASCENT_PORT` | `8001` | Port. (`scripts\dev.ps1` passes `-Port`, default 8001.) |
| `PUBLIC_BASE_URL` | `http://localhost:8001` | Address the join link and QR code use. |
| `SEAT_HOLD_SECONDS` | `120` | How long a dropped player's seat and balance are kept. |
| `MAX_PLAYERS_PER_ROOM` | `50` | Join limit per room. |
| `STORAGE_BACKEND` | `sqlite` | `sqlite`, `memory`, or `supabase` (not built yet). |
| `SQLITE_PATH` | `data/ascent.sqlite3` | SQLite file, relative to the repository. |
| `SUPABASE_URL`, `SUPABASE_KEY` | empty | Placeholders for later. Put real values only in `.env`. |
| `ASCENT_CONFIG` | `config/game.json` | Game rules file. |

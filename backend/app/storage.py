"""Persistence for multiplayer rooms, behind one interface.

``Storage`` is what the room code depends on. Implementations:
- ``InMemoryStorage``: for tests (``STORAGE_BACKEND=memory``);
- ``SQLiteStorage``: the local default, built-in ``sqlite3``, one file;
- ``SupabaseStorage``: a stub to fill in when Supabase is ready.

What goes through storage, and what does not:
- Rooms, players (with *hashes* of their session tokens), each player's
  last balance, and the money event log are written here.
- The round loop never reads from storage. Balances, bets and the current
  round are served from memory (``InMemoryLedger``) on every tick; storage
  only receives the writes that change money. A remote database on the tick
  path would make the multiplier stutter.

Money is integer units (1 credit = 100 units) and multipliers are integer
hundredths, exactly as in the ledger. A later export converts units to dollars.
"""

from __future__ import annotations

import sqlite3
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from .settings import Settings

RoomStatus = Literal["open", "closed"]
PlayerStatus = Literal["active", "kicked", "expired"]
EventKind = Literal["bet", "cashout", "lost"]


@dataclass(frozen=True)
class RoomRecord:
    room_id: str  # the room code, e.g. "K7QX"; never reused
    host_token_hash: str
    created_at_ms: int
    locked: bool = False
    status: RoomStatus = "open"


@dataclass(frozen=True)
class PlayerRecord:
    player_id: str
    room_id: str
    name: str
    session_token_hash: str
    joined_at_ms: int
    balance_units: int
    status: PlayerStatus = "active"


@dataclass(frozen=True)
class LedgerEvent:
    """One money movement, for the staff/AML export. Amounts in units, multiplier in hundredths."""

    room_id: str
    round_id: str
    player_id: str
    bet_id: str
    kind: EventKind
    timestamp_ms: int
    wager_units: int
    amount_units: int  # bet: wager debited; cashout: payout credited; lost: 0
    multiplier_hundredths: int | None  # cashout only
    auto: bool
    balance_after_units: int
    event_id: int | None = None  # assigned by storage


class Storage(ABC):
    @abstractmethod
    def create_room(self, room: RoomRecord) -> None: ...

    @abstractmethod
    def get_room(self, room_id: str) -> RoomRecord | None: ...

    @abstractmethod
    def update_room(self, room_id: str, *, locked: bool | None = None, status: RoomStatus | None = None) -> None: ...

    @abstractmethod
    def close_open_rooms(self) -> int:
        """Mark every open room closed (called at startup: live rooms do not survive a restart)."""

    @abstractmethod
    def add_player(self, player: PlayerRecord) -> None: ...

    @abstractmethod
    def find_player_by_session(self, session_token_hash: str) -> PlayerRecord | None: ...

    @abstractmethod
    def update_player(self, player_id: str, *, status: PlayerStatus | None = None,
                      balance_units: int | None = None) -> None: ...

    @abstractmethod
    def list_players(self, room_id: str) -> list[PlayerRecord]: ...

    @abstractmethod
    def append_event(self, event: LedgerEvent) -> LedgerEvent: ...

    @abstractmethod
    def list_events(self, room_id: str | None = None) -> list[LedgerEvent]: ...

    @abstractmethod
    def max_bet_number(self) -> int:
        """Highest N of any stored ``b_N`` bet id, so new bet ids continue after a restart."""

    def close(self) -> None:
        pass


class InMemoryStorage(Storage):
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rooms: dict[str, RoomRecord] = {}
        self._players: dict[str, PlayerRecord] = {}
        self._events: list[LedgerEvent] = []

    def create_room(self, room: RoomRecord) -> None:
        with self._lock:
            if room.room_id in self._rooms:
                raise ValueError(f"room {room.room_id} exists")
            self._rooms[room.room_id] = room

    def get_room(self, room_id: str) -> RoomRecord | None:
        with self._lock:
            return self._rooms.get(room_id)

    def update_room(self, room_id, *, locked=None, status=None) -> None:
        with self._lock:
            r = self._rooms[room_id]
            self._rooms[room_id] = replace(
                r, locked=r.locked if locked is None else locked, status=status or r.status)

    def close_open_rooms(self) -> int:
        with self._lock:
            open_ids = [k for k, r in self._rooms.items() if r.status == "open"]
            for k in open_ids:
                self._rooms[k] = replace(self._rooms[k], status="closed")
            return len(open_ids)

    def add_player(self, player: PlayerRecord) -> None:
        with self._lock:
            self._players[player.player_id] = player

    def find_player_by_session(self, session_token_hash: str) -> PlayerRecord | None:
        with self._lock:
            return next((p for p in self._players.values() if p.session_token_hash == session_token_hash), None)

    def update_player(self, player_id, *, status=None, balance_units=None) -> None:
        with self._lock:
            p = self._players[player_id]
            self._players[player_id] = replace(
                p, status=status or p.status,
                balance_units=p.balance_units if balance_units is None else balance_units)

    def list_players(self, room_id: str) -> list[PlayerRecord]:
        with self._lock:
            return sorted((p for p in self._players.values() if p.room_id == room_id), key=lambda p: p.joined_at_ms)

    def append_event(self, event: LedgerEvent) -> LedgerEvent:
        with self._lock:
            event = replace(event, event_id=len(self._events) + 1)
            self._events.append(event)
            return event

    def list_events(self, room_id: str | None = None) -> list[LedgerEvent]:
        with self._lock:
            return [e for e in self._events if room_id is None or e.room_id == room_id]

    def max_bet_number(self) -> int:
        with self._lock:
            return max((_bet_number(e.bet_id) for e in self._events), default=0)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
    room_id          TEXT PRIMARY KEY,
    host_token_hash  TEXT NOT NULL,
    created_at_ms    INTEGER NOT NULL,
    locked           INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS players (
    player_id           TEXT PRIMARY KEY,
    room_id             TEXT NOT NULL REFERENCES rooms(room_id),
    name                TEXT NOT NULL,
    session_token_hash  TEXT NOT NULL UNIQUE,
    joined_at_ms        INTEGER NOT NULL,
    balance_units       INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS players_room ON players(room_id);
CREATE TABLE IF NOT EXISTS ledger_events (
    event_id               INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id                TEXT NOT NULL,
    round_id               TEXT NOT NULL,
    player_id              TEXT NOT NULL,
    bet_id                 TEXT NOT NULL,
    kind                   TEXT NOT NULL CHECK (kind IN ('bet', 'cashout', 'lost')),
    timestamp_ms           INTEGER NOT NULL,
    wager_units            INTEGER NOT NULL,
    amount_units           INTEGER NOT NULL,
    multiplier_hundredths  INTEGER,
    auto                   INTEGER NOT NULL DEFAULT 0,
    balance_after_units    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_events_room ON ledger_events(room_id, round_id);
"""


class SQLiteStorage(Storage):
    """One SQLite file. Writes commit immediately; one lock serialises access.

    ``check_same_thread=False`` because the app may be driven from a test
    thread; the lock keeps that safe.
    """

    def __init__(self, path: Path | str) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(_SCHEMA)
            self._db.commit()

    def _write(self, sql: str, args: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._db.execute(sql, args)
            self._db.commit()
            return cur

    def _read(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def create_room(self, room: RoomRecord) -> None:
        self._write("INSERT INTO rooms VALUES (?, ?, ?, ?, ?)",
                    (room.room_id, room.host_token_hash, room.created_at_ms, int(room.locked), room.status))

    def get_room(self, room_id: str) -> RoomRecord | None:
        rows = self._read("SELECT * FROM rooms WHERE room_id = ?", (room_id,))
        if not rows:
            return None
        r = rows[0]
        return RoomRecord(r["room_id"], r["host_token_hash"], r["created_at_ms"], bool(r["locked"]), r["status"])

    def update_room(self, room_id, *, locked=None, status=None) -> None:
        if locked is not None:
            self._write("UPDATE rooms SET locked = ? WHERE room_id = ?", (int(locked), room_id))
        if status is not None:
            self._write("UPDATE rooms SET status = ? WHERE room_id = ?", (status, room_id))

    def close_open_rooms(self) -> int:
        return self._write("UPDATE rooms SET status = 'closed' WHERE status = 'open'").rowcount

    def add_player(self, player: PlayerRecord) -> None:
        self._write("INSERT INTO players VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (player.player_id, player.room_id, player.name, player.session_token_hash,
                     player.joined_at_ms, player.balance_units, player.status))

    @staticmethod
    def _player(r: sqlite3.Row) -> PlayerRecord:
        return PlayerRecord(r["player_id"], r["room_id"], r["name"], r["session_token_hash"],
                            r["joined_at_ms"], r["balance_units"], r["status"])

    def find_player_by_session(self, session_token_hash: str) -> PlayerRecord | None:
        rows = self._read("SELECT * FROM players WHERE session_token_hash = ?", (session_token_hash,))
        return self._player(rows[0]) if rows else None

    def update_player(self, player_id, *, status=None, balance_units=None) -> None:
        if status is not None:
            self._write("UPDATE players SET status = ? WHERE player_id = ?", (status, player_id))
        if balance_units is not None:
            self._write("UPDATE players SET balance_units = ? WHERE player_id = ?", (balance_units, player_id))

    def list_players(self, room_id: str) -> list[PlayerRecord]:
        rows = self._read("SELECT * FROM players WHERE room_id = ? ORDER BY joined_at_ms, rowid", (room_id,))
        return [self._player(r) for r in rows]

    def append_event(self, event: LedgerEvent) -> LedgerEvent:
        cur = self._write(
            "INSERT INTO ledger_events (room_id, round_id, player_id, bet_id, kind, timestamp_ms, wager_units,"
            " amount_units, multiplier_hundredths, auto, balance_after_units) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (event.room_id, event.round_id, event.player_id, event.bet_id, event.kind, event.timestamp_ms,
             event.wager_units, event.amount_units, event.multiplier_hundredths, int(event.auto),
             event.balance_after_units))
        return replace(event, event_id=cur.lastrowid)

    def list_events(self, room_id: str | None = None) -> list[LedgerEvent]:
        if room_id is None:
            rows = self._read("SELECT * FROM ledger_events ORDER BY event_id")
        else:
            rows = self._read("SELECT * FROM ledger_events WHERE room_id = ? ORDER BY event_id", (room_id,))
        return [LedgerEvent(r["room_id"], r["round_id"], r["player_id"], r["bet_id"], r["kind"], r["timestamp_ms"],
                            r["wager_units"], r["amount_units"], r["multiplier_hundredths"], bool(r["auto"]),
                            r["balance_after_units"], r["event_id"]) for r in rows]

    def max_bet_number(self) -> int:
        rows = self._read("SELECT MAX(CAST(SUBSTR(bet_id, 3) AS INTEGER)) AS n FROM ledger_events")
        return rows[0]["n"] or 0

    def close(self) -> None:
        with self._lock:
            self._db.close()


class SupabaseStorage(Storage):
    """Placeholder for a Supabase (Postgres) implementation. Not built yet.

    To add it: create the three tables of ``_SCHEMA`` in Supabase, implement
    each method with the Supabase client using ``SUPABASE_URL`` and
    ``SUPABASE_KEY`` from the environment, and keep the round loop off the
    network: buffer ``append_event``/``update_player`` writes on a background
    task instead of awaiting a round trip inside a bet or a tick.

    Its abstract methods are deliberately left unimplemented.
    """


def _bet_number(bet_id: str) -> int:
    try:
        return int(bet_id.removeprefix("b_"))
    except ValueError:
        return 0


def create_storage(settings: Settings) -> Storage:
    if settings.storage_backend == "memory":
        return InMemoryStorage()
    if settings.storage_backend == "supabase":
        raise NotImplementedError(
            "STORAGE_BACKEND=supabase is not implemented yet. Use sqlite (the default) or memory; "
            "see SupabaseStorage in backend/app/storage.py.")
    return SQLiteStorage(settings.sqlite_path)

"""Multiplayer rooms: one round engine per room, a host, and seated players.

``RoomRegistry`` creates rooms and finds them by code. Each ``Room`` owns:
- its own ``RoundEngine`` (round ids prefixed with the room code, K7QX-r_1),
  its own ledger (in memory, wrapped by ``RecordingLedger`` so every money
  movement is logged to storage) and its own idempotency store;
- a ``Broadcaster`` for the room's WebSocket connections;
- the seats: one per player, holding name, connection count and when the
  player dropped.

Trust model: room codes are public (they are printed on the host screen);
the host token and session tokens are secrets made by the server with
``secrets.token_urlsafe`` and stored only as SHA-256 hashes. Phones only send
actions; the room and its engine decide what they mean.

Everything here runs on the event loop thread, so each method is atomic with
respect to the round loop. The game must run as one process: rooms, round
loops and sockets live in this process's memory.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import itertools
import logging
import secrets
import unicodedata
from dataclasses import dataclass
from typing import Callable, Iterator

from . import leaderboard, realtime
from .clock import Clock, iso_ms
from .config import GameConfig, public_config
from .engine import RoundEngine
from .errors import GameError
from .fairness import FairnessScheme
from .idempotency import InMemoryIdempotencyStore
from .ledger import InMemoryLedger
from .money import format_credits
from .recording_ledger import RecordingLedger
from .rng import CrashPointProvider
from .settings import Settings
from .storage import PlayerRecord, RoomRecord, Storage

log = logging.getLogger("ascent.rooms")

# No 0/O, 1/I/L: codes are read off a screen and typed on a phone.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 4
NAME_MAX = 16

# Every room socket hears from the server at least this often, even in an idle lobby,
# so a page can tell a silently dropped connection from a quiet one (see socket.js).
PING_EVERY_MS = 10_000

CLOSE_UNAUTHORIZED = 4401
CLOSE_KICKED = 4403
CLOSE_ROOM_NOT_FOUND = 4404


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_code(code: str) -> str:
    return code.strip().upper()


def clean_name(raw: str) -> str:
    """Trim, collapse inner whitespace, and check length and characters. Raises INVALID_REQUEST."""
    name = " ".join(str(raw).split())
    if not 1 <= len(name) <= NAME_MAX:
        raise GameError("INVALID_REQUEST", f"Name must be 1 to {NAME_MAX} characters.")
    if any(unicodedata.category(ch).startswith("C") for ch in name):
        raise GameError("INVALID_REQUEST", "Name contains characters that cannot be shown.")
    return name


def name_key(name: str) -> str:
    """Names are unique per room ignoring case and spacing: "Ana", "ana" and " ANA " clash."""
    return unicodedata.normalize("NFKC", name).casefold()


@dataclass
class Seat:
    player_id: str
    name: str
    joined_order: int
    status: str = "active"  # active | kicked | expired
    connections: int = 0
    disconnected_at_ms: int | None = None

    @property
    def connected(self) -> bool:
        return self.connections > 0


class Room:
    def __init__(self, record: RoomRecord, *, config: GameConfig, settings: Settings, storage: Storage,
                 clock: Clock, provider: CrashPointProvider, fairness: FairnessScheme,
                 bet_numbers: Iterator[int], autorun: bool) -> None:
        self.code = record.room_id
        self.host_token_hash = record.host_token_hash
        self.locked = record.locked
        self.started = False
        self.config = config
        self.settings = settings
        self.storage = storage
        self.clock = clock
        self.autorun = autorun
        self.broadcaster = realtime.Broadcaster()
        self.ledger = RecordingLedger(
            InMemoryLedger(config.starting_balance_units, bet_numbers), storage, self.code, clock)
        self.idempotency = InMemoryIdempotencyStore()
        # The room is the engine's event sink, so it can react to round events
        # before they fan out to the sockets.
        self.engine = RoundEngine(config, self.ledger, provider, fairness, clock, sink=self,
                                  round_prefix=f"{self.code}-")
        self.seats: dict[str, Seat] = {}
        self._join_counter = itertools.count(1)
        self.task: asyncio.Task | None = None
        # Leaderboard state: balances as of the last settled round, and what was last sent.
        self._settled_balances: dict[str, int] = {}
        self._last_settled_round: str | None = None
        self._last_entries: list[dict] | None = None

    # ---------- EventSink (engine -> room -> sockets) ----------

    def publish(self, event: dict, account_id: str | None = None) -> None:
        self.broadcaster.publish(event, account_id)
        if account_id is None and event["type"] == "round.settled":
            self.after_round_settled()

    def after_round_settled(self) -> None:
        """Run once per round, after every payout of the round has been applied."""
        self._last_settled_round = self.engine.round.round_id
        for seat in self.active_seats():
            self._settled_balances[seat.player_id] = self.ledger.get_account(seat.player_id).balance
        self.sweep()
        self.refresh_leaderboard()

    # ---------- Seats ----------

    def active_seats(self) -> list[Seat]:
        return [s for s in self.seats.values() if s.status == "active"]

    def join(self, raw_name: str) -> tuple[Seat, str]:
        """Seat a new player. Returns the seat and the session token (shown to the phone once)."""
        name = clean_name(raw_name)
        if self.locked:
            raise GameError("ROOM_LOCKED", "This room is locked. Ask the host to unlock it.")
        active = self.active_seats()
        if len(active) >= self.settings.max_players_per_room:
            raise GameError("ROOM_FULL", "This room is full.")
        key = name_key(name)
        if any(name_key(s.name) == key for s in active):
            raise GameError("NAME_TAKEN", f"Someone in this room is already called {name}. Pick another name.")
        player_id = "p_" + secrets.token_hex(8)
        token = secrets.token_urlsafe(32)
        now = self.clock.now_ms()
        account = self.ledger.ensure_account(player_id, self.config.defaultLanguage)
        # The engine's public roster (round.players) shows this name, not a generated callsign.
        self.ledger.set_name(player_id, name)
        self.storage.add_player(PlayerRecord(player_id, self.code, name, hash_token(token), now, account.balance))
        # Not connected yet: the seat-hold timer covers a phone that never opens the socket.
        seat = Seat(player_id, name, next(self._join_counter), disconnected_at_ms=now)
        self.seats[player_id] = seat
        log.info("room %s: %s joined as %s", self.code, player_id, name)
        self.on_roster_changed()
        return seat, token

    def authenticate_player(self, session_token: str | None) -> Seat:
        """Find the seat for a session token, if it is still held. Raises UNAUTHORIZED."""
        if not session_token or not isinstance(session_token, str):
            raise GameError("UNAUTHORIZED", "Missing session token.")
        record = self.storage.find_player_by_session(hash_token(session_token))
        seat = self.seats.get(record.player_id) if record is not None and record.room_id == self.code else None
        if seat is not None:
            self._expire_if_overdue(seat, self.clock.now_ms())
        if seat is None or seat.status != "active":
            raise GameError("UNAUTHORIZED", "This session is no longer valid for this room. Join again.")
        return seat

    def check_host(self, host_token: str | None) -> None:
        if not host_token or not isinstance(host_token, str) or not hmac.compare_digest(
                hash_token(host_token), self.host_token_hash):
            raise GameError("UNAUTHORIZED", "Invalid host token.")

    def attach(self, seat: Seat | None) -> bool:
        """A socket for ``seat`` opened. Returns True if the lobby changed."""
        if seat is None:
            return False
        seat.connections += 1
        seat.disconnected_at_ms = None
        return seat.connections == 1

    def detach(self, seat: Seat | None) -> None:
        if seat is None or seat.status != "active":
            return
        seat.connections = max(0, seat.connections - 1)
        if seat.connections == 0:
            seat.disconnected_at_ms = self.clock.now_ms()  # the seat is held from now
            self.broadcast_lobby()

    def _expire_if_overdue(self, seat: Seat, now: int) -> bool:
        hold_ms = self.settings.seat_hold_seconds * 1000
        if (seat.status == "active" and seat.connections == 0 and seat.disconnected_at_ms is not None
                and now - seat.disconnected_at_ms > hold_ms):
            seat.status = "expired"
            self.storage.update_player(seat.player_id, status="expired")
            log.info("room %s: seat of %s expired", self.code, seat.player_id)
            return True
        return False

    def sweep(self) -> None:
        """Release seats whose hold has run out."""
        now = self.clock.now_ms()
        if any([self._expire_if_overdue(s, now) for s in list(self.seats.values())]):
            self.on_roster_changed()

    def on_roster_changed(self) -> None:
        """Someone joined, was removed or lost their seat: update the lobby and the ranking."""
        self.broadcast_lobby()
        self.refresh_leaderboard()

    # ---------- Leaderboard ----------

    def leaderboard_entries(self) -> list[dict]:
        """Ranked from the server's own balances as of the last settled round.

        A player who joined since then is ranked with the starting balance, so
        the board never shows a wager that is still in flight.
        """
        start = self.config.starting_balance_units
        return leaderboard.rank([
            leaderboard.Standing(s.player_id, s.name, self._settled_balances.get(s.player_id, start), s.joined_order)
            for s in self.active_seats()
        ])

    def leaderboard_data(self, entries: list[dict] | None = None) -> dict:
        return {"basis": leaderboard.BASIS, "label": leaderboard.LABEL, "playMoney": True,
                "afterRoundId": self._last_settled_round,
                "entries": self.leaderboard_entries() if entries is None else entries}

    def refresh_leaderboard(self) -> dict | None:
        """Recompute the ranking and broadcast it only if it changed. Returns what was sent."""
        entries = self.leaderboard_entries()
        if entries == self._last_entries:
            return None
        self._last_entries = entries
        data = self.leaderboard_data(entries)
        self.broadcaster.publish({"type": "leaderboard.updated", "data": data})
        return data

    # ---------- Host controls (the caller has already checked the host token) ----------

    def start(self) -> None:
        if self.started:
            return
        self.started = True
        if self.autorun:
            self.task = asyncio.create_task(self.engine.run_forever(), name=f"room-{self.code}")
        log.info("room %s: started", self.code)
        self.broadcast_lobby()

    def set_locked(self, locked: bool) -> None:
        self.locked = bool(locked)
        self.storage.update_room(self.code, locked=self.locked)
        self.broadcast_lobby()

    def kick(self, player_id: str) -> None:
        seat = self.seats.get(player_id)
        if seat is None or seat.status != "active":
            raise GameError("INVALID_REQUEST", "No such player in this room.")
        seat.status = "kicked"
        self.storage.update_player(player_id, status="kicked")
        for conn in self.broadcaster.connections_for(player_id):
            self.broadcaster.disconnect(conn)
            asyncio.ensure_future(conn.ws.close(code=CLOSE_KICKED))
        log.info("room %s: host removed %s", self.code, player_id)
        self.on_roster_changed()

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task

    # ---------- Messages ----------

    def lobby_data(self) -> dict:
        return {
            "roomCode": self.code,
            "locked": self.locked,
            "started": self.started,
            "players": [
                {"playerId": s.player_id, "name": s.name, "connected": s.connected}
                for s in sorted(self.active_seats(), key=lambda s: s.joined_order)
            ],
        }

    def ping(self) -> None:
        self.broadcaster.publish({"type": "ping", "data": {"serverTime": iso_ms(self.clock.now_ms())}})

    def broadcast_lobby(self) -> None:
        self.broadcaster.publish({"type": "lobby.updated", "data": self.lobby_data()})

    def welcome_data(self, seat: Seat | None) -> dict:
        you = None
        if seat is not None:
            you = {"playerId": seat.player_id, "name": seat.name,
                   "balance": format_credits(self.ledger.get_account(seat.player_id).balance)}
        return {
            "role": "player" if seat is not None else "host",
            "room": {"roomCode": self.code, "locked": self.locked, "started": self.started,
                     "publicBaseUrl": self.settings.public_base_url, "playMoney": True},
            "you": you,
            "round": self.engine.snapshot(seat.player_id if seat is not None else ""),
            "history": [{"roundId": h["roundId"], "crash": h["crash"]} for h in self.engine.history("", 10)],
            "config": public_config(self.config),
            "lobby": self.lobby_data(),
            "leaderboard": self.leaderboard_data(),
            "serverTime": iso_ms(self.clock.now_ms()),
        }


class RoomRegistry:
    def __init__(self, *, config: GameConfig, settings: Settings, storage: Storage, clock: Clock,
                 provider_factory: Callable[[], CrashPointProvider], fairness: FairnessScheme,
                 autorun: bool = True) -> None:
        self.config = config
        self.settings = settings
        self.storage = storage
        self.clock = clock
        self.provider_factory = provider_factory
        self.fairness = fairness
        self.autorun = autorun
        self.rooms: dict[str, Room] = {}
        # Live rooms do not survive a restart; their rows stay for the export.
        closed = storage.close_open_rooms()
        if closed:
            log.info("closed %d room(s) left open by a previous run", closed)
        # One bet-id sequence for every room, continuing after the stored ids.
        self.bet_numbers = itertools.count(storage.max_bet_number() + 1)

    def _new_code(self) -> str:
        for _ in range(100):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            # Never reuse a code, even of a closed room, so room ids and round ids stay unique.
            if code not in self.rooms and self.storage.get_room(code) is None:
                return code
        raise RuntimeError("could not find a free room code")

    def create_room(self) -> tuple[Room, str]:
        """Returns the room and its host token (given to the host once, stored only as a hash)."""
        code = self._new_code()
        host_token = secrets.token_urlsafe(32)
        record = RoomRecord(code, hash_token(host_token), self.clock.now_ms())
        self.storage.create_room(record)
        room = Room(record, config=self.config, settings=self.settings, storage=self.storage, clock=self.clock,
                    provider=self.provider_factory(), fairness=self.fairness, bet_numbers=self.bet_numbers,
                    autorun=self.autorun)
        self.rooms[code] = room
        log.info("room %s: created", code)
        return room, host_token

    def get(self, code: str) -> Room:
        room = self.rooms.get(normalize_code(code))
        if room is None:
            raise GameError("ROOM_NOT_FOUND", f"No open room with code {normalize_code(code)}.")
        return room

    def sweep(self) -> None:
        for room in list(self.rooms.values()):
            room.sweep()

    def ping(self) -> None:
        for room in list(self.rooms.values()):
            room.ping()

    async def run_sweeper(self, every_ms: int = 5000) -> None:
        """Housekeeping loop: release expired seats every ``every_ms`` and ping every room
        every ``PING_EVERY_MS``."""
        since_ping = 0
        while True:
            await self.clock.sleep_ms(every_ms)
            self.sweep()
            since_ping += every_ms
            if since_ping >= PING_EVERY_MS:
                since_ping = 0
                self.ping()

    async def shutdown(self) -> None:
        for room in list(self.rooms.values()):
            await room.stop()
            self.storage.update_room(room.code, status="closed")

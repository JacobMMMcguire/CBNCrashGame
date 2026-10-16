"""Round engine: the state machine and the server-clock loop (contract §2 and §5).

The engine has no network code. It talks to the outside world through:
- ``Clock`` (time), ``CrashPointProvider`` (crash points), ``FairnessScheme``
  (commitments), ``Ledger`` (balances and bets), and
- ``EventSink`` (where events go; the realtime module implements it).

Multipliers are integer hundredths and money is integer units throughout.
"""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Protocol

from .clock import Clock, iso_ms
from .config import GameConfig
from .errors import GameError
from .fairness import FairnessScheme, Verification
from .ledger import Bet, Ledger
from .money import crash_offset_ms, elapsed_for_multiplier_ms, format_credits, multiplier_at, multiplier_to_float
from .players import roster_entry
from .rng import CrashPointProvider, RoundSecret
from .schemas import (
    BalanceData, BettingData, CashoutData, CrashedData, HistoryData, HistoryEntry,
    LaunchedData, PlayersData, SettledData, TickData, wire,
)

log = logging.getLogger("ascent.engine")

IDLE, BETTING, IN_FLIGHT, CRASHED, SETTLED = "idle", "betting", "in-flight", "crashed", "settled"

# Contract §2: the only moves a round may make.
TRANSITIONS: dict[str, frozenset[str]] = {
    IDLE: frozenset({BETTING}),
    BETTING: frozenset({IN_FLIGHT}),
    IN_FLIGHT: frozenset({CRASHED}),
    CRASHED: frozenset({SETTLED}),
    SETTLED: frozenset({IDLE, BETTING}),
}

HISTORY_KEEP = 100  # finished rounds kept in memory for history and verify


class InvalidTransition(RuntimeError):
    pass


class EventSink(Protocol):
    """Receives events without ``seq``; the sink numbers them per connection.

    ``account_id=None`` means everyone; otherwise only that player's connections.
    """

    def publish(self, event: dict, account_id: str | None = None) -> None: ...


class NullSink:
    def publish(self, event: dict, account_id: str | None = None) -> None:
        pass


class RoundStore(Protocol):
    """Numbers new rounds and keeps finished ones (history and verify).

    A persistent store must hand out numbers that are never reused, even after a
    restart, and may only receive a round after it has crashed (its seed is public
    by then).
    """

    def next_round_number(self) -> int: ...

    def recent_rounds(self, limit: int) -> list[Round]:
        """Finished rounds, oldest first."""

    def save_round(self, r: Round) -> None: ...


class InMemoryRoundStore:
    """Counts from 1 and keeps nothing; the engine's own history is the only copy."""

    def __init__(self) -> None:
        self._counter = 0

    def next_round_number(self) -> int:
        self._counter += 1
        return self._counter

    def recent_rounds(self, limit: int) -> list[Round]:
        return []

    def save_round(self, r: Round) -> None:
        pass


@dataclass
class Round:
    round_id: str
    secret: RoundSecret
    commitment: str
    state: str = IDLE
    closes_at: int | None = None
    launched_at: int | None = None
    crash_at: int | None = None

    @property
    def crash(self) -> int:
        return self.secret.crash


class RoundEngine:
    """Runs one shared round at a time: idle -> betting -> in-flight -> crashed -> settled.

    Rules it enforces (contract §2, §5, §6):
    - only the engine moves a round between states, and only along ``TRANSITIONS``;
    - bets only in ``betting``; cash outs only in ``in-flight``;
    - a cash out is judged by the server's receive time: before ``crashAtMs`` it
      pays ``wager x m(receiveTime)``; at or after it, ``TOO_LATE``;
    - auto cash out happens on the server at exactly the player's target;
    - the crash point and seed are never published before ``round.crashed``.
    """

    def __init__(
        self,
        config: GameConfig,
        ledger: Ledger,
        provider: CrashPointProvider,
        fairness: FairnessScheme,
        clock: Clock,
        sink: EventSink | None = None,
        rounds: RoundStore | None = None,
        round_prefix: str = "",
    ) -> None:
        self.config = config
        self.ledger = ledger
        self.provider = provider
        self.fairness = fairness
        self.clock = clock
        self.sink: EventSink = sink or NullSink()
        self.rounds: RoundStore = rounds or InMemoryRoundStore()
        self._finished: OrderedDict[str, Round] = OrderedDict(
            (r.round_id, r) for r in self.rounds.recent_rounds(HISTORY_KEEP)
        )
        # How many distinct players are connected; main.py points this at the broadcaster.
        self.online_count: Callable[[], int] = lambda: 0
        # Rooms pass "K7QX-" so round ids are unique across rooms (K7QX-r_1). Each room
        # has its own in-memory RoundStore, so room round numbers start at 1.
        self.round_prefix = round_prefix
        self.round = self._new_round()

    # ---------- State machine ----------

    @property
    def state(self) -> str:
        return self.round.state

    def _transition(self, to: str) -> None:
        if to not in TRANSITIONS[self.round.state]:
            raise InvalidTransition(f"{self.round.round_id}: {self.round.state} -> {to} is not allowed")
        log.debug("%s: %s -> %s", self.round.round_id, self.round.state, to)
        self.round.state = to

    def _new_round(self) -> Round:
        round_id = f"{self.round_prefix}r_{self.rounds.next_round_number()}"
        secret = self.provider.new_round(round_id)
        return Round(round_id, secret, self.fairness.commit(secret.server_seed))

    def prepare_round(self) -> None:
        """settled -> idle: draw the next round's sealed seed and crash point."""
        if self.round.state != SETTLED:
            raise InvalidTransition(f"{self.round.round_id}: cannot prepare a new round from {self.round.state}")
        self.round = self._new_round()

    def open_betting(self) -> None:
        self._transition(BETTING)
        r = self.round
        r.closes_at = self.clock.now_ms() + self.config.bettingWindowMs
        self._emit("round.betting", BettingData(commitment=r.commitment, closesAt=iso_ms(r.closes_at)))
        self.publish_roster()

    def launch(self) -> None:
        self._transition(IN_FLIGHT)
        r = self.round
        r.launched_at = self.clock.now_ms()
        r.crash_at = r.launched_at + crash_offset_ms(r.crash, self.config.growthRate)
        self._emit("round.launched", LaunchedData(launchedAt=iso_ms(r.launched_at), growthRate=self.config.growthRate))

    def tick(self) -> bool:
        """Advance the flight to the clock's current time. Returns True once crashed."""
        r = self.round
        if r.state != IN_FLIGHT:
            raise InvalidTransition(f"{r.round_id}: tick in {r.state}")
        now = self.clock.now_ms()
        if now >= r.crash_at:
            self.crash()
            return True
        m = self._multiplier_at(now)
        self._run_auto_cash_outs(up_to=m)
        self._emit("round.tick", TickData(multiplier=multiplier_to_float(m), elapsedMs=now - r.launched_at))
        return False

    def crash(self) -> None:
        r = self.round
        self._transition(CRASHED)
        # Auto targets below the crash point were reached even if no tick landed on them.
        self._run_auto_cash_outs(up_to=r.crash - 1)
        self.ledger.mark_lost(r.round_id)
        self._emit(
            "round.crashed",
            CrashedData(crash=multiplier_to_float(r.crash), serverSeed=r.secret.server_seed, commitment=r.commitment),
        )
        self.publish_roster()

    def settle(self) -> None:
        r = self.round
        self._transition(SETTLED)
        self._keep_finished(r)
        self._emit("round.settled", SettledData())
        self._emit(
            "history.updated",
            HistoryData(round=HistoryEntry(roundId=r.round_id, crash=multiplier_to_float(r.crash))),
            with_round_id=False,
        )

    # ---------- Server clock loop ----------

    async def run_round(self) -> None:
        """One full round on the server clock, from idle to settled."""
        if self.round.state == SETTLED:
            self.prepare_round()
        self.open_betting()
        await self._sleep_until(self.round.closes_at)
        self.launch()
        interval = self.config.tickIntervalMs
        next_tick = self.round.launched_at
        while True:
            now = self.clock.now_ms()
            if now >= next_tick or now >= self.round.crash_at:
                if self.tick():
                    break
                next_tick = max(next_tick + interval, now + 1)
            await self._sleep_until(min(next_tick, self.round.crash_at))
        self.settle()
        await self.clock.sleep_ms(self.config.settleDelayMs)

    async def run_forever(self) -> None:
        while True:
            try:
                await self.run_round()
            except asyncio.CancelledError:
                raise
            except Exception:  # keep the game running; a bad round must not stop the server
                log.exception("round %s failed", self.round.round_id)
                await self.clock.sleep_ms(1000)
                self._abandon_round()

    def _abandon_round(self) -> None:
        """A round failed: refund every bet still riding, then close the round.

        A refund is a cash out at 1.00x, so it pays back exactly the wager and
        reaches the player through the usual round.cashout and balance.updated.
        """
        r = self.round
        for bet in self.ledger.bets_for_round(r.round_id):
            if bet.status == "active":
                try:
                    self._apply_cash_out(bet.account_id, bet.round_id, 100, auto=False)
                except Exception:  # keep refunding the others
                    log.exception("%s: refund of %s failed", r.round_id, bet.bet_id)
        r.state = SETTLED
        self._keep_finished(r)

    def _keep_finished(self, r: Round) -> None:
        self._finished[r.round_id] = r
        while len(self._finished) > HISTORY_KEEP:
            self._finished.popitem(last=False)
        try:
            self.rounds.save_round(r)
        except Exception:  # balances are already safe in the ledger; only history after a restart loses this round
            log.exception("%s: could not save the finished round", r.round_id)

    async def _sleep_until(self, at_ms: int) -> None:
        await self.clock.sleep_ms(at_ms - self.clock.now_ms())

    # ---------- Player commands (called by the API) ----------

    def place_bet(self, account_id: str, round_id: str, wager: int, auto_cash_out: int | None) -> tuple[Bet, int]:
        r = self.round
        if round_id != r.round_id or r.state != BETTING or self.clock.now_ms() >= r.closes_at:
            raise GameError("BET_WINDOW_CLOSED", "Bets are accepted only while this round's betting window is open.")
        cfg = self.config
        if not (cfg.min_bet_units <= wager <= cfg.max_bet_units):
            raise GameError(
                "BET_OUT_OF_RANGE",
                f"Wager must be between {format_credits(cfg.min_bet_units)} and {format_credits(cfg.max_bet_units)}.",
            )
        if auto_cash_out is not None and not (
            cfg.auto_cash_out_min_hundredths <= auto_cash_out <= cfg.max_multiplier_hundredths
        ):
            raise GameError(
                "INVALID_REQUEST",
                f"autoCashOut must be between {cfg.autoCashOutMin} and {cfg.maxMultiplier}.",
            )
        bet = self.ledger.place_bet(account_id, round_id, wager, auto_cash_out)
        balance = self.ledger.get_account(account_id).balance
        self._emit_private(account_id, "balance.updated", BalanceData(balance=format_credits(balance), reason="bet"))
        self.publish_roster()
        return bet, balance

    def cash_out(self, account_id: str, round_id: str) -> tuple[Bet, int]:
        bet = self.ledger.get_bet(account_id, round_id)
        if bet is not None and bet.status == "cashed-out":
            # Contract §7: a second cash out returns the original result.
            return bet, self.ledger.get_account(account_id).balance
        if bet is None:
            raise GameError("NO_ACTIVE_BET", "There is no bet to cash out in this round.")
        if bet.status == "lost":
            raise GameError("TOO_LATE", "Round crashed before cash-out was received.")
        r = self.round
        if round_id != r.round_id or r.state in (CRASHED, SETTLED):
            raise GameError("TOO_LATE", "Round crashed before cash-out was received.")
        if r.state != IN_FLIGHT:
            raise GameError("ROUND_NOT_IN_FLIGHT", "Cash out opens when the rocket launches.")
        now = self.clock.now_ms()
        if now >= r.crash_at:
            raise GameError("TOO_LATE", "Round crashed before cash-out was received.")
        bet = self._apply_cash_out(account_id, round_id, self._multiplier_at(now), auto=False)
        return bet, self.ledger.get_account(account_id).balance

    def refill(self, account_id: str) -> int:
        """Top a broke play account back up to ``startingBalance``.

        Allowed only when the balance is below the minimum bet and no bet is
        riding on the current round, so it cannot be used to top up mid-game.
        """
        balance = self.ledger.get_account(account_id).balance
        bet = self.ledger.get_bet(account_id, self.round.round_id)
        if balance >= self.config.min_bet_units or (bet is not None and bet.status == "active"):
            raise GameError("REFILL_NOT_NEEDED", "Play credits can be refilled only when the balance is below the minimum bet.")
        balance = self.ledger.refill(account_id, self.config.starting_balance_units).balance
        self._emit_private(account_id, "balance.updated", BalanceData(balance=format_credits(balance), reason="refill"))
        return balance

    # ---------- Testing aid (only reachable when dev cheats are enabled) ----------

    def skip_ahead(self, add_hundredths: int) -> tuple[int, int]:
        """Jump the flight forward so the multiplier rises by ``add_hundredths``.

        It moves the launch time (and the precomputed crash time) back, which is
        the same as the flight having started earlier. The crash point and seed are
        untouched, so the round still verifies; if the jump passes the crash point,
        the next tick crashes the round. Auto cash outs on the way are paid at
        their targets by that tick. Returns ``(launched_at_ms, multiplier)``.
        """
        r = self.round
        if r.state != IN_FLIGHT:
            raise GameError("ROUND_NOT_IN_FLIGHT", "Skipping works only while the rocket is in flight.")
        now = self.clock.now_ms()
        current = multiplier_at(now - r.launched_at, self.config.growthRate)
        shift = elapsed_for_multiplier_ms(current + add_hundredths, self.config.growthRate) - (now - r.launched_at)
        r.launched_at -= shift
        r.crash_at -= shift
        log.warning("%s: dev skip +%s (multiplier now %s)", r.round_id, add_hundredths, current + add_hundredths)
        return r.launched_at, multiplier_at(now - r.launched_at, self.config.growthRate)

    # ---------- Multiplayer ----------

    def roster(self) -> list[dict]:
        """Every bet in the current launch as other players see it, biggest wager first."""
        bets = sorted(self.ledger.bets_for_round(self.round.round_id), key=lambda b: (-b.wager, b.bet_id))
        return [roster_entry(b, self.ledger.get_account(b.account_id)) for b in bets]

    def publish_roster(self) -> None:
        """Broadcast round.players when a bet, cash out, crash, rename or new round changes
        the roster, and when someone connects or disconnects."""
        self._emit("round.players", PlayersData(players=self.roster(), online=self.online_count()))

    # ---------- Read models (called by the API) ----------

    def snapshot(self, account_id: str) -> dict:
        """Body of GET /api/v1/rounds/current (contract §8.2)."""
        r = self.round
        bet = self.ledger.get_bet(account_id, r.round_id)
        body = {
            "roundId": r.round_id,
            "state": r.state,
            "commitment": None if r.state == IDLE else r.commitment,
            "closesAt": iso_ms(r.closes_at) if r.closes_at is not None else None,
            "launchedAt": iso_ms(r.launched_at) if r.launched_at is not None else None,
            "growthRate": self.config.growthRate,
            "serverTime": iso_ms(self.clock.now_ms()),
            "myBet": None if bet is None else {
                "wager": format_credits(bet.wager),
                "autoCashOut": None if bet.auto_cash_out is None else multiplier_to_float(bet.auto_cash_out),
                "status": bet.status,
            },
        }
        if r.state in (CRASHED, SETTLED):
            body["crash"] = multiplier_to_float(r.crash)
            body["serverSeed"] = r.secret.server_seed
        return body

    def history(self, account_id: str, limit: int) -> list[dict]:
        """Rounds for GET /api/v1/history (contract §8.5), newest first."""
        out = []
        for r in reversed(self._finished.values()):
            if len(out) >= limit:
                break
            bet = self.ledger.get_bet(account_id, r.round_id)
            my = None
            if bet is not None:
                my = {"wager": format_credits(bet.wager), "status": bet.status, "profit": format_credits(bet.profit)}
                if bet.status == "cashed-out":
                    my["multiplier"] = multiplier_to_float(bet.multiplier)
            out.append({"roundId": r.round_id, "crash": multiplier_to_float(r.crash), "myResult": my})
        return out

    def verify(self, round_id: str) -> Verification:
        r = self._finished.get(round_id)
        if r is None:
            if round_id == self.round.round_id and self.round.state == CRASHED:
                r = self.round
            elif round_id == self.round.round_id:
                raise GameError("ROUND_NOT_FINISHED", "A round can be verified only after it has crashed.")
            else:
                raise GameError("ROUND_NOT_FOUND", f"Round {round_id} is not in the server's history.")
        return self.fairness.verify(r.round_id, r.secret.server_seed, r.commitment, r.crash)

    # ---------- Internals ----------

    def _multiplier_at(self, now_ms: int) -> int:
        r = self.round
        # Clamp below the crash: while in flight the multiplier never reaches it.
        return min(multiplier_at(now_ms - r.launched_at, self.config.growthRate), r.crash - 1)

    def _run_auto_cash_outs(self, up_to: int) -> None:
        for bet in self.ledger.bets_for_round(self.round.round_id):
            if bet.status == "active" and bet.auto_cash_out is not None and bet.auto_cash_out <= up_to:
                self._apply_cash_out(bet.account_id, bet.round_id, bet.auto_cash_out, auto=True)

    def _apply_cash_out(self, account_id: str, round_id: str, multiplier: int, auto: bool) -> Bet:
        bet, applied = self.ledger.cash_out(account_id, round_id, multiplier, auto=auto)
        if applied:
            self._emit_private(
                account_id,
                "round.cashout",
                CashoutData(
                    betId=bet.bet_id, multiplier=multiplier_to_float(bet.multiplier),
                    payout=format_credits(bet.payout), auto=auto,
                ),
                round_id=round_id,
            )
            balance = self.ledger.get_account(account_id).balance
            self._emit_private(account_id, "balance.updated", BalanceData(balance=format_credits(balance), reason="cashout"))
            self.publish_roster()
        return bet

    def _emit(self, type_: str, data, with_round_id: bool = True) -> None:
        event = {"type": type_}
        if with_round_id:
            event["roundId"] = self.round.round_id
        event["data"] = wire(data)
        self.sink.publish(event)

    def _emit_private(self, account_id: str, type_: str, data, round_id: str | None = None) -> None:
        event = {"type": type_}
        if round_id is not None:
            event["roundId"] = round_id
        event["data"] = wire(data)
        self.sink.publish(event, account_id=account_id)

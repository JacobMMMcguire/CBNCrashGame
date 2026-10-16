"""A ledger that writes every money movement to storage.

``RecordingLedger`` wraps the in-memory ledger. Reads (``get_account``,
``get_bet``, ``bets_for_round``) go straight to memory, because the engine calls
them on every tick. Only the three operations that move money also write to
storage: a bet, a cash out (manual or auto) and a loss at the crash. Each write
is one ``LedgerEvent`` plus the player's new balance.

Because it sits at the ledger, it records the same thing whichever way a
command arrived, and auto cash outs that the engine makes on its own.
"""

from __future__ import annotations

from .clock import Clock
from .ledger import Account, Bet, Ledger
from .storage import LedgerEvent, Storage


class RecordingLedger(Ledger):
    def __init__(self, inner: Ledger, storage: Storage, room_id: str, clock: Clock) -> None:
        self.inner = inner
        self.storage = storage
        self.room_id = room_id
        self.clock = clock

    def ensure_account(self, account_id: str, language: str) -> Account:
        return self.inner.ensure_account(account_id, language)

    def get_account(self, account_id: str) -> Account:
        return self.inner.get_account(account_id)

    def get_bet(self, account_id: str, round_id: str) -> Bet | None:
        return self.inner.get_bet(account_id, round_id)

    def bets_for_round(self, round_id: str) -> list[Bet]:
        return self.inner.bets_for_round(round_id)

    def place_bet(self, account_id: str, round_id: str, wager: int, auto_cash_out: int | None) -> Bet:
        bet = self.inner.place_bet(account_id, round_id, wager, auto_cash_out)
        self._record(bet, "bet", amount=bet.wager)
        return bet

    def cash_out(self, account_id: str, round_id: str, multiplier: int, auto: bool = False) -> tuple[Bet, bool]:
        bet, applied = self.inner.cash_out(account_id, round_id, multiplier, auto=auto)
        if applied:
            self._record(bet, "cashout", amount=bet.payout, multiplier=bet.multiplier)
        return bet, applied

    def set_name(self, account_id: str, name: str) -> Account:
        return self.inner.set_name(account_id, name)

    def refill(self, account_id: str, balance: int) -> Account:
        # Play credits only. Not a bet, so no event-log row; the stored balance follows.
        acc = self.inner.refill(account_id, balance)
        self.storage.update_player(account_id, balance_units=acc.balance)
        return acc

    def mark_lost(self, round_id: str) -> list[Bet]:
        lost = self.inner.mark_lost(round_id)
        for bet in lost:
            self._record(bet, "lost", amount=0)
        return lost

    def _record(self, bet: Bet, kind: str, amount: int, multiplier: int | None = None) -> None:
        balance = self.inner.get_account(bet.account_id).balance
        self.storage.append_event(LedgerEvent(
            room_id=self.room_id, round_id=bet.round_id, player_id=bet.account_id, bet_id=bet.bet_id,
            kind=kind, timestamp_ms=self.clock.now_ms(), wager_units=bet.wager, amount_units=amount,
            multiplier_hundredths=multiplier, auto=bet.auto, balance_after_units=balance,
        ))
        if kind != "lost":  # a loss does not change the balance (the wager was debited at the bet)
            self.storage.update_player(bet.account_id, balance_units=balance)

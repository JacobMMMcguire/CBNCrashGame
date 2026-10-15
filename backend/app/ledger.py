"""Play accounts, balances and bets (contract §6).

``Ledger`` is the interface. ``InMemoryLedger`` is a SKELETON ONLY stand-in.
All amounts are integer units (1 credit = 100 units); multipliers are integer
hundredths.
"""

from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from typing import Literal

from .errors import GameError
from .money import format_credits, payout_units

BetStatus = Literal["active", "cashed-out", "lost"]


@dataclass(frozen=True)
class Account:
    account_id: str
    balance: int
    language: str
    name: str | None = None  # pilot name shown to other players; None means the derived callsign


@dataclass(frozen=True)
class Bet:
    bet_id: str
    account_id: str
    round_id: str
    wager: int
    auto_cash_out: int | None
    status: BetStatus = "active"
    multiplier: int | None = None  # set when cashed out
    payout: int | None = None  # set when cashed out
    auto: bool = False  # True if the server cashed out at the auto target

    @property
    def profit(self) -> int:
        return (self.payout or 0) - self.wager


class Ledger(ABC):
    """Owns every balance and bet. The only module allowed to change a balance.

    The real implementation must (contract §6, docs/WORKFLOW.md Step 3):
    - debit the wager in the same atomic operation that records the bet, and
      change nothing if the balance is too low;
    - credit the payout in the same atomic operation that marks the bet
      cashed out, at most once per bet;
    - mark bets that did not cash out as lost at the crash without touching the
      balance (the wager was already debited);
    - never let a balance go negative, and stay correct under concurrent
      requests and after 10,000 random simulated actions;
    - persist accounts and bets if history must survive a restart (TBD, §10).
    """

    @abstractmethod
    def ensure_account(self, account_id: str, language: str) -> Account:
        """Return the account, creating it with ``startingBalance`` if new."""

    @abstractmethod
    def get_account(self, account_id: str) -> Account: ...

    @abstractmethod
    def place_bet(self, account_id: str, round_id: str, wager: int, auto_cash_out: int | None) -> Bet:
        """Atomically debit ``wager`` and record an active bet.

        Raises ``ALREADY_BET`` or ``INSUFFICIENT_BALANCE``.
        """

    @abstractmethod
    def cash_out(self, account_id: str, round_id: str, multiplier: int, auto: bool = False) -> tuple[Bet, bool]:
        """Atomically mark the bet cashed out and credit the payout.

        Returns ``(bet, applied)``. If the bet was already cashed out, returns the
        original bet with ``applied=False`` and pays nothing (contract §7).
        Raises ``NO_ACTIVE_BET`` if there is no bet or it was lost.
        """

    @abstractmethod
    def set_name(self, account_id: str, name: str) -> Account:
        """Set the pilot name other players see."""

    @abstractmethod
    def refill(self, account_id: str, balance: int) -> Account:
        """Set a play account's balance back to ``balance`` (play credits only)."""

    @abstractmethod
    def mark_lost(self, round_id: str) -> list[Bet]:
        """Mark every still-active bet of the round as lost. Returns them."""

    @abstractmethod
    def get_bet(self, account_id: str, round_id: str) -> Bet | None: ...

    @abstractmethod
    def bets_for_round(self, round_id: str) -> list[Bet]: ...


class InMemoryLedger(Ledger):
    """SKELETON ONLY. Process memory, one global lock, nothing persisted.

    Good enough for local development and tests. It loses everything on restart
    and has no audit trail.

    TODO(ledger owner): replace with the real ledger described in ``Ledger``.
    """

    def __init__(self, starting_balance: int) -> None:
        self._starting_balance = starting_balance
        self._lock = threading.Lock()
        self._accounts: dict[str, Account] = {}
        self._bets: dict[tuple[str, str], Bet] = {}  # (account_id, round_id) -> bet
        self._next_bet = 1

    def ensure_account(self, account_id: str, language: str) -> Account:
        with self._lock:
            acc = self._accounts.get(account_id)
            if acc is None:
                acc = Account(account_id, self._starting_balance, language)
                self._accounts[account_id] = acc
            return acc

    def get_account(self, account_id: str) -> Account:
        with self._lock:
            return self._accounts[account_id]

    def place_bet(self, account_id: str, round_id: str, wager: int, auto_cash_out: int | None) -> Bet:
        with self._lock:
            if (account_id, round_id) in self._bets:
                raise GameError("ALREADY_BET", "This account already has a bet in this round.")
            acc = self._accounts[account_id]
            if wager > acc.balance:
                raise GameError(
                    "INSUFFICIENT_BALANCE",
                    f"Wager {format_credits(wager)} is more than the balance {format_credits(acc.balance)}.",
                )
            bet = Bet(f"b_{self._next_bet}", account_id, round_id, wager, auto_cash_out)
            self._next_bet += 1
            self._accounts[account_id] = replace(acc, balance=acc.balance - wager)
            self._bets[(account_id, round_id)] = bet
            return bet

    def cash_out(self, account_id: str, round_id: str, multiplier: int, auto: bool = False) -> tuple[Bet, bool]:
        with self._lock:
            bet = self._bets.get((account_id, round_id))
            if bet is None or bet.status == "lost":
                raise GameError("NO_ACTIVE_BET", "There is no active bet to cash out in this round.")
            if bet.status == "cashed-out":
                return bet, False
            payout = payout_units(bet.wager, multiplier)
            bet = replace(bet, status="cashed-out", multiplier=multiplier, payout=payout, auto=auto)
            acc = self._accounts[account_id]
            self._accounts[account_id] = replace(acc, balance=acc.balance + payout)
            self._bets[(account_id, round_id)] = bet
            return bet, True

    def set_name(self, account_id: str, name: str) -> Account:
        with self._lock:
            acc = replace(self._accounts[account_id], name=name)
            self._accounts[account_id] = acc
            return acc

    def refill(self, account_id: str, balance: int) -> Account:
        with self._lock:
            acc = replace(self._accounts[account_id], balance=balance)
            self._accounts[account_id] = acc
            return acc

    def mark_lost(self, round_id: str) -> list[Bet]:
        with self._lock:
            lost = []
            for key, bet in self._bets.items():
                if bet.round_id == round_id and bet.status == "active":
                    bet = replace(bet, status="lost")
                    self._bets[key] = bet
                    lost.append(bet)
            return lost

    def get_bet(self, account_id: str, round_id: str) -> Bet | None:
        with self._lock:
            return self._bets.get((account_id, round_id))

    def bets_for_round(self, round_id: str) -> list[Bet]:
        with self._lock:
            return [b for b in self._bets.values() if b.round_id == round_id]

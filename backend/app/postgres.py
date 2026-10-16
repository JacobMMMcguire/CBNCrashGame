"""PostgreSQL storage (Supabase) for the ledger, idempotency keys and finished rounds.

Used when ``DATABASE_URL`` is set (see ``main.create_app_from_env``). Reads are
served from memory, as in the in-memory stand-ins, because the engine reads the
ledger on every tick; every change to money or bets is written to PostgreSQL
first, in one transaction, and memory is updated only after it commits.

Each write is conditional (``balance >= wager``, ``status = 'active'``), so the
database stays the judge even if two server processes overlap briefly during a
Render deploy. Bet and round numbers come from database sequences and are never
reused.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from pathlib import Path

from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .config import REPO_ROOT
from .engine import HISTORY_KEEP, SETTLED, Round
from .errors import GameError
from .idempotency import InMemoryIdempotencyStore, StoredResponse
from .ledger import Account, Bet, InMemoryLedger
from .money import format_credits, payout_units
from .rng import RoundSecret

log = logging.getLogger("ascent.postgres")

SCHEMA_PATH: Path = REPO_ROOT / "db" / "schema.sql"
IDEMPOTENCY_KEEP = "1 day"


def connect(url: str) -> ConnectionPool:
    """Open a small pool and create the schema if it is missing.

    One game process needs very few connections; ``check`` replaces connections
    the pooler dropped while the service was asleep.
    """
    pool = ConnectionPool(url, min_size=1, max_size=3, check=ConnectionPool.check_connection, open=True)
    with pool.connection() as conn:
        conn.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
    return pool


def _bet(row) -> Bet:
    bet_no, account_id, round_id, wager, auto_cash_out, status, multiplier, payout, auto = row
    return Bet(f"b_{bet_no}", account_id, round_id, wager, auto_cash_out, status, multiplier, payout, auto)


_BET_COLUMNS = "bet_no, account_id, round_id, wager, auto_cash_out, status, multiplier, payout, auto"


class PostgresLedger(InMemoryLedger):
    """The ``Ledger`` rules, persisted. Memory is a cache of what PostgreSQL holds."""

    def __init__(self, pool: ConnectionPool, starting_balance: int) -> None:
        super().__init__(starting_balance)
        self._pool = pool
        with pool.connection() as conn:
            self._refund_orphans(conn)
            # Bets and accounts behind the history the engine will show.
            rows = conn.execute(
                f"select {_BET_COLUMNS} from bets where round_id in "
                "(select round_id from rounds order by round_no desc limit %s)",
                (HISTORY_KEEP,),
            ).fetchall()
            for row in rows:
                bet = _bet(row)
                self._bets[(bet.account_id, bet.round_id)] = bet
            ids = sorted({b.account_id for b in self._bets.values()})
            for account_id, balance, language, name in conn.execute(
                "select account_id, balance, language, name from accounts where account_id = any(%s)", (ids,)
            ):
                self._accounts[account_id] = Account(account_id, balance, language, name)

    @staticmethod
    def _refund_orphans(conn) -> None:
        """Bets still riding when the server stopped get their wager back (a 1.00x cash out),
        the same as ``RoundEngine._abandon_round`` does for a failed round."""
        refunded = conn.execute(
            """
            with refunded as (
                update bets set status = 'cashed-out', multiplier = 100, payout = wager, cashed_out_at = now()
                where status = 'active'
                returning account_id, wager
            )
            update accounts a set balance = a.balance + r.total
            from (select account_id, sum(wager) as total from refunded group by account_id) r
            where a.account_id = r.account_id
            """
        ).rowcount
        if refunded:
            log.warning("Refunded unfinished bets for %d account(s) left from the last run", refunded)

    def ensure_account(self, account_id: str, language: str) -> Account:
        with self._lock:
            acc = self._accounts.get(account_id)
            if acc is not None:
                return acc
            with self._pool.connection() as conn:
                balance, language, name = conn.execute(
                    "insert into accounts (account_id, balance, language) values (%s, %s, %s) "
                    "on conflict (account_id) do update set account_id = excluded.account_id "
                    "returning balance, language, name",
                    (account_id, self._starting_balance, language),
                ).fetchone()
            acc = Account(account_id, balance, language, name)
            self._accounts[account_id] = acc
            return acc

    def place_bet(self, account_id: str, round_id: str, wager: int, auto_cash_out: int | None) -> Bet:
        with self._lock:
            if (account_id, round_id) in self._bets:
                raise GameError("ALREADY_BET", "This account already has a bet in this round.")
            acc = self._accounts[account_id]
            with self._pool.connection() as conn:
                row = conn.execute(
                    "update accounts set balance = balance - %s where account_id = %s and balance >= %s "
                    "returning balance",
                    (wager, account_id, wager),
                ).fetchone()
                if row is None:
                    (balance,) = conn.execute(
                        "select balance from accounts where account_id = %s", (account_id,)
                    ).fetchone()
                    self._accounts[account_id] = replace(acc, balance=balance)
                    raise GameError(
                        "INSUFFICIENT_BALANCE",
                        f"Wager {format_credits(wager)} is more than the balance {format_credits(balance)}.",
                    )
                inserted = conn.execute(
                    "insert into bets (account_id, round_id, wager, auto_cash_out) values (%s, %s, %s, %s) "
                    "on conflict (account_id, round_id) do nothing returning bet_no",
                    (account_id, round_id, wager, auto_cash_out),
                ).fetchone()
                if inserted is None:  # raising rolls the debit back
                    raise GameError("ALREADY_BET", "This account already has a bet in this round.")
            bet = Bet(f"b_{inserted[0]}", account_id, round_id, wager, auto_cash_out)
            self._accounts[account_id] = replace(acc, balance=row[0])
            self._bets[(account_id, round_id)] = bet
            return bet

    def cash_out(self, account_id: str, round_id: str, multiplier: int, auto: bool = False) -> tuple[Bet, bool]:
        with self._lock:
            key = (account_id, round_id)
            bet = self._bets.get(key)
            if bet is None or bet.status == "lost":
                raise GameError("NO_ACTIVE_BET", "There is no active bet to cash out in this round.")
            if bet.status == "cashed-out":
                return bet, False
            payout = payout_units(bet.wager, multiplier)
            with self._pool.connection() as conn:
                row = conn.execute(
                    "update bets set status = 'cashed-out', multiplier = %s, payout = %s, auto = %s, "
                    "cashed_out_at = now() where account_id = %s and round_id = %s and status = 'active' "
                    "returning bet_no",
                    (multiplier, payout, auto, account_id, round_id),
                ).fetchone()
                if row is None:
                    # Settled elsewhere (another process during a deploy): take the database's word.
                    bet = _bet(conn.execute(
                        f"select {_BET_COLUMNS} from bets where account_id = %s and round_id = %s", key
                    ).fetchone())
                    self._bets[key] = bet
                    if bet.status == "cashed-out":
                        return bet, False
                    raise GameError("NO_ACTIVE_BET", "There is no active bet to cash out in this round.")
                (balance,) = conn.execute(
                    "update accounts set balance = balance + %s where account_id = %s returning balance",
                    (payout, account_id),
                ).fetchone()
            bet = replace(bet, status="cashed-out", multiplier=multiplier, payout=payout, auto=auto)
            self._bets[key] = bet
            self._accounts[account_id] = replace(self._accounts[account_id], balance=balance)
            return bet, True

    def set_name(self, account_id: str, name: str) -> Account:
        with self._lock:
            with self._pool.connection() as conn:
                conn.execute("update accounts set name = %s where account_id = %s", (name, account_id))
            acc = replace(self._accounts[account_id], name=name)
            self._accounts[account_id] = acc
            return acc

    def refill(self, account_id: str, balance: int) -> Account:
        with self._lock:
            with self._pool.connection() as conn:
                conn.execute("update accounts set balance = %s where account_id = %s", (balance, account_id))
            acc = replace(self._accounts[account_id], balance=balance)
            self._accounts[account_id] = acc
            return acc

    def mark_lost(self, round_id: str) -> list[Bet]:
        with self._lock:
            with self._pool.connection() as conn:
                conn.execute("update bets set status = 'lost' where round_id = %s and status = 'active'", (round_id,))
            lost = []
            for key, bet in self._bets.items():
                if bet.round_id == round_id and bet.status == "active":
                    bet = replace(bet, status="lost")
                    self._bets[key] = bet
                    lost.append(bet)
            return lost


class PostgresIdempotencyStore(InMemoryIdempotencyStore):
    """Keeps keys for a day so a retry after a restart still replays.

    Lookups stay in memory (every bet and cash out checks a key); keys from the
    last day are loaded at start.
    """

    def __init__(self, pool: ConnectionPool) -> None:
        super().__init__()
        self._pool = pool
        with pool.connection() as conn:
            conn.execute(f"delete from idempotency_keys where created_at < now() - interval '{IDEMPOTENCY_KEEP}'")
            for account_id, key, fingerprint, status, body in conn.execute(
                "select account_id, key, fingerprint, status, body from idempotency_keys"
            ):
                self._items[(account_id, key)] = StoredResponse(fingerprint, status, body)

    def put(self, account_id: str, key: str, response: StoredResponse) -> None:
        with self._lock:
            if (account_id, key) in self._items:
                return
            self._items[(account_id, key)] = response
            try:
                with self._pool.connection() as conn:
                    conn.execute(
                        "insert into idempotency_keys (account_id, key, fingerprint, status, body) "
                        "values (%s, %s, %s, %s, %s) on conflict do nothing",
                        (account_id, key, response.fingerprint, response.status, Jsonb(response.body)),
                    )
            except Exception:  # the action already happened; failing the response now would hide that
                log.exception("could not persist idempotency key for %s", account_id)


class PostgresRoundStore:
    """``RoundStore`` backed by the ``rounds`` table and ``round_no_seq``."""

    def __init__(self, pool: ConnectionPool) -> None:
        self._pool = pool

    def next_round_number(self) -> int:
        with self._pool.connection() as conn:
            return conn.execute("select nextval('round_no_seq')").fetchone()[0]

    def recent_rounds(self, limit: int) -> list[Round]:
        with self._pool.connection() as conn:
            rows = conn.execute(
                "select round_id, crash, server_seed, commitment, closes_at, launched_at, crash_at "
                "from rounds order by round_no desc limit %s",
                (limit,),
            ).fetchall()
        return [
            Round(round_id, RoundSecret(seed, crash), commitment, SETTLED, closes_at, launched_at, crash_at)
            for round_id, crash, seed, commitment, closes_at, launched_at, crash_at in reversed(rows)
        ]

    def save_round(self, r: Round) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                "insert into rounds (round_no, round_id, crash, server_seed, commitment, closes_at, launched_at, "
                "crash_at) values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing",
                (int(r.round_id.removeprefix("r_")), r.round_id, r.crash, r.secret.server_seed, r.commitment,
                 r.closes_at, r.launched_at, r.crash_at),
            )

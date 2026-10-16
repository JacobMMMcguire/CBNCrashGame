"""Player commands shared by every transport (contract §7, §8.3, §8.4).

The HTTP routes in ``api.py`` and the room WebSocket in ``rooms_api.py`` both
call these functions, so a bet or cash out goes through the same validation,
the same engine and ledger calls, and the same idempotency handling whichever
way it arrives.
"""

from __future__ import annotations

import uuid
from typing import Callable

from .engine import RoundEngine
from .errors import GameError
from .idempotency import IdempotencyStore, StoredResponse
from .money import format_credits, multiplier_from_float, multiplier_to_float, parse_credits
from .schemas import BetResponse, CashOutResponse, PlaceBetRequest, wire


def check_idempotency_key(key: str | None) -> str:
    try:
        if key is None or uuid.UUID(key).version != 4:
            raise ValueError
    except ValueError:
        raise GameError("INVALID_REQUEST", "Idempotency-Key header must be a UUID v4.") from None
    return key.lower()


def run_idempotent(store: IdempotencyStore, account_id: str, key: str | None, fingerprint: str,
                   run: Callable[[], tuple[int, dict]]) -> tuple[int, dict, bool]:
    """Contract §7: same key + same request -> stored response; same key + other request -> 409.

    Returns ``(status, body, replayed)``. Game errors raised by ``run`` are
    stored and replayed like successes.
    """
    key = check_idempotency_key(key)
    stored = store.get(account_id, key)
    if stored is not None:
        if stored.fingerprint != fingerprint:
            raise GameError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request.")
        return stored.status, stored.body, True
    try:
        status, body = run()
    except GameError as err:
        status, body = err.status, err.body()
    store.put(account_id, key, StoredResponse(fingerprint, status, body))
    return status, body, False


def place_bet(engine: RoundEngine, account_id: str, round_id: str, body: PlaceBetRequest) -> tuple[int, dict]:
    try:
        wager = parse_credits(body.wager)
        auto = None if body.autoCashOut is None else multiplier_from_float(body.autoCashOut)
    except ValueError as err:
        raise GameError("INVALID_REQUEST", str(err)) from None
    bet, balance = engine.place_bet(account_id, round_id, wager, auto)
    return 201, wire(BetResponse(
        betId=bet.bet_id, roundId=bet.round_id, wager=format_credits(bet.wager),
        autoCashOut=None if bet.auto_cash_out is None else multiplier_to_float(bet.auto_cash_out),
        status="active", balance=format_credits(balance),
    ))


def cash_out(engine: RoundEngine, account_id: str, round_id: str) -> tuple[int, dict]:
    bet, balance = engine.cash_out(account_id, round_id)
    return 200, wire(CashOutResponse(
        betId=bet.bet_id, status="cashed-out", multiplier=multiplier_to_float(bet.multiplier),
        payout=format_credits(bet.payout), profit=format_credits(bet.profit), balance=format_credits(balance),
    ))

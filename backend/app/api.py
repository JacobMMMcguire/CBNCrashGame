"""HTTP API (contract §8). Base path /api/v1.

Handlers are ``async def`` on purpose: they run on the event loop, the same
thread as the engine, so each command's check-then-act is atomic.
"""

from __future__ import annotations

import json
import uuid
from typing import Callable

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse

from .auth import account_id_from_header
from .config import public_config
from .errors import GameError
from .idempotency import StoredResponse
from .money import format_credits, multiplier_from_float, multiplier_to_float, parse_credits
from .schemas import (
    AccountResponse, BetResponse, CashOutRequest, CashOutResponse, CurrentRoundResponse,
    HealthResponse, HistoryResponse, PlaceBetRequest, PublicConfigResponse, VerifyResponse, wire,
)

router = APIRouter(prefix="/api/v1")


def services(request: Request):
    return request.app.state.services


def current_account(request: Request, authorization: str | None = Header(default=None)) -> str:
    account_id = account_id_from_header(authorization)
    svc = services(request)
    svc.ledger.ensure_account(account_id, svc.config.defaultLanguage)
    return account_id


def _check_key(key: str | None) -> str:
    try:
        if key is None or uuid.UUID(key).version != 4:
            raise ValueError
    except ValueError:
        raise GameError("INVALID_REQUEST", "Idempotency-Key header must be a UUID v4.") from None
    return key.lower()


def _idempotent(request: Request, account_id: str, key: str | None, body: dict,
                run: Callable[[], tuple[int, dict]]) -> JSONResponse:
    """Contract §7: same key + same body -> stored response; same key + other body -> 409."""
    key = _check_key(key)
    store = services(request).idempotency
    fingerprint = f"{request.method} {request.url.path} {json.dumps(body, sort_keys=True)}"
    stored = store.get(account_id, key)
    if stored is not None:
        if stored.fingerprint != fingerprint:
            raise GameError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request.")
        return JSONResponse(stored.body, stored.status, headers={"Idempotent-Replayed": "true"})
    try:
        status, response = run()
    except GameError as err:
        status, response = err.status, err.body()
    store.put(account_id, key, StoredResponse(fingerprint, status, response))
    return JSONResponse(response, status)


@router.get("/health", response_model=HealthResponse)
async def health(request: Request):
    svc = services(request)
    return {"status": "ok", "contractVersion": svc.config.contractVersion, "state": svc.engine.state}


@router.get("/config", response_model=PublicConfigResponse)
async def get_config(request: Request):
    return public_config(services(request).config)


@router.get("/account", response_model=AccountResponse)
async def get_account(request: Request, account_id: str = Depends(current_account)):
    acc = services(request).ledger.get_account(account_id)
    return {"accountId": acc.account_id, "balance": format_credits(acc.balance), "currency": "credits",
            "language": acc.language}


@router.get("/rounds/current", response_model=CurrentRoundResponse, response_model_exclude_unset=True)
async def get_current_round(request: Request, account_id: str = Depends(current_account)):
    return services(request).engine.snapshot(account_id)


@router.post("/rounds/{round_id}/bets", status_code=201, response_model=BetResponse)
async def place_bet(request: Request, round_id: str, body: PlaceBetRequest,
                    account_id: str = Depends(current_account),
                    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    engine = services(request).engine

    def run() -> tuple[int, dict]:
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

    return _idempotent(request, account_id, idempotency_key, wire(body), run)


@router.post("/rounds/{round_id}/cashout", response_model=CashOutResponse)
async def cash_out(request: Request, round_id: str, body: CashOutRequest | None = None,
                   account_id: str = Depends(current_account),
                   idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    engine = services(request).engine

    def run() -> tuple[int, dict]:
        bet, balance = engine.cash_out(account_id, round_id)
        return 200, wire(CashOutResponse(
            betId=bet.bet_id, status="cashed-out", multiplier=multiplier_to_float(bet.multiplier),
            payout=format_credits(bet.payout), profit=format_credits(bet.profit), balance=format_credits(balance),
        ))

    return _idempotent(request, account_id, idempotency_key, {}, run)


@router.get("/history", response_model=HistoryResponse, response_model_exclude_unset=True)
async def get_history(request: Request, limit: int = Query(default=20, ge=1, le=100),
                      account_id: str = Depends(current_account)):
    return {"rounds": services(request).engine.history(account_id, limit)}


@router.get("/rounds/{round_id}/verify", response_model=VerifyResponse)
async def verify_round(request: Request, round_id: str, account_id: str = Depends(current_account)):
    svc = services(request)
    v = svc.engine.verify(round_id)
    return {"roundId": round_id, "commitment": v.commitment, "serverSeed": v.server_seed, "hmac": v.hmac,
            "targetRtp": svc.config.targetRtp, "maxMultiplier": float(svc.config.maxMultiplier),
            "crash": multiplier_to_float(v.crash), "valid": v.valid}

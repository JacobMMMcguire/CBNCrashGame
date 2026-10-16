"""HTTP API (contract §8). Base path /api/v1.

Handlers are ``async def`` on purpose: they run on the event loop, the same
thread as the engine, so each command's check-then-act is atomic.
"""

from __future__ import annotations

import json
from typing import Callable

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse

from . import commands
from .auth import account_id_from_header
from .config import public_config
from .money import format_credits, multiplier_to_float
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


def _idempotent(request: Request, account_id: str, key: str | None, body: dict,
                run: Callable[[], tuple[int, dict]]) -> JSONResponse:
    """Contract §7, via the shared ``commands.run_idempotent``."""
    fingerprint = f"{request.method} {request.url.path} {json.dumps(body, sort_keys=True)}"
    status, response, replayed = commands.run_idempotent(
        services(request).idempotency, account_id, key, fingerprint, run)
    return JSONResponse(response, status, headers={"Idempotent-Replayed": "true"} if replayed else None)


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
        return commands.place_bet(engine, account_id, round_id, body)

    return _idempotent(request, account_id, idempotency_key, wire(body), run)


@router.post("/rounds/{round_id}/cashout", response_model=CashOutResponse)
async def cash_out(request: Request, round_id: str, body: CashOutRequest | None = None,
                   account_id: str = Depends(current_account),
                   idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    engine = services(request).engine

    def run() -> tuple[int, dict]:
        return commands.cash_out(engine, account_id, round_id)

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

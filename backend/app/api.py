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
from .clock import iso_ms
from .config import public_config
from .money import format_credits, multiplier_to_float
from .players import clean_name, display_name, player_id
from .schemas import (
    AccountResponse, BetResponse, CashOutRequest, CashOutResponse, CurrentRoundResponse,
    HealthResponse, HistoryResponse, PlaceBetRequest, PlayersResponse, PublicConfigResponse,
    SetNameRequest, VerifyResponse, wire,
)

router = APIRouter(prefix="/api/v1")

# Testing aids. main.create_app mounts this router only when dev cheats are
# enabled (ASCENT_DEV_CHEATS=1); otherwise these paths do not exist (404).
dev_router = APIRouter(prefix="/api/v1/dev", include_in_schema=False)
DEV_SKIP_HUNDREDTHS = 500  # "rectangle": +5.00x


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


def _account_body(acc) -> dict:
    return {"accountId": acc.account_id, "playerId": player_id(acc.account_id), "name": display_name(acc),
            "balance": format_credits(acc.balance), "currency": "credits", "language": acc.language}


@router.get("/account", response_model=AccountResponse)
async def get_account(request: Request, account_id: str = Depends(current_account)):
    return _account_body(services(request).ledger.get_account(account_id))


@router.post("/account/name", response_model=AccountResponse)
async def set_name(request: Request, body: SetNameRequest, account_id: str = Depends(current_account)):
    """Choose the pilot name other players see (2-16 characters)."""
    svc = services(request)
    acc = svc.ledger.set_name(account_id, clean_name(body.name))
    svc.engine.publish_roster()
    return _account_body(acc)


@router.get("/players", response_model=PlayersResponse, response_model_exclude_none=True)
async def get_players(request: Request, account_id: str = Depends(current_account)):
    """The current launch's roster and how many players are online (for resync)."""
    eng = services(request).engine
    return {"roundId": eng.round.round_id, "players": eng.roster(), "online": eng.online_count()}


@router.post("/account/refill", response_model=AccountResponse)
async def refill_account(request: Request, account_id: str = Depends(current_account)):
    """Play credits only: refill a broke account to startingBalance (409 REFILL_NOT_NEEDED otherwise)."""
    svc = services(request)
    svc.engine.refill(account_id)
    return _account_body(svc.ledger.get_account(account_id))


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


@dev_router.post("/skip")
async def dev_skip(request: Request, account_id: str = Depends(current_account)):
    """Cheat code "rectangle": jump the current flight forward by +5.00x (testing only)."""
    launched_at, multiplier = services(request).engine.skip_ahead(DEV_SKIP_HUNDREDTHS)
    return {"launchedAt": iso_ms(launched_at), "multiplier": multiplier_to_float(multiplier)}

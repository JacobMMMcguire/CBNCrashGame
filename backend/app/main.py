"""App factory: wires config, stubs, engine, API, realtime and static files.

Run it with ``python -m app`` (see app/__main__.py) or the scripts in scripts/.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import mimetypes
import os
from dataclasses import dataclass

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import api, realtime
from .clock import Clock, SystemClock
from .config import REPO_ROOT, GameConfig, load_config
from .engine import RoundEngine
from .errors import GameError
from .fairness import FairnessScheme, Sha256Fairness
from .idempotency import IdempotencyStore, InMemoryIdempotencyStore
from .ledger import InMemoryLedger, Ledger
from .rng import CrashPointProvider, ProvablyFairCrashPointProvider

log = logging.getLogger("ascent")

FRONTEND_DIR = REPO_ROOT / "frontend"
CONTRACT_DIR = REPO_ROOT / "contract"

# Windows can map .js to text/plain through the registry, which breaks ES modules.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("audio/mpeg", ".mp3")


@dataclass
class Services:
    config: GameConfig
    engine: RoundEngine
    ledger: Ledger
    idempotency: IdempotencyStore
    broadcaster: realtime.Broadcaster


def create_app(
    config: GameConfig | None = None,
    *,
    clock: Clock | None = None,
    provider: CrashPointProvider | None = None,
    fairness: FairnessScheme | None = None,
    ledger: Ledger | None = None,
    autostart: bool = True,
    dev_cheats: bool | None = None,
) -> FastAPI:
    """Build the app. Swap a stub for a real implementation by passing it here.

    ``autostart=False`` leaves the round loop stopped so tests can drive the
    engine by hand.
    """
    config = config or load_config()
    ledger = ledger or InMemoryLedger(config.starting_balance_units)
    broadcaster = realtime.Broadcaster()
    rtp, cap = config.targetRtp, config.max_multiplier_hundredths
    engine = RoundEngine(
        config,
        ledger,
        provider or ProvablyFairCrashPointProvider(rtp, cap),
        fairness or Sha256Fairness(rtp, cap),
        clock or SystemClock(),
        broadcaster,
    )
    services = Services(config, engine, ledger, InMemoryIdempotencyStore(), broadcaster)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(engine.run_forever()) if autostart else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(title="Ascent (skeleton)", version=config.contractVersion, lifespan=lifespan)
    app.state.services = services

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.server.corsAllowOrigins),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.exception_handler(GameError)
    async def _game_error(request: Request, err: GameError):
        return JSONResponse(err.body(), err.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, err: RequestValidationError):
        parts = []
        for e in err.errors():
            where = ".".join(str(p) for p in e["loc"] if p != "body")
            parts.append(f"{where}: {e['msg']}" if where else e["msg"])
        body = GameError("INVALID_REQUEST", "; ".join(parts) or "Invalid request.").body()
        return JSONResponse(body, 422)

    app.include_router(api.router)
    if dev_cheats if dev_cheats is not None else os.environ.get("ASCENT_DEV_CHEATS") == "1":
        log.warning("Dev cheats are ON (ASCENT_DEV_CHEATS=1). Never enable this outside local testing.")
        app.include_router(api.dev_router)
    app.include_router(realtime.router)

    @app.get("/", include_in_schema=False)
    @app.get("/app", include_in_schema=False)
    async def _to_app():
        return RedirectResponse("/app/")

    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    # The frontend's mock mode (?mock=1) reads its event templates from here.
    app.mount("/contract", StaticFiles(directory=CONTRACT_DIR), name="contract")
    return app

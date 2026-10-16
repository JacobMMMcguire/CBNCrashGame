"""App factory: wires config, stubs, engine, API, realtime and static files.

Run it with ``python -m app`` (see app/__main__.py) or the scripts in scripts/.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import mimetypes
from dataclasses import dataclass
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import api, realtime, rooms_api
from .clock import Clock, SystemClock
from .config import REPO_ROOT, GameConfig, load_config
from .engine import RoundEngine
from .errors import GameError
from .fairness import FairnessScheme, PlaceholderFairness
from .idempotency import IdempotencyStore, InMemoryIdempotencyStore
from .ledger import InMemoryLedger, Ledger
from .rng import CrashPointProvider, FixedSequenceCrashPointProvider
from .rooms import RoomRegistry
from .settings import Settings, load_settings
from .storage import Storage, create_storage

log = logging.getLogger("ascent")

FRONTEND_DIR = REPO_ROOT / "frontend"
CONTRACT_DIR = REPO_ROOT / "contract"

# Windows can map .js to text/plain through the registry, which breaks ES modules.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")


@dataclass
class Services:
    config: GameConfig
    engine: RoundEngine
    ledger: Ledger
    idempotency: IdempotencyStore
    broadcaster: realtime.Broadcaster
    settings: Settings
    storage: Storage
    rooms: RoomRegistry


def create_app(
    config: GameConfig | None = None,
    *,
    clock: Clock | None = None,
    provider: CrashPointProvider | None = None,
    fairness: FairnessScheme | None = None,
    ledger: Ledger | None = None,
    autostart: bool = True,
    settings: Settings | None = None,
    storage: Storage | None = None,
    room_provider_factory: Callable[[], CrashPointProvider] | None = None,
) -> FastAPI:
    """Build the app. Swap a stub for a real implementation by passing it here.

    ``autostart=False`` leaves the round loop stopped so tests can drive the
    engine by hand. It also keeps room round loops from starting on the host's
    Start, and turns off the seat sweeper.
    """
    config = config or load_config()
    settings = settings or load_settings()
    storage = storage or create_storage(settings)
    ledger = ledger or InMemoryLedger(config.starting_balance_units)
    broadcaster = realtime.Broadcaster()
    engine = RoundEngine(
        config,
        ledger,
        # SKELETON ONLY stubs. Replace them here when the real modules land.
        provider or FixedSequenceCrashPointProvider(max_multiplier=config.max_multiplier_hundredths),
        fairness or PlaceholderFairness(),
        clock or SystemClock(),
        broadcaster,
    )
    fairness = engine.fairness
    rooms = RoomRegistry(
        config=config, settings=settings, storage=storage, clock=engine.clock,
        # SKELETON ONLY: every room gets the same fixed, repeating crash list.
        provider_factory=room_provider_factory or (
            lambda: FixedSequenceCrashPointProvider(max_multiplier=config.max_multiplier_hundredths)),
        fairness=fairness, autorun=autostart,
    )
    services = Services(config, engine, ledger, InMemoryIdempotencyStore(), broadcaster, settings, storage, rooms)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        tasks = [asyncio.create_task(engine.run_forever()), asyncio.create_task(rooms.run_sweeper())]             if autostart else []
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await rooms.shutdown()
            storage.close()

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
    app.include_router(realtime.router)
    app.include_router(rooms_api.router)
    app.include_router(rooms_api.pages)

    @app.get("/", include_in_schema=False)
    @app.get("/app", include_in_schema=False)
    async def _to_app():
        return RedirectResponse("/app/")

    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    # The frontend's mock mode (?mock=1) reads its event templates from here.
    app.mount("/contract", StaticFiles(directory=CONTRACT_DIR), name="contract")
    return app

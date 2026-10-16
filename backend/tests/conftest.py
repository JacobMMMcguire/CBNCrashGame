from __future__ import annotations

import json
import os
import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.clock import ManualClock
from app.config import DEFAULT_CONFIG_PATH, GameConfig, parse_config
from app.engine import RoundEngine
from app.fairness import PlaceholderFairness
from app.ledger import InMemoryLedger
from app.main import create_app
from app.rng import FixedSequenceCrashPointProvider

# Tests never touch the developer's SQLite file or .env values: the .env loader
# does not override variables that are already set.
os.environ["STORAGE_BACKEND"] = "memory"
os.environ["PUBLIC_BASE_URL"] = "http://testserver"
os.environ["SEAT_HOLD_SECONDS"] = "120"

TOKEN = "test-token-0123456789"
OTHER_TOKEN = "other-token-0123456789"


def raw_config() -> dict:
    return json.loads(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"), parse_float=Decimal)


def make_config(**overrides) -> GameConfig:
    return parse_config({**raw_config(), **overrides})


class RecordingSink:
    def __init__(self) -> None:
        self.events: list[tuple[dict, str | None]] = []

    def publish(self, event: dict, account_id: str | None = None) -> None:
        self.events.append((json.loads(json.dumps(event)), account_id))

    def types(self, presence: bool = False) -> list[str]:
        """Event types in order. round.players (the multiplayer roster) is a separate
        stream interleaved with the lifecycle, so it is left out unless asked for."""
        return [e["type"] for e, _ in self.events if presence or e["type"] != "round.players"]


@pytest.fixture
def config() -> GameConfig:
    # Engine tests assert exact timings and caps, so they pin these two values
    # instead of following whatever config/game.json is tuned to.
    return make_config(growthRate=0.12, maxMultiplier=Decimal("100.00"))


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def sink() -> RecordingSink:
    return RecordingSink()


def make_engine(config, clock, sink, sequence=(247,)):
    ledger = InMemoryLedger(config.starting_balance_units)
    provider = FixedSequenceCrashPointProvider(sequence)
    return RoundEngine(config, ledger, provider, PlaceholderFairness(), clock, sink)


@pytest.fixture
def engine(config, clock, sink):
    return make_engine(config, clock, sink)


@pytest.fixture
def app_and_clock(config):
    """App with the round loop stopped and a manual clock, so tests drive the engine."""
    clock = ManualClock()
    app = create_app(config, clock=clock, provider=FixedSequenceCrashPointProvider((247,)),
                     fairness=PlaceholderFairness(), autostart=False)
    return app, clock


@pytest.fixture
def client(app_and_clock):
    app, _ = app_and_clock
    return TestClient(app)


def auth(token: str = TOKEN, key: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def new_key() -> str:
    return str(uuid.uuid4())

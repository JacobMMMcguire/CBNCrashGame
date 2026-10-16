"""Shared helpers for the multiplayer tests.

Room tests run the app inside ``with TestClient(app) as client`` so every HTTP
call and WebSocket shares one event loop, and drive each room's engine on that
loop with ``client.portal.call`` (the room round loop is not started).
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.clock import ManualClock
from app.main import create_app
from app.rng import FixedSequenceCrashPointProvider
from app.settings import Settings
from app.storage import InMemoryStorage

from .conftest import make_config

SEAT_HOLD_SECONDS = 60


def room_app(sequence=(247,), **config_overrides):
    clock = ManualClock()
    storage = InMemoryStorage()
    app = create_app(
        make_config(**config_overrides), clock=clock, autostart=False, storage=storage,
        settings=Settings(public_base_url="http://testserver", storage_backend="memory",
                          seat_hold_seconds=SEAT_HOLD_SECONDS),
        room_provider_factory=lambda: FixedSequenceCrashPointProvider(sequence),
    )
    return app, clock, storage


def host_room(client: TestClient) -> dict:
    r = client.post("/api/v1/rooms")
    assert r.status_code == 201, r.json()
    return r.json()


def join(client: TestClient, code: str, name: str):
    return client.post(f"/api/v1/rooms/{code}/players", json={"name": name})


def join_ok(client: TestClient, code: str, name: str) -> dict:
    r = join(client, code, name)
    assert r.status_code == 201, r.json()
    return r.json()


def room_of(client: TestClient, code: str):
    return client.app.state.services.rooms.get(code)


def recv(ws, type_: str, limit: int = 200) -> dict:
    """Read messages until one of ``type_`` arrives (the server queues them in order)."""
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == type_:
            return msg
    raise AssertionError(f"no {type_} message")


def socket(client: TestClient, code: str):
    return client.websocket_connect(f"/api/v1/rooms/{code}/ws")


def hello(ws, role: str, token: str) -> dict:
    """Say hello on an open room socket and return the welcome data."""
    ws.send_json({"type": "hello", "role": role, "token": token})
    return recv(ws, "welcome")["data"]


def act(ws, type_: str, **fields) -> dict:
    """Send one action and return its reply's data."""
    ref = uuid.uuid4().hex[:8]
    ws.send_json({"type": type_, "ref": ref, **fields})
    reply = recv(ws, "reply")
    assert reply["data"]["ref"] == ref
    return reply["data"]


def bet(ws, round_id: str, wager: str = "10.00", key: str | None = None, **extra) -> dict:
    return act(ws, "place_bet", roundId=round_id, wager=wager, idempotencyKey=key or str(uuid.uuid4()), **extra)


def cash_out(ws, round_id: str, key: str | None = None) -> dict:
    return act(ws, "cash_out", roundId=round_id, idempotencyKey=key or str(uuid.uuid4()))

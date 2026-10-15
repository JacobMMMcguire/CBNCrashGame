"""WebSocket smoke test against the real server-clock loop (fast timings)."""

import json

from fastapi.testclient import TestClient

from app.main import create_app
from app.rng import FixedSequenceCrashPointProvider
from app.schemas import EVENT_MODELS

from .conftest import TOKEN, auth, make_config, new_key


def test_websocket_round_smoke():
    config = make_config(bettingWindowMs=400, tickIntervalMs=20, settleDelayMs=50, growthRate=2.0)
    app = create_app(config, provider=FixedSequenceCrashPointProvider((150,)))
    with TestClient(app) as client, client.websocket_connect(f"/api/v1/ws?token={TOKEN}") as ws:
        seen, bet_placed = [], False
        while True:
            msg = ws.receive_json()
            EVENT_MODELS[msg["type"]].model_validate(msg)  # every event matches its schema
            seen.append(msg)
            if msg["type"] == "round.betting" and not bet_placed:
                rid = msg["roundId"]
                r = client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "10.00"}, headers=auth(key=new_key()))
                assert r.status_code == 201, r.json()
                bet_placed = True
            if bet_placed and msg["type"] == "history.updated":
                break
    types = [m["type"] for m in seen]
    start = types.index("round.betting")
    types = types[start:]
    seen = seen[start:]
    assert "balance.updated" in types  # private event reached this player
    assert types.index("round.launched") < types.index("round.tick") < types.index("round.crashed")
    assert types[-2:] == ["round.settled", "history.updated"]
    seqs = [m["seq"] for m in seen]
    assert seqs == list(range(seqs[0], seqs[0] + len(seqs)))
    crashed = next(m for m in seen if m["type"] == "round.crashed")
    assert crashed["data"]["crash"] == 1.5
    for m in seen[: seen.index(crashed)]:
        text = json.dumps(m)
        assert crashed["data"]["serverSeed"] not in text and '"crash"' not in text


def test_websocket_rejects_bad_token():
    app = create_app(make_config(), autostart=False)
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/api/v1/ws?token=x") as ws:
                ws.receive_json()
            raise AssertionError("connection should have been refused")
        except Exception as err:  # starlette raises WebSocketDisconnect with code 4401
            assert getattr(err, "code", None) == 4401

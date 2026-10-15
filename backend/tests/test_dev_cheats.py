"""The "rectangle" testing cheat: off by default, and it never changes the crash point."""

from fastapi.testclient import TestClient

from app.clock import ManualClock
from app.main import create_app

from .conftest import auth


def _app(config, **kw):
    clock = ManualClock()
    client = TestClient(create_app(config, clock=clock, autostart=False, **kw))
    return client, client.app.state.services.engine, clock


def test_cheat_endpoint_does_not_exist_by_default(config, monkeypatch):
    monkeypatch.delenv("ASCENT_DEV_CHEATS", raising=False)
    client, _, _ = _app(config)
    assert client.post("/api/v1/dev/skip", headers=auth()).status_code == 404


def test_skip_adds_five_and_keeps_the_crash_point(config):
    client, eng, clock = _app(config, dev_cheats=True)
    assert client.post("/api/v1/dev/skip", headers=auth()).json()["error"]["code"] == "ROUND_NOT_IN_FLIGHT"
    eng.open_betting()
    clock.advance(config.bettingWindowMs)
    eng.launch()
    crash, seed = eng.round.crash, eng.round.secret.server_seed
    clock.advance(1000)
    r = client.post("/api/v1/dev/skip", headers=auth()).json()
    assert 5.0 <= r["multiplier"] - 1.0 <= 5.2  # from ~1.0x (one second in) to ~6.0x
    assert eng.round.crash == crash and eng.round.secret.server_seed == seed
    clock.advance(10**9)
    assert eng.tick()  # crashes at the unchanged crash point
    v = client.get(f"/api/v1/rounds/{eng.round.round_id}/verify", headers=auth()).json()
    assert v["valid"] is True and v["crash"] == crash / 100

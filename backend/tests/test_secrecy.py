"""Contract §1.2: the crash point and seed never leave the server before the crash."""

import json

from .conftest import auth, make_engine, new_key


def _assert_sealed(payload, crash: float, seed: str, where: str):
    text = json.dumps(payload)
    assert seed not in text, f"seed leaked in {where}"
    assert '"crash"' not in text, f"crash key leaked in {where}"
    assert '"serverSeed"' not in text, f"serverSeed key leaked in {where}"
    if isinstance(payload, dict) and payload.get("type") == "round.tick":
        assert payload["data"]["multiplier"] < crash, f"tick reached the crash point in {where}"


def test_no_event_before_crash_reveals_it(config, clock, sink):
    sequence = (100, 101, 247, 1240, 10_000)
    engine = make_engine(config, clock, sink, sequence=sequence)
    acc = engine.ledger.ensure_account("acc_a", "en").account_id
    for _ in sequence:
        if engine.state == "settled":
            engine.prepare_round()
        r = engine.round
        crash, seed = r.crash / 100, r.secret.server_seed
        start = len(sink.events)
        engine.open_betting()
        engine.place_bet(acc, r.round_id, 100, 200)
        _assert_sealed(engine.snapshot(acc), crash, seed, "snapshot during betting")
        clock.advance(config.bettingWindowMs)
        engine.launch()
        while not engine.tick():
            _assert_sealed(engine.snapshot(acc), crash, seed, "snapshot in flight")
            clock.advance(config.tickIntervalMs)
        engine.settle()
        events = [e for e, _ in sink.events[start:]]
        crashed_at = next(i for i, e in enumerate(events) if e["type"] == "round.crashed")
        for e in events[:crashed_at]:
            _assert_sealed(e, crash, seed, e["type"])
        assert events[crashed_at]["data"]["crash"] == crash
        assert events[crashed_at]["data"]["serverSeed"] == seed
        assert engine.snapshot(acc)["crash"] == crash


def test_http_responses_before_crash_are_sealed(client, app_and_clock):
    _, clock = app_and_clock
    eng = client.app.state.services.engine
    seed, crash = eng.round.secret.server_seed, eng.round.crash / 100
    eng.open_betting()
    rid = eng.round.round_id
    responses = [
        client.get("/api/v1/rounds/current", headers=auth()).json(),
        client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "10.00"}, headers=auth(key=new_key())).json(),
    ]
    clock.advance(eng.config.bettingWindowMs)
    eng.launch()
    clock.advance(1_000)
    responses.append(client.get("/api/v1/rounds/current", headers=auth()).json())
    responses.append(client.post(f"/api/v1/rounds/{rid}/cashout", json={}, headers=auth(key=new_key())).json())
    responses.append(client.get("/api/v1/history", headers=auth()).json())
    for i, body in enumerate(responses):
        _assert_sealed(body, crash, seed, f"response {i}")

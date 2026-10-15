from .conftest import OTHER_TOKEN, auth, new_key


def _engine(client):
    return client.app.state.services.engine


def _open(client):
    _engine(client).open_betting()
    return _engine(client).round.round_id


def _launch(client, clock, after_ms=5_000):
    eng = _engine(client)
    clock.advance(eng.config.bettingWindowMs)
    eng.launch()
    clock.advance(after_ms)


def test_health_and_auth(client):
    assert client.get("/api/v1/health").json()["status"] == "ok"
    r = client.get("/api/v1/account")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"
    acc = client.get("/api/v1/account", headers=auth()).json()
    assert acc["balance"] == "1000.00" and acc["currency"] == "credits"


def test_bet_is_idempotent(client):
    rid = _open(client)
    key = new_key()
    body = {"wager": "100.00", "autoCashOut": None}
    first = client.post(f"/api/v1/rounds/{rid}/bets", json=body, headers=auth(key=key))
    again = client.post(f"/api/v1/rounds/{rid}/bets", json=body, headers=auth(key=key))
    assert first.status_code == again.status_code == 201
    assert first.json() == again.json()
    assert again.headers.get("Idempotent-Replayed") == "true"
    assert client.get("/api/v1/account", headers=auth()).json()["balance"] == "900.00"


def test_same_key_different_body_is_rejected(client):
    rid = _open(client)
    key = new_key()
    client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "100.00"}, headers=auth(key=key))
    r = client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "200.00"}, headers=auth(key=key))
    assert r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_second_bet_with_new_key_is_already_bet(client):
    rid = _open(client)
    client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "100.00"}, headers=auth(key=new_key()))
    r = client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "100.00"}, headers=auth(key=new_key()))
    assert r.status_code == 409 and r.json()["error"]["code"] == "ALREADY_BET"


def test_cash_out_pays_once(client, app_and_clock):
    _, clock = app_and_clock
    rid = _open(client)
    client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "100.00"}, headers=auth(key=new_key()))
    _launch(client, clock)
    key = new_key()
    first = client.post(f"/api/v1/rounds/{rid}/cashout", json={}, headers=auth(key=key))
    assert first.status_code == 200, first.json()
    assert first.json()["multiplier"] == 1.82 and first.json()["payout"] == "182.00"
    clock.advance(500)  # the multiplier has moved on; a replay must not re-price
    again = client.post(f"/api/v1/rounds/{rid}/cashout", json={}, headers=auth(key=key))
    other_key = client.post(f"/api/v1/rounds/{rid}/cashout", json={}, headers=auth(key=new_key()))
    assert first.json() == again.json() == other_key.json()
    assert client.get("/api/v1/account", headers=auth()).json()["balance"] == "1082.00"


def test_validation_and_range_errors(client):
    rid = _open(client)
    cases = [
        ({"wager": "100"}, new_key(), "INVALID_REQUEST"),
        ({"wager": "0.50"}, new_key(), "BET_OUT_OF_RANGE"),
        ({"wager": "100.00", "autoCashOut": 1.0}, new_key(), "INVALID_REQUEST"),
        ({"wager": "100.00"}, "not-a-uuid", "INVALID_REQUEST"),
    ]
    for body, key, code in cases:
        r = client.post(f"/api/v1/rounds/{rid}/bets", json=body, headers=auth(key=key))
        assert r.json()["error"]["code"] == code, (body, r.json())
    r = client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "100.00"}, headers=auth())
    assert r.json()["error"]["code"] == "INVALID_REQUEST"  # missing Idempotency-Key


def test_insufficient_balance(client):
    rid = _open(client)
    eng = _engine(client)
    # Lower this account's balance below the max bet.
    client.get("/api/v1/account", headers=auth(OTHER_TOKEN))
    acc_id = next(iter(eng.ledger._accounts))
    eng.ledger.place_bet(acc_id, "r_0", 99_000, None)
    r = client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "50.00"}, headers=auth(OTHER_TOKEN, new_key()))
    assert r.status_code == 422 and r.json()["error"]["code"] == "INSUFFICIENT_BALANCE"


def test_cash_out_errors(client, app_and_clock):
    _, clock = app_and_clock
    rid = _open(client)
    r = client.post(f"/api/v1/rounds/{rid}/cashout", json={}, headers=auth(key=new_key()))
    assert r.json()["error"]["code"] == "NO_ACTIVE_BET"
    client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "100.00"}, headers=auth(key=new_key()))
    _launch(client, clock, after_ms=60_000)
    r = client.post(f"/api/v1/rounds/{rid}/cashout", json={}, headers=auth(key=new_key()))
    assert r.status_code == 409 and r.json()["error"]["code"] == "TOO_LATE"


def test_history_and_verify(client, app_and_clock):
    _, clock = app_and_clock
    eng = _engine(client)
    rid = _open(client)
    client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "100.00"}, headers=auth(key=new_key()))
    r = client.get(f"/api/v1/rounds/{rid}/verify", headers=auth())
    assert r.json()["error"]["code"] == "ROUND_NOT_FINISHED"
    _launch(client, clock, after_ms=60_000)
    eng.tick()
    eng.settle()
    rounds = client.get("/api/v1/history", headers=auth()).json()["rounds"]
    assert rounds == [{"roundId": rid, "crash": 2.47,
                       "myResult": {"wager": "100.00", "status": "lost", "profit": "-100.00"}}]
    v = client.get(f"/api/v1/rounds/{rid}/verify", headers=auth()).json()
    assert v["crash"] == 2.47 and v["valid"] is False  # placeholder fairness never claims validity
    assert client.get("/api/v1/rounds/r_999/verify", headers=auth()).status_code == 404


def test_frontend_is_served(client):
    r = client.get("/app/")
    assert r.status_code == 200 and "<main" in r.text
    js = client.get("/app/js/main.js")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"]
    assert client.get("/contract/examples/events/round.tick.json").status_code == 200

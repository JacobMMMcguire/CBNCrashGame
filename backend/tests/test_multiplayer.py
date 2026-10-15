"""Multiplayer presence: pilot names, the public roster and round.players broadcasts."""

import json

from app.players import callsign, player_id

from .conftest import OTHER_TOKEN, TOKEN, auth, new_key


def _ids(client, token):
    body = client.get("/api/v1/account", headers=auth(token)).json()
    return body["accountId"], body["playerId"], body["name"]


def test_every_player_has_a_stable_callsign_and_can_rename(client):
    acc, pid, name = _ids(client, TOKEN)
    assert pid == player_id(acc) and name == callsign(acc)
    assert _ids(client, TOKEN)[2] == name  # stable across requests
    r = client.post("/api/v1/account/name", json={"name": "  Ace   Pilot "}, headers=auth())
    assert r.status_code == 200 and r.json()["name"] == "Ace Pilot"
    for bad in ("x", "a" * 17, "<script>"):
        r = client.post("/api/v1/account/name", json={"name": bad}, headers=auth())
        assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST"


def test_roster_shows_everyone_but_keeps_private_details_private(client, app_and_clock):
    _, clock = app_and_clock
    eng = client.app.state.services.engine
    eng.open_betting()
    rid = eng.round.round_id
    client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "50.00", "autoCashOut": 2.0},
                headers=auth(TOKEN, new_key()))
    client.post(f"/api/v1/rounds/{rid}/bets", json={"wager": "200.00", "autoCashOut": None},
                headers=auth(OTHER_TOKEN, new_key()))
    roster = client.get("/api/v1/players", headers=auth()).json()
    assert [p["wager"] for p in roster["players"]] == ["200.00", "50.00"]  # biggest first
    text = json.dumps(roster)
    assert "acc_" not in text and "autoCashOut" not in text and "2.0" not in text

    clock.advance(client.app.state.services.config.bettingWindowMs)
    eng.launch()
    clock.advance(3000)
    client.post(f"/api/v1/rounds/{rid}/cashout", json={}, headers=auth(OTHER_TOKEN, new_key()))
    players = client.get("/api/v1/players", headers=auth()).json()["players"]
    big = next(p for p in players if p["wager"] == "200.00")
    assert big["status"] == "cashed-out" and big["multiplier"] > 1 and "payout" in big
    small = next(p for p in players if p["wager"] == "50.00")
    assert small["status"] == "active" and "multiplier" not in small


def test_roster_is_broadcast_on_every_change(engine, sink, clock, config):
    a = engine.ledger.ensure_account("acc_a", "en").account_id
    b = engine.ledger.ensure_account("acc_b", "en").account_id
    engine.online_count = lambda: 2
    engine.open_betting()
    engine.place_bet(a, engine.round.round_id, 1000, None)
    engine.place_bet(b, engine.round.round_id, 2000, 150)
    clock.advance(config.bettingWindowMs)
    engine.launch()
    clock.advance(10_000)
    while not engine.tick():
        clock.advance(config.tickIntervalMs)
    rosters = [e for e, who in sink.events if e["type"] == "round.players"]
    assert all(who is None for e, who in sink.events if e["type"] == "round.players")  # sent to everyone
    assert [len(r["data"]["players"]) for r in rosters[:3]] == [0, 1, 2]
    final = rosters[-1]["data"]
    assert final["online"] == 2
    assert {p["status"] for p in final["players"]} == {"lost", "cashed-out"}
    # The crash point never appears in a roster before the crash event
    crashed_at = next(i for i, (e, _) in enumerate(sink.events) if e["type"] == "round.crashed")
    for e, _ in sink.events[:crashed_at]:
        if e["type"] == "round.players":
            assert "crash" not in json.dumps(e) and "serverSeed" not in json.dumps(e)

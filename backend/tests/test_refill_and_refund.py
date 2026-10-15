"""Refilling a broke play account, and refunding bets when a round fails."""

from .conftest import auth


def _broke(engine, acc, config):
    engine.ledger.refill(acc, config.min_bet_units - 1)


def test_refill_only_when_broke(client, config):
    eng = client.app.state.services.engine
    r = client.post("/api/v1/account/refill", headers=auth())
    assert r.status_code == 409 and r.json()["error"]["code"] == "REFILL_NOT_NEEDED"
    acc = client.get("/api/v1/account", headers=auth()).json()["accountId"]
    _broke(eng, acc, config)
    r = client.post("/api/v1/account/refill", headers=auth())
    assert r.status_code == 200
    assert r.json()["balance"] == f"{config.startingBalance:.2f}"


def test_no_refill_while_a_bet_is_riding(engine, config, clock):
    acc = engine.ledger.ensure_account("acc_a", "en").account_id
    engine.open_betting()
    engine.place_bet(acc, engine.round.round_id, config.min_bet_units, None)
    _broke(engine, acc, config)
    try:
        engine.refill(acc)
        raise AssertionError("refill should be refused while a bet is active")
    except Exception as err:
        assert getattr(err, "code", None) == "REFILL_NOT_NEEDED"


def test_failed_round_refunds_active_bets(engine, config, clock, sink):
    acc = engine.ledger.ensure_account("acc_a", "en").account_id
    start = engine.ledger.get_account(acc).balance
    engine.open_betting()
    engine.place_bet(acc, engine.round.round_id, 5000, None)
    clock.advance(config.bettingWindowMs)
    engine.launch()
    engine._abandon_round()
    bet = engine.ledger.get_bet(acc, engine.round.round_id)
    assert bet.status == "cashed-out" and bet.multiplier == 100 and bet.payout == 5000
    assert engine.ledger.get_account(acc).balance == start
    assert engine.state == "settled"

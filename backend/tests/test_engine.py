import asyncio

import pytest

from app.engine import InvalidTransition
from app.errors import GameError

from .conftest import make_engine


def test_initial_state_is_idle(engine):
    assert engine.state == "idle"
    assert engine.round.round_id == "r_1"


def test_happy_path_transitions(engine, clock, sink):
    engine.open_betting()
    assert engine.state == "betting"
    clock.advance(engine.config.bettingWindowMs)
    engine.launch()
    assert engine.state == "in-flight"
    assert engine.tick() is False
    clock.advance(60_000)
    assert engine.tick() is True
    assert engine.state == "crashed"
    engine.settle()
    assert engine.state == "settled"
    engine.prepare_round()
    assert engine.state == "idle" and engine.round.round_id == "r_2"
    assert sink.types() == [
        "round.betting", "round.launched", "round.tick", "round.crashed", "round.settled", "history.updated",
    ]


@pytest.mark.parametrize("step", ["launch", "crash", "settle", "prepare_round"])
def test_illegal_transitions_from_idle(engine, step):
    with pytest.raises(InvalidTransition):
        getattr(engine, step)()


def test_cannot_skip_flight(engine):
    engine.open_betting()
    with pytest.raises(InvalidTransition):
        engine.crash()
    with pytest.raises(InvalidTransition):
        engine.open_betting()


def test_bet_only_in_betting_and_cash_out_only_in_flight(engine, clock):
    acc = engine.ledger.ensure_account("acc_a", "en").account_id
    with pytest.raises(GameError) as e:
        engine.place_bet(acc, "r_1", 10_000, None)
    assert e.value.code == "BET_WINDOW_CLOSED"
    engine.open_betting()
    engine.place_bet(acc, "r_1", 10_000, None)
    with pytest.raises(GameError) as e:
        engine.cash_out(acc, "r_1")
    assert e.value.code == "ROUND_NOT_IN_FLIGHT"
    clock.advance(engine.config.bettingWindowMs)
    engine.launch()
    clock.advance(5_000)  # m = floor(e^0.6 * 100) = 182
    bet, balance = engine.cash_out(acc, "r_1")
    assert bet.multiplier == 182
    assert bet.payout == 18_200
    assert balance == 100_000 - 10_000 + 18_200


def test_cash_out_at_or_after_crash_is_too_late(engine, clock):
    acc = engine.ledger.ensure_account("acc_a", "en").account_id
    engine.open_betting()
    engine.place_bet(acc, "r_1", 10_000, None)
    clock.advance(engine.config.bettingWindowMs)
    engine.launch()
    clock.advance(engine.round.crash_at - clock.now_ms())  # exactly at crashAtMs
    with pytest.raises(GameError) as e:
        engine.cash_out(acc, "r_1")
    assert e.value.code == "TOO_LATE"


def test_crash_at_one_crashes_on_launch(config, clock, sink):
    engine = make_engine(config, clock, sink, sequence=(100,))
    engine.open_betting()
    clock.advance(config.bettingWindowMs)
    engine.launch()
    assert engine.tick() is True
    assert engine.state == "crashed"


def test_auto_cash_out_pays_exactly_the_target(engine, clock):
    acc = engine.ledger.ensure_account("acc_a", "en").account_id
    engine.open_betting()
    engine.place_bet(acc, "r_1", 10_000, 150)
    clock.advance(engine.config.bettingWindowMs)
    engine.launch()
    clock.advance(4_000)  # m ~ 1.61, past the 1.50 target
    engine.tick()
    bet = engine.ledger.get_bet(acc, "r_1")
    assert bet.status == "cashed-out" and bet.auto and bet.multiplier == 150 and bet.payout == 15_000


def test_auto_target_between_last_tick_and_crash_still_pays(engine, clock):
    acc = engine.ledger.ensure_account("acc_a", "en").account_id
    engine.open_betting()
    engine.place_bet(acc, "r_1", 10_000, 246)  # crash is 2.47
    clock.advance(engine.config.bettingWindowMs)
    engine.launch()
    clock.advance(60_000)
    engine.tick()  # crashes without an intermediate tick
    assert engine.ledger.get_bet(acc, "r_1").status == "cashed-out"


def test_run_round_on_server_clock(engine, sink):
    asyncio.run(engine.run_round())
    types = sink.types()
    assert types[0] == "round.betting" and types[1] == "round.launched"
    assert types[-3:] == ["round.crashed", "round.settled", "history.updated"]
    ticks = [e for e, _ in sink.events if e["type"] == "round.tick"]
    gaps = {b["data"]["elapsedMs"] - a["data"]["elapsedMs"] for a, b in zip(ticks, ticks[1:])}
    assert gaps == {engine.config.tickIntervalMs}
    multipliers = [t["data"]["multiplier"] for t in ticks]
    assert multipliers == sorted(multipliers) and multipliers[-1] < 2.47
    assert engine.state == "settled"

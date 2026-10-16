"""PostgreSQL storage (app/postgres.py) against a real database.

Skipped unless TEST_DATABASE_URL points at a throwaway database; the tests drop
and recreate the Ascent tables in it. For example, with Docker:

    docker run -d --name ascent-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16
    TEST_DATABASE_URL=postgresql://postgres:pg@localhost:55432/postgres pytest backend/tests/test_postgres.py

Never point it at the Supabase project.
"""

from __future__ import annotations

import os

import pytest

from app.errors import GameError
from app.idempotency import StoredResponse

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL is not set")

if URL:
    from app import postgres

START = 100_000  # 1,000.00 credits
ACC, OTHER = "acc_aaaaaaaaaaaa", "acc_bbbbbbbbbbbb"


@pytest.fixture
def pool():
    from psycopg_pool import ConnectionPool

    with ConnectionPool(URL, open=True) as admin, admin.connection() as conn:
        conn.execute("drop table if exists bets, rounds, idempotency_keys, accounts cascade; "
                     "drop sequence if exists round_no_seq")
    pool = postgres.connect(URL)
    yield pool
    pool.close()


def restart(pool):
    """A fresh process: new memory, same database."""
    return postgres.PostgresLedger(pool, START)


def balance_in_db(pool, account_id):
    with pool.connection() as conn:
        return conn.execute("select balance from accounts where account_id = %s", (account_id,)).fetchone()[0]


def test_bet_and_cash_out_survive_a_restart(pool):
    ledger = restart(pool)
    ledger.ensure_account(ACC, "en")
    ledger.place_bet(ACC, "r_1", 1000, None)
    bet, applied = ledger.cash_out(ACC, "r_1", 250)
    assert applied and bet.payout == 2500
    assert balance_in_db(pool, ACC) == START - 1000 + 2500

    again = restart(pool)
    assert again.ensure_account(ACC, "en").balance == START + 1500


def test_cash_out_pays_once(pool):
    ledger = restart(pool)
    ledger.ensure_account(ACC, "en")
    ledger.place_bet(ACC, "r_1", 1000, None)
    ledger.cash_out(ACC, "r_1", 200)
    bet, applied = ledger.cash_out(ACC, "r_1", 300)
    assert not applied and bet.multiplier == 200
    assert balance_in_db(pool, ACC) == START + 1000


def test_insufficient_balance_changes_nothing(pool):
    ledger = restart(pool)
    ledger.ensure_account(ACC, "en")
    with pytest.raises(GameError) as err:
        ledger.place_bet(ACC, "r_1", START + 1, None)
    assert err.value.code == "INSUFFICIENT_BALANCE"
    assert balance_in_db(pool, ACC) == START
    assert ledger.get_bet(ACC, "r_1") is None


def test_already_bet_rolls_back_the_debit(pool):
    first, second = restart(pool), restart(pool)  # two processes, as during a deploy
    first.ensure_account(ACC, "en")
    second.ensure_account(ACC, "en")
    first.place_bet(ACC, "r_1", 1000, None)
    with pytest.raises(GameError) as err:
        second.place_bet(ACC, "r_1", 1000, None)
    assert err.value.code == "ALREADY_BET"
    assert balance_in_db(pool, ACC) == START - 1000


def test_lost_bets_and_unique_bet_ids(pool):
    ledger = restart(pool)
    for acc in (ACC, OTHER):
        ledger.ensure_account(acc, "en")
        ledger.place_bet(acc, "r_1", 500, None)
    lost = ledger.mark_lost("r_1")
    assert {b.account_id for b in lost} == {ACC, OTHER}
    ids = {b.bet_id for b in lost}

    again = restart(pool)
    again.ensure_account(ACC, "en")
    assert again.place_bet(ACC, "r_2", 500, None).bet_id not in ids


def test_unfinished_bets_are_refunded_on_start(pool):
    ledger = restart(pool)
    ledger.ensure_account(ACC, "en")
    ledger.place_bet(ACC, "r_1", 1000, None)  # the server stops mid-round

    again = restart(pool)
    assert again.ensure_account(ACC, "en").balance == START
    with pool.connection() as conn:
        status, payout = conn.execute("select status, payout from bets").fetchone()
    assert (status, payout) == ("cashed-out", 1000)


def test_cash_out_settled_by_another_process_is_not_paid_twice(pool):
    old = restart(pool)
    old.ensure_account(ACC, "en")
    old.place_bet(ACC, "r_1", 1000, None)
    restart(pool)  # a new process starts and refunds the riding bet
    bet, applied = old.cash_out(ACC, "r_1", 500)
    assert not applied and bet.multiplier == 100
    assert balance_in_db(pool, ACC) == START


def test_refill_and_name_persist(pool):
    ledger = restart(pool)
    ledger.ensure_account(ACC, "en")
    ledger.set_name(ACC, "Rocket Sam")
    ledger.refill(ACC, 5000)
    acc = restart(pool).ensure_account(ACC, "en")
    assert (acc.name, acc.balance) == ("Rocket Sam", 5000)


def test_idempotency_keys_survive_a_restart(pool):
    store = postgres.PostgresIdempotencyStore(pool)
    response = StoredResponse("POST /api/v1/bets {}", 200, {"betId": "b_1"})
    store.put(ACC, "k1", response)
    assert postgres.PostgresIdempotencyStore(pool).get(ACC, "k1") == response


def test_rounds_are_numbered_and_kept_across_restarts(pool, config, clock):
    from app.engine import RoundEngine
    from app.fairness import Sha256Fairness
    from app.rng import ProvablyFairCrashPointProvider

    rtp, cap = config.targetRtp, config.max_multiplier_hundredths

    def engine():
        return RoundEngine(config, restart(pool), ProvablyFairCrashPointProvider(rtp, cap),
                           Sha256Fairness(rtp, cap), clock, rounds=postgres.PostgresRoundStore(pool))

    first = engine()
    first.ledger.ensure_account(ACC, "en")
    first.open_betting()
    first.place_bet(ACC, first.round.round_id, 1000, None)
    first.launch()
    clock.advance(first.round.crash_at - clock.now_ms())
    assert first.tick()
    first.settle()
    finished, crash = first.round.round_id, first.round.crash

    second = engine()
    assert second.round.round_id != finished
    history = second.history(ACC, 10)
    assert history[0]["roundId"] == finished and history[0]["myResult"]["status"] == "lost"
    check = second.verify(finished)
    assert check.valid and check.crash == crash

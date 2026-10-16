"""Leaderboard: ordering, ties, new joiners, when updates are sent, and that phones cannot change it."""

import pytest
from fastapi.testclient import TestClient

from app.clock import ManualClock
from app.fairness import PlaceholderFairness
from app.leaderboard import Standing, rank
from app.rng import FixedSequenceCrashPointProvider
from app.rooms import RoomRegistry
from app.settings import Settings
from app.storage import InMemoryStorage

from .conftest import make_config
from .rooms_helpers import act, bet, hello, host_room, join_ok, recv, room_app, room_of, socket


def test_rank_orders_by_balance_and_ties_share_a_rank():
    entries = rank([
        Standing("p_a", "Ana", 100000, 1),
        Standing("p_b", "Ben", 150000, 2),
        Standing("p_c", "Cat", 100000, 3),
        Standing("p_d", "Dev", 50000, 4),
        Standing("p_e", "Eli", 150000, 5),
    ])
    assert [(e["rank"], e["name"], e["balance"]) for e in entries] == [
        (1, "Ben", "1500.00"), (1, "Eli", "1500.00"), (3, "Ana", "1000.00"), (3, "Cat", "1000.00"),
        (5, "Dev", "500.00"),
    ]
    assert rank([]) == []


class Recorder:
    """Wraps a room's broadcaster to count what it sends."""

    def __init__(self, room):
        self.sent = []
        original = room.broadcaster.publish

        def publish(event, account_id=None):
            self.sent.append(event)
            original(event, account_id)
        room.broadcaster.publish = publish

    def boards(self):
        return [e["data"] for e in self.sent if e["type"] == "leaderboard.updated"]


@pytest.fixture
def room_and_clock():
    clock = ManualClock()
    registry = RoomRegistry(
        config=make_config(growthRate=0.12), settings=Settings(storage_backend="memory"), storage=InMemoryStorage(), clock=clock,
        provider_factory=lambda: FixedSequenceCrashPointProvider((247,)), fairness=PlaceholderFairness(),
        autorun=False)
    room, _ = registry.create_room()
    return room, clock


def play_round(room, clock, bets, cash_outs_at_ms):
    """bets: {player_id: wager_units}; cash_outs_at_ms: {player_id: ms after launch}."""
    e = room.engine
    if e.state == "settled":
        e.prepare_round()
    e.open_betting()
    for pid, wager in bets.items():
        e.place_bet(pid, e.round.round_id, wager, None)
    e.launch()
    start = clock.now_ms()
    for pid, at in sorted(cash_outs_at_ms.items(), key=lambda kv: kv[1]):
        clock.advance(start + at - clock.now_ms())
        e.cash_out(pid, e.round.round_id)
    clock.advance(20_000)
    e.tick()  # crash
    e.settle()


def test_new_players_appear_at_the_bottom_with_the_starting_balance(room_and_clock):
    room, clock = room_and_clock
    rec = Recorder(room)
    ana, _ = room.join("Ana")
    ben, _ = room.join("Ben")
    assert [b["entries"][-1]["name"] for b in rec.boards()] == ["Ana", "Ben"]  # sent on each join
    play_round(room, clock, {ana.player_id: 10000, ben.player_id: 10000}, {ana.player_id: 5000})
    # Ana: 1000 - 100 + 182 = 1082; Ben lost 100 -> 900
    cat, _ = room.join("Cat")
    board = rec.boards()[-1]
    assert [(e["rank"], e["name"], e["balance"]) for e in board["entries"]] == [
        (1, "Ana", "1082.00"), (2, "Cat", "1000.00"), (3, "Ben", "900.00")]
    dev, _ = room.join("Dev")  # ties with Cat, listed after Cat
    assert [(e["rank"], e["name"]) for e in rec.boards()[-1]["entries"]] == [
        (1, "Ana"), (2, "Cat"), (2, "Dev"), (4, "Ben")]
    assert board["basis"] == "balance" and board["label"] == "Balance (play credits)" and board["playMoney"]


def test_updates_are_sent_after_payouts_and_only_when_something_changed(room_and_clock):
    room, clock = room_and_clock
    ana, _ = room.join("Ana")
    ben, _ = room.join("Ben")
    rec = Recorder(room)
    play_round(room, clock, {}, {})  # nobody bet
    assert rec.boards() == []
    room.engine.prepare_round()
    room.engine.open_betting()
    room.engine.place_bet(ben.player_id, room.engine.round.round_id, 5000, None)
    assert rec.boards() == []  # a wager in flight does not move the board
    room.engine.launch()
    clock.advance(5000)
    room.engine.cash_out(ben.player_id, room.engine.round.round_id)
    assert rec.boards() == []  # nor does a cash out before the round settles
    clock.advance(20_000)
    room.engine.tick()
    room.engine.settle()
    boards = rec.boards()
    assert len(boards) == 1 and boards[0]["afterRoundId"] == room.engine.round.round_id
    assert [(e["name"], e["balance"]) for e in boards[0]["entries"]] == [("Ben", "1041.00"), ("Ana", "1000.00")]
    # The settle event goes out before the board.
    types = [e["type"] for e in rec.sent]
    assert types.index("round.settled") < types.index("leaderboard.updated")


def test_board_drops_players_whose_seat_is_released(room_and_clock):
    room, clock = room_and_clock
    room.join("Ana")
    room.join("Ben")
    rec = Recorder(room)
    clock.advance(room.settings.seat_hold_seconds * 1000 + 1)  # neither ever connected
    room.sweep()
    assert rec.boards()[-1]["entries"] == []


def test_phones_get_the_board_and_cannot_change_it():
    app, _, _ = room_app()
    with TestClient(app) as client:
        room_info = host_room(client)
        code = room_info["roomCode"]
        ana = join_ok(client, code, "Ana")
        with socket(client, code) as host, socket(client, code) as phone:
            welcome = hello(phone, "player", ana["sessionToken"])
            assert welcome["leaderboard"]["entries"] == [
                {"rank": 1, "playerId": ana["playerId"], "name": "Ana", "balance": "1000.00"}]
            hello(host, "host", room_info["hostToken"])
            for fake in ({"type": "leaderboard.updated", "data": {"entries": []}},
                         {"type": "set_rank", "rank": 1}, {"type": "set_balance", "balance": "999999.00"}):
                reply = act(phone, fake["type"], **{k: v for k, v in fake.items() if k != "type"})
                assert reply["status"] == 422 and reply["body"]["error"]["code"] == "INVALID_REQUEST"
            ben = join_ok(client, code, "Ben")
            board = recv(phone, "leaderboard.updated")["data"]
            assert [e["playerId"] for e in board["entries"]] == [ana["playerId"], ben["playerId"]]
            assert recv(host, "leaderboard.updated")["data"] == board  # everyone gets the same board
        room = room_of(client, code)
        assert room.ledger.get_account(ana["playerId"]).balance == 100000

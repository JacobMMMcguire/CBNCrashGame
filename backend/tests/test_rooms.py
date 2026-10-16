"""Multiplayer rooms: hosting, joining, names, host controls, payouts, the event log, reconnecting."""

import re
import uuid

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.rng import FixedSequenceCrashPointProvider
from app.rooms import CODE_ALPHABET, hash_token

from .conftest import make_config
from .rooms_helpers import (
    SEAT_HOLD_SECONDS, act, bet, cash_out, hello, host_room, join, join_ok, recv, room_app, room_of, socket,
)


@pytest.fixture
def env():
    app, clock, storage = room_app()
    with TestClient(app) as client:
        yield client, clock, storage


def refused_code(client, code, role, token) -> int:
    with pytest.raises(WebSocketDisconnect) as info:
        with socket(client, code) as ws:
            ws.send_json({"type": "hello", "role": role, "token": token})
            ws.receive_json()
    return info.value.code


# ---------- Hosting and joining ----------

def test_host_creates_room_with_code_and_secret_token(env):
    client, _, storage = env
    room = host_room(client)
    assert re.fullmatch(f"[{CODE_ALPHABET}]{{4}}", room["roomCode"])
    assert len(room["hostToken"]) >= 40
    assert room["publicBaseUrl"] == "http://testserver" and room["playMoney"] is True
    # Only the hash is stored.
    assert storage.get_room(room["roomCode"]).host_token_hash == hash_token(room["hostToken"])
    info = client.get(f"/api/v1/rooms/{room['roomCode'].lower()}").json()
    assert info == {"roomCode": room["roomCode"], "locked": False, "started": False, "playerCount": 0,
                    "maxPlayers": 50, "startingBalance": "1000.00", "playMoney": True}
    missing = client.get("/api/v1/rooms/ZZZZ")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "ROOM_NOT_FOUND"


def test_join_issues_server_tokens_and_starting_balance(env):
    client, _, storage = env
    code = host_room(client)["roomCode"]
    a, b = join_ok(client, code, "Ana"), join_ok(client, code, "Ben")
    assert a["playerId"] != b["playerId"] and a["sessionToken"] != b["sessionToken"]
    assert re.fullmatch(r"p_[0-9a-f]{16}", a["playerId"])
    assert len(a["sessionToken"]) >= 40
    assert a["balance"] == "1000.00" and a["playMoney"] is True
    stored = storage.find_player_by_session(hash_token(a["sessionToken"]))
    assert stored.player_id == a["playerId"] and stored.balance_units == 100000
    assert a["sessionToken"] not in repr(storage.list_players(code))


def test_host_sees_players_appear_in_lobby(env):
    client, _, _ = env
    room = host_room(client)
    code = room["roomCode"]
    with socket(client, code) as host:
        welcome = hello(host, "host", room["hostToken"])
        assert welcome["role"] == "host" and welcome["you"] is None and welcome["lobby"]["players"] == []
        ana = join_ok(client, code, "Ana")
        lobby = recv(host, "lobby.updated")["data"]
        assert lobby["players"] == [{"playerId": ana["playerId"], "name": "Ana", "connected": False}]
        with socket(client, code) as phone:
            hello(phone, "player", ana["sessionToken"])
            lobby = recv(host, "lobby.updated")["data"]
            assert lobby["players"][0]["connected"] is True


def test_duplicate_names_are_rejected_per_room(env):
    client, _, _ = env
    code, other = host_room(client)["roomCode"], host_room(client)["roomCode"]
    join_ok(client, code, "Ana Lee")
    for clash in ("Ana Lee", "ana lee", "  ANA   LEE "):
        r = join(client, code, clash)
        assert r.status_code == 409 and r.json()["error"]["code"] == "NAME_TAKEN", clash
    assert join(client, other, "Ana Lee").status_code == 201  # another room is fine
    for bad in ("", "   ", "x" * 17, "bad\u0000name"):
        r = join(client, code, bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_REQUEST", bad


def test_tokens_made_up_by_the_client_are_refused(env):
    client, _, _ = env
    room = host_room(client)
    code = room["roomCode"]
    ana = join_ok(client, code, "Ana")
    assert refused_code(client, code, "player", "client-made-token-0123456789") == 4401
    assert refused_code(client, code, "host", ana["sessionToken"]) == 4401  # a player cannot claim host
    assert refused_code(client, code, "player", room["hostToken"]) == 4401
    assert refused_code(client, "ZZZZ", "player", ana["sessionToken"]) == 4404
    other = host_room(client)["roomCode"]
    assert refused_code(client, other, "player", ana["sessionToken"]) == 4401  # token is for one room


# ---------- Host controls ----------

def test_players_cannot_use_host_controls(env):
    client, _, _ = env
    code = host_room(client)["roomCode"]
    ana, ben = join_ok(client, code, "Ana"), join_ok(client, code, "Ben")
    with socket(client, code) as phone:
        hello(phone, "player", ana["sessionToken"])
        for action, fields in (("start", {}), ("lock", {"locked": True}), ("kick", {"playerId": ben["playerId"]})):
            reply = act(phone, action, **fields)
            assert reply["status"] == 403 and reply["body"]["error"]["code"] == "FORBIDDEN"
    room = room_of(client, code)
    assert not room.started and not room.locked and room.seats[ben["playerId"]].status == "active"


def test_host_start_lock_and_kick(env):
    client, _, storage = env
    room = host_room(client)
    code = room["roomCode"]
    ana = join_ok(client, code, "Ana")
    with socket(client, code) as host, socket(client, code) as phone:
        hello(host, "host", room["hostToken"])
        hello(phone, "player", ana["sessionToken"])
        assert act(host, "start")["status"] == 200
        assert room_of(client, code).started
        assert act(host, "lock", locked=True)["status"] == 200
        r = join(client, code, "Late")
        assert r.status_code == 409 and r.json()["error"]["code"] == "ROOM_LOCKED"
        assert act(host, "kick", playerId=ana["playerId"])["status"] == 200
        with pytest.raises(WebSocketDisconnect) as info:
            recv(phone, "never")
        assert info.value.code == 4403
        # (act() already read past the lobby.updated that the kick broadcast.)
        lobby = room_of(client, code).lobby_data()
        assert lobby["players"] == [] and lobby["locked"] is True
    assert storage.find_player_by_session(hash_token(ana["sessionToken"])).status == "kicked"
    assert refused_code(client, code, "player", ana["sessionToken"]) == 4401


# ---------- Rounds, payouts and the event log ----------

def test_shared_round_id_payout_and_event_log(env):
    client, clock, storage = env
    code = host_room(client)["roomCode"]
    ana, ben = join_ok(client, code, "Ana"), join_ok(client, code, "Ben")
    room = room_of(client, code)
    with socket(client, code) as wa, socket(client, code) as wb:
        hello(wa, "player", ana["sessionToken"])
        hello(wb, "player", ben["sessionToken"])
        client.portal.call(room.engine.open_betting)
        rid = recv(wa, "round.betting")["roundId"]
        assert rid == f"{code}-r_1" and recv(wb, "round.betting")["roundId"] == rid  # one shared round
        ra, rb = bet(wa, rid, "10.00"), bet(wb, rid, "25.50")
        assert ra["status"] == 201 and rb["status"] == 201
        assert ra["body"]["roundId"] == rb["body"]["roundId"] == rid
        assert ra["body"]["balance"] == "990.00" and rb["body"]["balance"] == "974.50"
        launched_at = clock.now_ms()
        client.portal.call(room.engine.launch)
        clock.advance(5000)  # m = floor(e^(0.12*5) * 100) = 182
        out = cash_out(wa, rid)
        assert out["status"] == 200
        assert out["body"]["multiplier"] == 1.82 and out["body"]["payout"] == "18.20"
        assert out["body"]["profit"] == "8.20" and out["body"]["balance"] == "1008.20"
        clock.advance(5000)  # past the 2.47 crash
        client.portal.call(room.engine.tick)
        late = cash_out(wb, rid)
        assert late["status"] == 409 and late["body"]["error"]["code"] == "TOO_LATE"
    events = storage.list_events(code)
    assert [(e.kind, e.player_id) for e in events] == [
        ("bet", ana["playerId"]), ("bet", ben["playerId"]), ("cashout", ana["playerId"]), ("lost", ben["playerId"])]
    assert all(e.room_id == code and e.round_id == rid for e in events)
    bet_a, bet_b, cash_a, lost_b = events
    assert (bet_a.amount_units, bet_a.balance_after_units) == (1000, 99000)
    assert (bet_b.amount_units, bet_b.wager_units) == (2550, 2550)
    assert (cash_a.amount_units, cash_a.multiplier_hundredths, cash_a.auto) == (1820, 182, False)
    assert cash_a.timestamp_ms == launched_at + 5000 and cash_a.balance_after_units == 100820
    assert (lost_b.amount_units, lost_b.multiplier_hundredths, lost_b.balance_after_units) == (0, None, 97450)
    assert storage.list_players(code)[0].balance_units == 100820  # mirrored balance


def test_auto_cash_out_is_paid_and_logged(env):
    client, clock, storage = env
    code = host_room(client)["roomCode"]
    ana = join_ok(client, code, "Ana")
    room = room_of(client, code)
    with socket(client, code) as ws:
        hello(ws, "player", ana["sessionToken"])
        client.portal.call(room.engine.open_betting)
        rid = recv(ws, "round.betting")["roundId"]
        assert bet(ws, rid, "10.00", autoCashOut=2.0)["status"] == 201
        client.portal.call(room.engine.launch)
        clock.advance(10_000)
        client.portal.call(room.engine.tick)  # crashes at 2.47; the 2.00 target was reached first
        cashout = recv(ws, "round.cashout")["data"]
        assert cashout == {"betId": cashout["betId"], "multiplier": 2.0, "payout": "20.00", "auto": True}
    cash = storage.list_events(code)[-1]
    assert (cash.kind, cash.amount_units, cash.multiplier_hundredths, cash.auto) == ("cashout", 2000, 200, True)
    assert cash.balance_after_units == 101000


def test_websocket_bet_uses_idempotency_keys(env):
    client, _, storage = env
    code = host_room(client)["roomCode"]
    ana = join_ok(client, code, "Ana")
    room = room_of(client, code)
    with socket(client, code) as ws:
        hello(ws, "player", ana["sessionToken"])
        client.portal.call(room.engine.open_betting)
        rid = recv(ws, "round.betting")["roundId"]
        key = str(uuid.uuid4())
        first, again = bet(ws, rid, "10.00", key=key), bet(ws, rid, "10.00", key=key)
        assert first["replayed"] is False and again["replayed"] is True and again["body"] == first["body"]
        other = bet(ws, rid, "20.00", key=key)
        assert other["status"] == 409 and other["body"]["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
        missing = act(ws, "place_bet", roundId=rid, wager="10.00")
        assert missing["status"] == 422 and missing["body"]["error"]["code"] == "INVALID_REQUEST"
    assert room.ledger.get_account(ana["playerId"]).balance == 99000  # debited once
    assert [e.kind for e in storage.list_events(code)] == ["bet"]


def test_bet_ids_continue_after_stored_ids():
    app, _, storage = room_app()
    from app.storage import LedgerEvent
    storage.append_event(LedgerEvent("OLD1", "OLD1-r_1", "p_x", "b_41", "bet", 0, 100, 100, None, False, 0))
    app2 = create_app(make_config(), autostart=False, storage=storage,
                      settings=app.state.services.settings,
                      room_provider_factory=lambda: FixedSequenceCrashPointProvider((247,)))
    with TestClient(app2) as client:
        code = host_room(client)["roomCode"]
        ana = join_ok(client, code, "Ana")
        room = room_of(client, code)
        with socket(client, code) as ws:
            hello(ws, "player", ana["sessionToken"])
            client.portal.call(room.engine.open_betting)
            rid = recv(ws, "round.betting")["roundId"]
            assert bet(ws, rid)["body"]["betId"] == "b_42"


# ---------- Reconnecting ----------

def test_reconnect_with_session_token_keeps_player_and_balance(env):
    client, clock, _ = env
    room_info = host_room(client)
    code = room_info["roomCode"]
    ana = join_ok(client, code, "Ana")
    room = room_of(client, code)
    with socket(client, code) as host:
        hello(host, "host", room_info["hostToken"])
        with socket(client, code) as ws:
            hello(ws, "player", ana["sessionToken"])
            client.portal.call(room.engine.open_betting)
            rid = recv(ws, "round.betting")["roundId"]
            assert bet(ws, rid, "10.00")["status"] == 201
        # The phone dropped: the seat is held, shown as not connected.
        lobby = recv(host, "lobby.updated")["data"]
        while lobby["players"][0]["connected"]:
            lobby = recv(host, "lobby.updated")["data"]
        clock.advance((SEAT_HOLD_SECONDS - 1) * 1000)
        client.portal.call(room.sweep)
        with socket(client, code) as ws:
            welcome = hello(ws, "player", ana["sessionToken"])
            assert welcome["you"] == {"playerId": ana["playerId"], "name": "Ana", "balance": "990.00"}
            assert welcome["round"]["roundId"] == rid and welcome["round"]["myBet"]["status"] == "active"
            assert welcome["room"]["playMoney"] is True


def test_seat_is_released_after_the_hold(env):
    client, clock, storage = env
    code = host_room(client)["roomCode"]
    ana = join_ok(client, code, "Ana")
    room = room_of(client, code)
    with socket(client, code) as ws:
        hello(ws, "player", ana["sessionToken"])
    clock.advance(SEAT_HOLD_SECONDS * 1000 + 1)
    client.portal.call(room.sweep)
    assert storage.find_player_by_session(hash_token(ana["sessionToken"])).status == "expired"
    assert refused_code(client, code, "player", ana["sessionToken"]) == 4401
    assert join(client, code, "Ana").status_code == 201  # the name is free again


def test_seat_expiry_is_checked_on_reconnect_without_a_sweep(env):
    client, clock, _ = env
    code = host_room(client)["roomCode"]
    ana = join_ok(client, code, "Ana")  # joined but never connected
    clock.advance(SEAT_HOLD_SECONDS * 1000 + 1)
    assert refused_code(client, code, "player", ana["sessionToken"]) == 4401


# ---------- Real round loop ----------

def test_room_round_loop_runs_after_host_start():
    config = make_config(bettingWindowMs=200, tickIntervalMs=20, settleDelayMs=50, growthRate=2.0)
    app = create_app(config, storage=None, settings=None,
                     room_provider_factory=lambda: FixedSequenceCrashPointProvider((150,)))
    with TestClient(app) as client:
        room_info = host_room(client)
        code = room_info["roomCode"]
        ana = join_ok(client, code, "Ana")
        with socket(client, code) as host, socket(client, code) as ws:
            hello(host, "host", room_info["hostToken"])
            hello(ws, "player", ana["sessionToken"])
            assert act(host, "start")["status"] == 200
            rid = recv(ws, "round.betting")["roundId"]
            assert rid.startswith(f"{code}-r_")
            assert bet(ws, rid)["status"] == 201
            crashed = recv(host, "round.crashed")
            assert crashed["roundId"] == rid and crashed["data"]["crash"] == 1.5
            recv(host, "round.settled")


# ---------- Keep-alive ----------

def test_rooms_ping_every_socket_so_silent_drops_can_be_detected(env):
    client, clock, _ = env
    room_info = host_room(client)
    code = room_info["roomCode"]
    ana = join_ok(client, code, "Ana")
    registry = client.app.state.services.rooms
    with socket(client, code) as host, socket(client, code) as phone:
        hello(host, "host", room_info["hostToken"])
        hello(phone, "player", ana["sessionToken"])
        now = clock.now_ms()
        client.portal.call(registry.ping)
        for ws in (host, phone):
            msg = recv(ws, "ping")
            assert msg["data"]["serverTime"] and isinstance(msg["seq"], int)
    assert clock.now_ms() == now


def test_housekeeping_loop_pings_every_ten_seconds():
    import asyncio

    from app.clock import ManualClock
    from app.fairness import PlaceholderFairness
    from app.rooms import PING_EVERY_MS, RoomRegistry
    from app.settings import Settings
    from app.storage import InMemoryStorage

    clock = ManualClock()
    registry = RoomRegistry(config=make_config(), settings=Settings(storage_backend="memory"),
                            storage=InMemoryStorage(), clock=clock,
                            provider_factory=lambda: FixedSequenceCrashPointProvider((247,)),
                            fairness=PlaceholderFairness(), autorun=False)
    pings = []
    registry.ping = lambda: pings.append(clock.now_ms())

    async def run_for(ms):
        task = asyncio.create_task(registry.run_sweeper())
        start = clock.now_ms()
        while clock.now_ms() - start < ms:
            await asyncio.sleep(0)
        task.cancel()

    asyncio.run(run_for(35_000))
    assert PING_EVERY_MS == 10_000
    assert [b - a for a, b in zip(pings, pings[1:])] == [10_000] * (len(pings) - 1) and len(pings) >= 3

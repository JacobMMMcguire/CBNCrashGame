"""Storage implementations and the .env / settings loader."""

import pytest

from app.settings import SettingsError, Settings, load_settings, parse_dotenv
from app.storage import InMemoryStorage, LedgerEvent, PlayerRecord, RoomRecord, SQLiteStorage, create_storage


@pytest.fixture(params=["memory", "sqlite"])
def storage(request, tmp_path):
    s = InMemoryStorage() if request.param == "memory" else SQLiteStorage(tmp_path / "t.sqlite3")
    yield s
    s.close()


def test_storage_round_trip(storage):
    storage.create_room(RoomRecord("K7QX", "h" * 64, 1))
    storage.add_player(PlayerRecord("p_1", "K7QX", "Ana", "s" * 64, 2, 100000))
    storage.add_player(PlayerRecord("p_2", "K7QX", "Ben", "t" * 64, 3, 100000))
    storage.update_room("K7QX", locked=True)
    storage.update_player("p_1", balance_units=99000)
    storage.update_player("p_2", status="kicked")
    assert storage.get_room("K7QX").locked is True and storage.get_room("NOPE") is None
    assert storage.find_player_by_session("s" * 64).balance_units == 99000
    assert [p.status for p in storage.list_players("K7QX")] == ["active", "kicked"]
    e = storage.append_event(LedgerEvent("K7QX", "K7QX-r_1", "p_1", "b_9", "cashout", 5, 1000, 1820, 182, True, 100820))
    assert e.event_id == 1
    assert storage.list_events("K7QX") == [e] and storage.list_events("OTHER") == []
    assert storage.max_bet_number() == 9
    assert storage.close_open_rooms() == 1 and storage.get_room("K7QX").status == "closed"


def test_sqlite_survives_reopen(tmp_path):
    path = tmp_path / "db.sqlite3"
    s = SQLiteStorage(path)
    s.create_room(RoomRecord("K7QX", "h" * 64, 1))
    s.append_event(LedgerEvent("K7QX", "K7QX-r_1", "p_1", "b_3", "bet", 5, 1000, 1000, None, False, 99000))
    s.close()
    s = SQLiteStorage(path)
    assert s.get_room("K7QX") is not None and s.max_bet_number() == 3
    s.close()


def test_supabase_backend_is_a_clear_stub():
    with pytest.raises(NotImplementedError, match="not implemented yet"):
        create_storage(Settings(storage_backend="supabase"))


def test_parse_dotenv():
    text = """
# comment
PUBLIC_BASE_URL=http://192.168.1.23:8001
export ASCENT_HOST = 0.0.0.0
QUOTED="a # not a comment"
SINGLE='x'
TRAILING=value # comment
EMPTY=
not a line
"""
    assert parse_dotenv(text) == {
        "PUBLIC_BASE_URL": "http://192.168.1.23:8001", "ASCENT_HOST": "0.0.0.0",
        "QUOTED": "a # not a comment", "SINGLE": "x", "TRAILING": "value", "EMPTY": "",
    }


def test_dotenv_does_not_override_the_environment(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("PUBLIC_BASE_URL=http://10.0.0.5:8001/\nSEAT_HOLD_SECONDS=30\n", encoding="utf-8")
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    monkeypatch.setenv("SEAT_HOLD_SECONDS", "90")
    s = load_settings(env)
    assert s.public_base_url == "http://10.0.0.5:8001" and s.seat_hold_seconds == 90
    assert not s.public_base_url_is_local
    assert Settings().public_base_url_is_local  # the localhost default


def test_bad_settings_are_reported(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "192.168.1.23:8001")
    with pytest.raises(SettingsError, match="PUBLIC_BASE_URL"):
        load_settings(None)
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://x")
    monkeypatch.setenv("STORAGE_BACKEND", "mongo")
    with pytest.raises(SettingsError, match="STORAGE_BACKEND"):
        load_settings(None)

"""QR join flow: pages, the vendored encoder, and PUBLIC_BASE_URL reaching the host screen."""

from fastapi.testclient import TestClient

from app.clock import ManualClock
from app.main import create_app
from app.settings import Settings
from app.storage import InMemoryStorage

from .conftest import make_config
from .rooms_helpers import hello, host_room, join_ok, recv, room_app, socket


def lan_app(base: str):
    return create_app(make_config(), clock=ManualClock(), autostart=False, storage=InMemoryStorage(),
                      settings=Settings(public_base_url=base, storage_backend="memory"))


def test_host_gets_public_base_url_for_the_join_link():
    with TestClient(lan_app("http://192.168.1.23:8001")) as client:
        room = host_room(client)
        assert room["publicBaseUrl"] == "http://192.168.1.23:8001"
        with socket(client, room["roomCode"]) as ws:
            welcome = hello(ws, "host", room["hostToken"])
            assert welcome["room"]["publicBaseUrl"] == "http://192.168.1.23:8001"
            assert welcome["room"]["roomCode"] == room["roomCode"]


def test_join_link_opens_the_phone_page():
    app, _, _ = room_app()
    with TestClient(app) as client:
        code = host_room(client)["roomCode"]
        page = client.get(f"/join/{code}")
        assert page.status_code == 200 and "text/html" in page.headers["content-type"]
        assert "/app/js/room/join.js" in page.text and 'data-i18n="room.playMoney"' in page.text
        lower = client.get(f"/join/{code.lower()}", follow_redirects=False)
        assert lower.status_code == 307 and lower.headers["location"] == f"/join/{code}"
        assert client.get("/join").status_code == 200  # type-the-code fallback


def test_host_page_loads_the_vendored_qr_encoder():
    app, _, _ = room_app()
    with TestClient(app) as client:
        host = client.get("/host").text
        assert '<script src="/app/vendor/qrcode-generator/qrcode.js"></script>' in host
        assert host.index("qrcode-generator/qrcode.js") < host.index("/app/js/room/host.js")
        lib = client.get("/app/vendor/qrcode-generator/qrcode.js")
        assert lib.status_code == 200 and "javascript" in lib.headers["content-type"]
        assert "Licensed under the MIT license" in lib.text
        assert "MIT License" in client.get("/app/vendor/qrcode-generator/LICENSE").text


def test_everyone_who_scans_the_same_code_is_in_the_same_room():
    app, _, _ = room_app()
    with TestClient(app) as client:
        room = host_room(client)
        code = room["roomCode"]
        with socket(client, code) as host:
            hello(host, "host", room["hostToken"])
            players = [join_ok(client, code, n) for n in ("Ana", "Ben", "Cat")]
            lobby = None
            for _ in players:
                lobby = recv(host, "lobby.updated")["data"]
            assert lobby["roomCode"] == code
            assert [p["name"] for p in lobby["players"]] == ["Ana", "Ben", "Cat"]
            assert all(p["roomCode"] == code for p in players)

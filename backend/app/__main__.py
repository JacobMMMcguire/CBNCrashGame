"""Start the server: ``python -m app`` (with backend/ on PYTHONPATH).

Loads ``.env`` (if present), validates config/game.json and the settings, and
prints a plain message instead of a traceback if either is invalid.

Run exactly one process: rooms, round loops and sockets live in memory, so two
workers would mean two different games.
"""

from __future__ import annotations

import argparse
import os
import socket
import sys

from .config import ConfigError, load_config
from .settings import SettingsError, load_dotenv, load_settings


def lan_ip() -> str | None:
    """Best guess at this machine's LAN address. Connecting a UDP socket sends no packets."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # TEST-NET-1: never routed, nothing is sent
            return s.getsockname()[0]
    except OSError:
        return None


def main() -> int:
    load_dotenv()  # before reading ASCENT_HOST / ASCENT_PORT
    parser = argparse.ArgumentParser(prog="python -m app", description="Run the Ascent skeleton server.")
    parser.add_argument("--host", default=os.environ.get("ASCENT_HOST") or "127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ASCENT_PORT") or 8001))
    parser.add_argument("--reload", action="store_true", help="restart when backend code changes")
    args = parser.parse_args()

    try:
        load_config()
        settings = load_settings()
    except (ConfigError, SettingsError) as err:
        print(f"Cannot start: {err}", file=sys.stderr)
        return 2

    import uvicorn

    print(f"Ascent skeleton: game at http://{args.host}:{args.port}/app/  (mock mode: /app/?mock=1)")
    print(f"Multiplayer: host screen at http://{args.host}:{args.port}/host  "
          f"(join links use PUBLIC_BASE_URL={settings.public_base_url}, storage={settings.storage_backend})")
    if args.host in ("127.0.0.1", "localhost"):
        print("  Phones cannot reach this server: set ASCENT_HOST=0.0.0.0 in .env to listen on the network.")
    if settings.public_base_url_is_local:
        ip = lan_ip()
        hint = f"http://{ip}:{args.port}" if ip else "http://<your LAN IP>:<port>"
        print(f"  PUBLIC_BASE_URL points at this machine only. For phones on the same Wi-Fi, set PUBLIC_BASE_URL={hint}")
    uvicorn.run("app.main:create_app", factory=True, host=args.host, port=args.port, reload=args.reload)
    return 0


if __name__ == "__main__":
    sys.exit(main())

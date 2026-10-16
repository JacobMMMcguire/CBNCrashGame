"""Deployment settings from the environment and an optional ``.env`` file.

These are about where the server runs and where it stores data, not about the
game rules (those live in config/game.json). No secrets are needed locally.

``load_dotenv`` is a small built-in parser so we do not need python-dotenv. It
understands ``KEY=VALUE`` lines, ``#`` comments, blank lines, an optional
``export`` prefix and single or double quotes. It never overrides a variable
that is already set in the process environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .config import REPO_ROOT

DEFAULT_ENV_PATH = REPO_ROOT / ".env"
DEFAULT_PUBLIC_BASE_URL = "http://localhost:8001"
DEFAULT_SQLITE_PATH = REPO_ROOT / "data" / "ascent.sqlite3"
STORAGE_BACKENDS = ("sqlite", "memory", "supabase")


class SettingsError(Exception):
    """A setting is invalid. The message is meant for humans."""


def parse_dotenv(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not key.replace("_", "").isalnum():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[key] = value
    return values


def load_dotenv(path: Path | str = DEFAULT_ENV_PATH) -> dict[str, str]:
    """Copy values from ``path`` into ``os.environ`` unless already set. Missing file is fine."""
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {}
    values = parse_dotenv(text)
    for key, value in values.items():
        os.environ.setdefault(key, value)
    return values


@dataclass(frozen=True)
class Settings:
    # The address phones use to reach this server. The join link and QR code are
    # built from it, so on a LAN it must be the laptop's LAN IP, not localhost.
    public_base_url: str = DEFAULT_PUBLIC_BASE_URL
    storage_backend: str = "sqlite"
    sqlite_path: Path = DEFAULT_SQLITE_PATH
    supabase_url: str = ""
    supabase_key: str = ""
    # How long a dropped player's seat (name and balance) is held for them.
    seat_hold_seconds: int = 120
    max_players_per_room: int = 50

    @property
    def public_base_url_is_local(self) -> bool:
        host = self.public_base_url.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
        return host in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]")


def _int(name: str, default: int, low: int, high: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise SettingsError(f"{name} must be a whole number, got '{raw}'") from None
    if not low <= value <= high:
        raise SettingsError(f"{name} must be between {low} and {high}, got {value}")
    return value


def load_settings(env_path: Path | str | None = DEFAULT_ENV_PATH) -> Settings:
    """Read settings from the environment, after loading ``.env`` (pass ``None`` to skip it)."""
    if env_path is not None:
        load_dotenv(env_path)
    env = os.environ
    base = (env.get("PUBLIC_BASE_URL") or DEFAULT_PUBLIC_BASE_URL).strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise SettingsError(f"PUBLIC_BASE_URL must start with http:// or https://, got '{base}'")
    backend = (env.get("STORAGE_BACKEND") or "sqlite").strip().lower()
    if backend not in STORAGE_BACKENDS:
        raise SettingsError(f"STORAGE_BACKEND must be one of {', '.join(STORAGE_BACKENDS)}, got '{backend}'")
    sqlite_path = Path(env.get("SQLITE_PATH") or DEFAULT_SQLITE_PATH)
    if not sqlite_path.is_absolute():
        sqlite_path = REPO_ROOT / sqlite_path
    return Settings(
        public_base_url=base,
        storage_backend=backend,
        sqlite_path=sqlite_path,
        supabase_url=env.get("SUPABASE_URL", "").strip(),
        supabase_key=env.get("SUPABASE_KEY", "").strip(),
        seat_hold_seconds=_int("SEAT_HOLD_SECONDS", 120, 5, 86_400),
        max_players_per_room=_int("MAX_PLAYERS_PER_ROOM", 50, 1, 500),
    )

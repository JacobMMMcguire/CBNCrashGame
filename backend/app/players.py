"""Multiplayer presence: public player ids, pilot names and the roster of a launch.

Account ids stay private. Other players see a ``playerId`` (a hash of the
account id) and a pilot name: one the player chose, or a callsign derived from
the account so it is stable across reloads, such as "Comet-27".
"""

from __future__ import annotations

import hashlib
import re

from .errors import GameError
from .ledger import Account, Bet
from .money import format_credits, multiplier_to_float

_WORDS = (
    "Comet", "Nova", "Orbit", "Vega", "Lyra", "Atlas", "Pulsar", "Quasar", "Zenith", "Apollo", "Gemini", "Orion",
    "Sirius", "Rigel", "Halley", "Kepler", "Luna", "Titan", "Io", "Europa", "Ceres", "Draco", "Phoenix", "Polaris",
)
_NAME_RE = re.compile(r"^[\w .'-]{2,16}$")


def player_id(account_id: str) -> str:
    return "p_" + hashlib.sha256(f"player:{account_id}".encode()).hexdigest()[:10]


def callsign(account_id: str) -> str:
    h = int(hashlib.sha256(f"callsign:{account_id}".encode()).hexdigest(), 16)
    return f"{_WORDS[h % len(_WORDS)]}-{(h // len(_WORDS)) % 90 + 10}"


def display_name(account: Account) -> str:
    return account.name or callsign(account.account_id)


def clean_name(raw: str) -> str:
    """Trim and collapse spaces; 2-16 letters, digits, spaces, . ' - or _."""
    name = " ".join(str(raw).split())
    if not _NAME_RE.match(name):
        raise GameError("INVALID_REQUEST", "A pilot name is 2 to 16 letters, digits, spaces, dots, dashes or underscores.")
    return name


def roster_entry(bet: Bet, account: Account) -> dict:
    """What every player may see about one bet. The auto-eject target stays private."""
    entry = {"playerId": player_id(bet.account_id), "name": display_name(account),
             "wager": format_credits(bet.wager), "status": bet.status}
    if bet.status == "cashed-out":
        entry["multiplier"] = multiplier_to_float(bet.multiplier)
        entry["payout"] = format_credits(bet.payout)
    return entry

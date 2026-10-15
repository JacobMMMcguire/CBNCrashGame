"""Play-account identity (contract §6: "TBD. Assume a bearer token").

SKELETON ONLY: any well-formed guest token is accepted and maps to a play
account. There is no sign-up, password or personal data, and none is planned.
The browser makes up its own token and keeps it in localStorage.

TODO(backend owner): decide guest token vs simple sign-in (HANDOFF open item 6)
and issue tokens from the server instead of trusting client-made ones.
"""

from __future__ import annotations

import hashlib
import re

from .errors import GameError

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


def account_id_for_token(token: str | None) -> str:
    if not token or not _TOKEN_RE.match(token):
        raise GameError("UNAUTHORIZED", "Missing or invalid token.")
    # Derive the id so the token itself never appears in responses.
    return "acc_" + hashlib.sha256(token.encode()).hexdigest()[:12]


def account_id_from_header(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise GameError("UNAUTHORIZED", "Missing or invalid token.")
    return account_id_for_token(authorization.removeprefix("Bearer ").strip())

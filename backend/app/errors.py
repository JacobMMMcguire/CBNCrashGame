"""Structured game errors (contract §8.7).

Every error response has the shape ``{"error": {"code": ..., "message": ...}}``.
``message`` is English for logs; the UI translates ``code``.
"""

from __future__ import annotations

# code -> HTTP status. The first eight come from contract §8.7. The next four
# are SKELETON additions listed under "Contract changes proposed" in
# docs/SKELETON.md. The room codes are described in docs/HOW_IT_WORKS.md.
ERROR_STATUS: dict[str, int] = {
    "BET_WINDOW_CLOSED": 409,
    "BET_OUT_OF_RANGE": 422,
    "INSUFFICIENT_BALANCE": 422,
    "ALREADY_BET": 409,
    "NO_ACTIVE_BET": 409,
    "TOO_LATE": 409,
    "IDEMPOTENCY_KEY_REUSED": 409,
    "UNAUTHORIZED": 401,
    # Proposed additions:
    "INVALID_REQUEST": 422,
    "ROUND_NOT_IN_FLIGHT": 409,
    "ROUND_NOT_FOUND": 404,
    "ROUND_NOT_FINISHED": 409,
    # Multiplayer rooms:
    "ROOM_NOT_FOUND": 404,
    "ROOM_LOCKED": 409,
    "ROOM_FULL": 409,
    "NAME_TAKEN": 409,
    "FORBIDDEN": 403,
}


class GameError(Exception):
    def __init__(self, code: str, message: str) -> None:
        if code not in ERROR_STATUS:
            raise ValueError(f"unknown error code {code}")
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def status(self) -> int:
        return ERROR_STATUS[self.code]

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}

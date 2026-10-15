"""Idempotency store (contract §7).

The API stores ``(accountId, Idempotency-Key) -> (request fingerprint, status,
body)`` and replays the stored response when the same key comes back.
"""

from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class StoredResponse:
    fingerprint: str
    status: int
    body: dict


class IdempotencyStore(ABC):
    """Remembers the response to each (account, key) pair.

    The real implementation must (contract §7):
    - keep entries for at least the life of the round;
    - make "check, run, store" atomic per (account, key), so two identical
      requests arriving together run the side effect once;
    - survive a restart if accounts do (TBD with the ledger).
    """

    @abstractmethod
    def get(self, account_id: str, key: str) -> StoredResponse | None: ...

    @abstractmethod
    def put(self, account_id: str, key: str, response: StoredResponse) -> None: ...


class InMemoryIdempotencyStore(IdempotencyStore):
    """SKELETON ONLY. Unbounded dict in process memory; never evicts.

    TODO(ledger owner): add expiry after the round settles and persistence.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[tuple[str, str], StoredResponse] = {}

    def get(self, account_id: str, key: str) -> StoredResponse | None:
        with self._lock:
            return self._items.get((account_id, key))

    def put(self, account_id: str, key: str, response: StoredResponse) -> None:
        with self._lock:
            self._items.setdefault((account_id, key), response)

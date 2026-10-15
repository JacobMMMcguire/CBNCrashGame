"""Crash point generation (contract §4).

``CrashPointProvider`` is the interface the engine depends on.
``FixedSequenceCrashPointProvider`` is a SKELETON ONLY stand-in.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from itertools import cycle
from typing import Iterable


@dataclass(frozen=True)
class RoundSecret:
    """What the server keeps secret until the round crashes (contract §1.2).

    ``crash`` is in integer hundredths (247 means 2.47x). Neither field may
    appear in any API response or event before the round's ``round.crashed``.
    """

    server_seed: str
    crash: int

    def __repr__(self) -> str:  # keep secrets out of logs and tracebacks
        return "RoundSecret(<sealed>)"


class CrashPointProvider(ABC):
    """Decides each round's crash point before the round opens for bets.

    The real implementation (contract §4.1 and §4.2) must:
    - generate ``serverSeed`` as 32 bytes from a cryptographically secure RNG
      (Python: ``secrets.token_bytes(32)``), written as 64 lowercase hex chars;
    - compute ``h = HMAC-SHA256(key=serverSeed, message=roundId)``, take the first
      13 hex chars as a 52-bit integer ``r``, set ``u = r / 2**52`` and
      ``raw = targetRtp / (1 - u)``;
    - return ``crash = min(maxMultiplier, max(1.00, floor(raw * 100) / 100))``;
    - be deterministic for a given (serverSeed, roundId) so rounds can be verified;
    - pass the RTP simulation in docs/WORKFLOW.md Step 2 (1,000,000 rounds within
      +/-0.5% of ``targetRtp``).
    """

    @abstractmethod
    def new_round(self, round_id: str) -> RoundSecret:
        """Return the sealed seed and crash point for ``round_id``."""


class FixedSequenceCrashPointProvider(CrashPointProvider):
    """SKELETON ONLY. Deterministic, insecure, NOT random and NOT fair.

    Returns crash points from a fixed list, in order, forever. The "seed" is a
    SHA-256 of a public string, so anyone can predict it. This exists only so the
    engine, API and UI can be built before the real RNG lands.

    TODO(rng owner): replace with the real provider described in
    ``CrashPointProvider`` (contract §4). Do not ship this.
    """

    DEFAULT_SEQUENCE = (184, 312, 100, 247, 1240, 137, 566, 205)

    def __init__(self, sequence: Iterable[int] = DEFAULT_SEQUENCE, max_multiplier: int | None = None) -> None:
        values = [int(v) for v in sequence]
        if not values or any(v < 100 for v in values):
            raise ValueError("sequence must be non-empty hundredths >= 100")
        if max_multiplier is not None:
            values = [min(v, max_multiplier) for v in values]
        self._next = cycle(values).__next__

    def new_round(self, round_id: str) -> RoundSecret:
        seed = hashlib.sha256(f"SKELETON-ONLY-INSECURE-SEED:{round_id}".encode()).hexdigest()
        return RoundSecret(server_seed=seed, crash=self._next())

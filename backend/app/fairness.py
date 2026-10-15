"""Commitment and verification (contract §4.1 and §4.3).

``FairnessScheme`` is the interface. ``PlaceholderFairness`` is a SKELETON ONLY
stand-in that keeps the wire shapes right but proves nothing.
"""

from __future__ import annotations

import zlib
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class Verification:
    """The fields of GET /api/v1/rounds/{roundId}/verify (contract §8.6)."""

    commitment: str
    server_seed: str
    hmac: str
    crash: int  # hundredths
    valid: bool


class FairnessScheme(ABC):
    """Publishes a commitment before the round and verifies it afterwards.

    The real implementation must:
    - ``commit``: return ``SHA-256(serverSeed)`` as 64 lowercase hex chars (§4.1);
    - ``verify``: check ``SHA-256(serverSeed) == commitment``, recompute
      ``HMAC-SHA256(serverSeed, roundId)`` and the crash formula of §4.2, and
      report ``valid`` only if both match the published crash point (§4.3);
    - use only public inputs, so anyone can repeat the check.
    """

    @abstractmethod
    def commit(self, server_seed: str) -> str: ...

    @abstractmethod
    def verify(self, round_id: str, server_seed: str, commitment: str, crash: int) -> Verification: ...


class PlaceholderFairness(FairnessScheme):
    """SKELETON ONLY. NOT a commitment scheme and NOT fair.

    ``commit`` returns a zero-padded CRC32 of the seed. CRC32 is not a
    cryptographic hash, so this commits to nothing. ``verify`` always reports
    ``valid: false`` and returns a placeholder HMAC of zeros.

    TODO(fairness owner): replace with SHA-256 commit and the full §4.3 check.
    """

    def commit(self, server_seed: str) -> str:
        return f"{zlib.crc32(server_seed.encode()):08x}".rjust(64, "0")

    def verify(self, round_id: str, server_seed: str, commitment: str, crash: int) -> Verification:
        return Verification(
            commitment=commitment,
            server_seed=server_seed,
            hmac="0" * 64,
            crash=crash,
            valid=False,
        )

"""Server clock (contract §1.1 and §5: the server owns the clock).

The engine never calls ``time`` or ``asyncio.sleep`` directly. It goes through a
``Clock`` so tests can control time.
"""

from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone


class Clock(ABC):
    """Time source for the round engine.

    A real implementation must:
    - return the server's own time in integer epoch milliseconds (§5: cash outs
      are judged by the time the server receives them);
    - never go backwards while a round is in flight. ``SystemClock`` uses wall
      time for simplicity; a production clock should measure elapsed flight
      time with a monotonic source and use wall time only for display.
    """

    @abstractmethod
    def now_ms(self) -> int: ...

    @abstractmethod
    async def sleep_ms(self, ms: int) -> None: ...


class SystemClock(Clock):
    def now_ms(self) -> int:
        return time.time_ns() // 1_000_000

    async def sleep_ms(self, ms: int) -> None:
        await asyncio.sleep(max(0, ms) / 1000)


class ManualClock(Clock):
    """Test clock: time moves only when a test calls ``advance`` or the engine sleeps."""

    def __init__(self, start_ms: int = 1_790_000_000_000) -> None:
        self._now = start_ms

    def now_ms(self) -> int:
        return self._now

    def advance(self, ms: int) -> None:
        self._now += ms

    async def sleep_ms(self, ms: int) -> None:
        self._now += max(0, ms)
        await asyncio.sleep(0)


def iso_ms(epoch_ms: int) -> str:
    """Epoch milliseconds to ISO 8601 UTC with milliseconds: 2026-10-15T18:04:12.350Z."""
    dt = datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{epoch_ms % 1000:03d}Z"

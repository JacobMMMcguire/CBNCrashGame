"""Money and multiplier helpers.

Contract §1.4: balances and wagers are integer minor units (1 credit = 100
units). The API carries credits as strings with two decimals ("100.00").
Contract §5: multipliers are floored to two decimals; the engine keeps them as
integer hundredths (247 means 2.47x).
"""

from __future__ import annotations

import math
import re
from decimal import Decimal

UNITS_PER_CREDIT = 100
CREDITS_PATTERN = r"^\d{1,9}\.\d{2}$"
SIGNED_CREDITS_PATTERN = r"^-?\d{1,9}\.\d{2}$"
_CREDITS_RE = re.compile(CREDITS_PATTERN)


def credits_to_units(value: Decimal | str | int) -> int:
    """Exact conversion of a credit amount with at most two decimals to units."""
    d = Decimal(str(value))
    units = d * UNITS_PER_CREDIT
    if units != units.to_integral_value():
        raise ValueError(f"{value} has more than two decimal places")
    return int(units)


def parse_credits(text: str) -> int:
    """Parse an API credit string such as "100.00" into units."""
    if not _CREDITS_RE.match(text):
        raise ValueError(f"'{text}' is not a credit amount with exactly two decimals")
    return credits_to_units(text)


def format_credits(units: int) -> str:
    """Format units as a credit string: 10000 -> "100.00", -2550 -> "-25.50"."""
    sign = "-" if units < 0 else ""
    whole, frac = divmod(abs(units), UNITS_PER_CREDIT)
    return f"{sign}{whole}.{frac:02d}"


def multiplier_to_float(hundredths: int) -> float:
    """247 -> 2.47 (for JSON). Only ever used for output, never for maths."""
    return hundredths / 100


def multiplier_from_float(value: float) -> int:
    """2.47 -> 247. Rejects values with more than two decimals."""
    h = Decimal(str(value)) * 100
    if h != h.to_integral_value():
        raise ValueError(f"{value} has more than two decimal places")
    return int(h)


def multiplier_at(elapsed_ms: int, growth_rate: float) -> int:
    """m(t) = floor(e^(growthRate * t) * 100) in hundredths (contract §5)."""
    if elapsed_ms <= 0:
        return 100
    return max(100, math.floor(math.exp(growth_rate * elapsed_ms / 1000) * 100))


def crash_offset_ms(crash_hundredths: int, growth_rate: float) -> int:
    """Milliseconds after launch at which m(t) reaches the crash point.

    crashAtMs = launchedAt + ln(crash) / growthRate * 1000 (contract §5),
    rounded up so that every whole millisecond before it is below the crash.
    """
    if crash_hundredths <= 100:
        return 0
    return math.ceil(math.log(crash_hundredths / 100) / growth_rate * 1000)


def payout_units(wager_units: int, multiplier_hundredths: int) -> int:
    """wager x multiplier, rounded down to whole units (contract §5)."""
    return wager_units * multiplier_hundredths // 100

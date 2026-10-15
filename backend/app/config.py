"""Game configuration: load config/game.json and validate it at startup.

Source: docs/GAME_CONTRACT.md §3. Every tunable value lives in one file and is
read once when the server starts. Nothing here may be hard-coded in the engine
or the UI.

The loader fails fast with a readable message (``ConfigError``) when the file
is missing, is not valid JSON, has an unknown key, or has a value out of range.
"""

from __future__ import annotations

import json
import os
from decimal import Decimal
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .money import credits_to_units

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = REPO_ROOT / "config" / "game.json"
CONFIG_ENV_VAR = "ASCENT_CONFIG"


class ConfigError(Exception):
    """The config file is missing or invalid. The message is meant for humans."""


class ServerSettings(BaseModel):
    """Server-only settings. Not part of the game contract and never sent to clients."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    corsAllowOrigins: list[str] = Field(default_factory=list)


class GameConfig(BaseModel):
    """The keys of GAME_CONTRACT.md §3, plus ``contractVersion`` and ``server``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    contractVersion: str = Field(pattern=r"^\d+\.\d+\.\d+$")

    minBet: Decimal = Field(gt=0, decimal_places=2)
    maxBet: Decimal = Field(gt=0, decimal_places=2)
    startingBalance: Decimal = Field(ge=0, decimal_places=2)
    maxMultiplier: Decimal = Field(ge=Decimal("1.01"), le=1_000_000, decimal_places=2)
    growthRate: float = Field(gt=0, le=10)
    targetRtp: float = Field(gt=0, lt=1)
    bettingWindowMs: int = Field(ge=50, le=600_000)
    settleDelayMs: int = Field(ge=0, le=600_000)
    tickIntervalMs: int = Field(ge=10, le=1_000)
    multiplierDecimals: int
    autoCashOutMin: Decimal = Field(gt=1, decimal_places=2)
    defaultLanguage: str
    supportedLanguages: list[str] = Field(min_length=1)
    quickBetChips: list[Decimal] = Field(min_length=1, max_length=8)
    realityCheckMinutes: int = Field(ge=0, le=1_440)

    server: ServerSettings = Field(default_factory=ServerSettings)

    @field_validator("multiplierDecimals")
    @classmethod
    def _two_decimals_only(cls, v: int) -> int:
        # The engine stores multipliers as integer hundredths (contract §5).
        if v != 2:
            raise ValueError("only 2 is supported (multipliers are stored as integer hundredths)")
        return v

    @field_validator("supportedLanguages")
    @classmethod
    def _language_codes(cls, v: list[str]) -> list[str]:
        for code in v:
            if len(code) != 2 or not code.isalpha() or not code.islower():
                raise ValueError(f"'{code}' is not a two-letter lowercase language code")
        if len(set(v)) != len(v):
            raise ValueError("contains duplicates")
        return v

    @model_validator(mode="after")
    def _cross_checks(self) -> "GameConfig":
        problems = []
        if self.minBet > self.maxBet:
            problems.append(f"minBet ({self.minBet}) must not be greater than maxBet ({self.maxBet})")
        if self.autoCashOutMin >= self.maxMultiplier:
            problems.append(
                f"autoCashOutMin ({self.autoCashOutMin}) must be below maxMultiplier ({self.maxMultiplier})"
            )
        if self.defaultLanguage not in self.supportedLanguages:
            problems.append(
                f"defaultLanguage '{self.defaultLanguage}' must be one of supportedLanguages {self.supportedLanguages}"
            )
        for chip in self.quickBetChips:
            if not (self.minBet <= chip <= self.maxBet):
                problems.append(f"quickBetChips value {chip} is outside minBet..maxBet")
        if problems:
            raise ValueError("; ".join(problems))
        return self

    # Integer views used by the engine and ledger (contract §1.4, §5).
    @property
    def min_bet_units(self) -> int:
        return credits_to_units(self.minBet)

    @property
    def max_bet_units(self) -> int:
        return credits_to_units(self.maxBet)

    @property
    def starting_balance_units(self) -> int:
        return credits_to_units(self.startingBalance)

    @property
    def max_multiplier_hundredths(self) -> int:
        return int(self.maxMultiplier * 100)

    @property
    def auto_cash_out_min_hundredths(self) -> int:
        return int(self.autoCashOutMin * 100)


def _format_validation_error(path: Path, err: ValidationError) -> str:
    lines = [f"Invalid config file {path}:"]
    for e in err.errors():
        where = ".".join(str(p) for p in e["loc"]) or "(top level)"
        msg = e["msg"].removeprefix("Value error, ")
        if e["type"] == "extra_forbidden":
            msg = "unknown key (check the spelling against docs/GAME_CONTRACT.md §3)"
        elif e["type"] == "missing":
            msg = "required key is missing"
        lines.append(f"  - {where}: {msg}")
    return "\n".join(lines)


def parse_config(raw: dict[str, Any], source: Path | str = "<dict>") -> GameConfig:
    """Validate an already-parsed config mapping. Raises ConfigError."""
    try:
        return GameConfig.model_validate(raw)
    except ValidationError as err:
        raise ConfigError(_format_validation_error(Path(source), err)) from None


def load_config(path: Path | str | None = None) -> GameConfig:
    """Load and validate the config file.

    Order of precedence: the ``path`` argument, then the ``ASCENT_CONFIG``
    environment variable, then ``config/game.json``.
    """
    path = Path(path or os.environ.get(CONFIG_ENV_VAR) or DEFAULT_CONFIG_PATH)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ConfigError(f"Config file not found: {path}") from None
    try:
        # parse_float=Decimal keeps credit values exact (1.10 stays 1.10).
        raw = json.loads(text, parse_float=Decimal)
    except json.JSONDecodeError as err:
        raise ConfigError(f"Config file {path} is not valid JSON: {err}") from None
    if not isinstance(raw, dict):
        raise ConfigError(f"Config file {path} must contain a JSON object")
    return parse_config(raw, path)


def public_config(cfg: GameConfig) -> dict[str, Any]:
    """The subset of the config that clients may see (GET /api/v1/config).

    Server-only settings (``server``) are left out. Credits are sent as strings
    with two decimals (contract §1.4).
    """
    from .money import format_credits

    return {
        "contractVersion": cfg.contractVersion,
        "minBet": format_credits(cfg.min_bet_units),
        "maxBet": format_credits(cfg.max_bet_units),
        "startingBalance": format_credits(cfg.starting_balance_units),
        "maxMultiplier": float(cfg.maxMultiplier),
        "growthRate": cfg.growthRate,
        "targetRtp": cfg.targetRtp,
        "bettingWindowMs": cfg.bettingWindowMs,
        "settleDelayMs": cfg.settleDelayMs,
        "tickIntervalMs": cfg.tickIntervalMs,
        "multiplierDecimals": cfg.multiplierDecimals,
        "autoCashOutMin": float(cfg.autoCashOutMin),
        "defaultLanguage": cfg.defaultLanguage,
        "supportedLanguages": list(cfg.supportedLanguages),
        "quickBetChips": [format_credits(credits_to_units(c)) for c in cfg.quickBetChips],
        "realityCheckMinutes": cfg.realityCheckMinutes,
    }

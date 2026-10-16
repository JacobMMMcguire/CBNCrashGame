"""Wire models for every request, response and event (contract §8 and §9).

Field names are camelCase because these classes *are* the JSON on the wire.
The JSON schemas in contract/schemas/ are generated from ``CONTRACT_MODELS``
by ``scripts/export_schemas.py``; a test fails if they drift.

Serialise with ``wire(model)``: it drops fields that were never set, which is
how ``crash`` and ``serverSeed`` stay absent until a round has crashed.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from .money import CREDITS_PATTERN, SIGNED_CREDITS_PATTERN

Credits = Annotated[str, Field(pattern=CREDITS_PATTERN, examples=["100.00"])]
SignedCredits = Annotated[str, Field(pattern=SIGNED_CREDITS_PATTERN, examples=["-100.00"])]
Multiplier = Annotated[float, Field(ge=1.0, description="Two decimals, floored")]
IsoTime = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")]
Hex64 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
# Single-player rounds are "r_12"; room rounds carry the room code: "K7QX-r_12".
RoundId = Annotated[str, Field(pattern=r"^([A-Z0-9]{4}-)?r_\d+$")]
BetId = Annotated[str, Field(pattern=r"^b_\d+$")]
RoundState = Literal["idle", "betting", "in-flight", "crashed", "settled"]
ErrorCode = Literal[
    "BET_WINDOW_CLOSED", "BET_OUT_OF_RANGE", "INSUFFICIENT_BALANCE", "ALREADY_BET",
    "NO_ACTIVE_BET", "TOO_LATE", "IDEMPOTENCY_KEY_REUSED", "UNAUTHORIZED",
    "INVALID_REQUEST", "ROUND_NOT_IN_FLIGHT", "ROUND_NOT_FOUND", "ROUND_NOT_FINISHED",
    "ROOM_NOT_FOUND", "ROOM_LOCKED", "ROOM_FULL", "NAME_TAKEN", "FORBIDDEN",
]


class Wire(BaseModel):
    model_config = ConfigDict(extra="forbid")


def wire(model: BaseModel) -> dict:
    return model.model_dump(mode="json", exclude_unset=True)


# ---------- Requests (§8.3, §8.4) ----------

class PlaceBetRequest(Wire):
    wager: Credits
    autoCashOut: Multiplier | None = None


class CashOutRequest(Wire):
    """Empty body: ``{}``. The server decides the multiplier (§5)."""


# ---------- Responses (§8) ----------

class AccountResponse(Wire):
    accountId: str = Field(pattern=r"^acc_[A-Za-z0-9]+$")
    balance: Credits
    currency: Literal["credits"]
    language: str


class MyBet(Wire):
    wager: Credits
    autoCashOut: Multiplier | None
    status: Literal["active", "cashed-out", "lost"]


class CurrentRoundResponse(Wire):
    roundId: RoundId
    state: RoundState
    commitment: Hex64 | None
    closesAt: IsoTime | None = Field(description="SKELETON addition: when betting closes (proposed)")
    launchedAt: IsoTime | None
    growthRate: float
    serverTime: IsoTime
    myBet: MyBet | None
    crash: Multiplier | None = Field(default=None, description="Absent until the round has crashed")
    serverSeed: Hex64 | None = Field(default=None, description="Absent until the round has crashed")


class BetResponse(Wire):
    betId: BetId
    roundId: RoundId
    wager: Credits
    autoCashOut: Multiplier | None
    status: Literal["active"]
    balance: Credits


class CashOutResponse(Wire):
    betId: BetId
    status: Literal["cashed-out"]
    multiplier: Multiplier
    payout: Credits
    profit: SignedCredits
    balance: Credits


class MyResult(Wire):
    wager: Credits
    status: Literal["cashed-out", "lost"]
    profit: SignedCredits
    multiplier: Multiplier | None = Field(default=None, description="Present only when cashed out")


class HistoryRound(Wire):
    roundId: RoundId
    crash: Multiplier
    myResult: MyResult | None


class HistoryResponse(Wire):
    rounds: list[HistoryRound]


class VerifyResponse(Wire):
    roundId: RoundId
    commitment: Hex64
    serverSeed: Hex64
    hmac: Hex64
    targetRtp: float
    maxMultiplier: float
    crash: Multiplier
    valid: bool


class ErrorBody(Wire):
    code: ErrorCode
    message: str


class ErrorResponse(Wire):
    error: ErrorBody


class PublicConfigResponse(Wire):
    """SKELETON addition (proposed): the public subset of config/game.json."""

    contractVersion: str
    minBet: Credits
    maxBet: Credits
    startingBalance: Credits
    maxMultiplier: float
    growthRate: float
    targetRtp: float
    bettingWindowMs: int
    settleDelayMs: int
    tickIntervalMs: int
    multiplierDecimals: int
    autoCashOutMin: float
    defaultLanguage: str
    supportedLanguages: list[str]
    quickBetChips: list[Credits]
    realityCheckMinutes: int


class HealthResponse(Wire):
    """SKELETON addition (proposed)."""

    status: Literal["ok"]
    contractVersion: str
    state: RoundState


# ---------- Events (§9) ----------

class BettingData(Wire):
    commitment: Hex64
    closesAt: IsoTime


class LaunchedData(Wire):
    launchedAt: IsoTime
    growthRate: float


class TickData(Wire):
    multiplier: Multiplier
    elapsedMs: int = Field(ge=0)


class CashoutData(Wire):
    betId: BetId
    multiplier: Multiplier
    payout: Credits
    auto: bool


class CrashedData(Wire):
    crash: Multiplier
    serverSeed: Hex64
    commitment: Hex64


class SettledData(Wire):
    """The contract does not define a payload yet; the skeleton sends ``{}``."""


class BalanceData(Wire):
    balance: Credits
    reason: Literal["bet", "cashout"]


class HistoryEntry(Wire):
    roundId: RoundId
    crash: Multiplier


class HistoryData(Wire):
    round: HistoryEntry


class RoundBettingEvent(Wire):
    type: Literal["round.betting"]
    seq: int = Field(ge=0)
    roundId: RoundId
    data: BettingData


class RoundLaunchedEvent(Wire):
    type: Literal["round.launched"]
    seq: int = Field(ge=0)
    roundId: RoundId
    data: LaunchedData


class RoundTickEvent(Wire):
    type: Literal["round.tick"]
    seq: int = Field(ge=0)
    roundId: RoundId
    data: TickData


class RoundCashoutEvent(Wire):
    type: Literal["round.cashout"]
    seq: int = Field(ge=0)
    roundId: RoundId
    data: CashoutData


class RoundCrashedEvent(Wire):
    type: Literal["round.crashed"]
    seq: int = Field(ge=0)
    roundId: RoundId
    data: CrashedData


class RoundSettledEvent(Wire):
    type: Literal["round.settled"]
    seq: int = Field(ge=0)
    roundId: RoundId
    data: SettledData


class BalanceUpdatedEvent(Wire):
    type: Literal["balance.updated"]
    seq: int = Field(ge=0)
    data: BalanceData


class HistoryUpdatedEvent(Wire):
    type: Literal["history.updated"]
    seq: int = Field(ge=0)
    data: HistoryData


EVENT_MODELS: dict[str, type[Wire]] = {
    "round.betting": RoundBettingEvent,
    "round.launched": RoundLaunchedEvent,
    "round.tick": RoundTickEvent,
    "round.cashout": RoundCashoutEvent,
    "round.crashed": RoundCrashedEvent,
    "round.settled": RoundSettledEvent,
    "balance.updated": BalanceUpdatedEvent,
    "history.updated": HistoryUpdatedEvent,
}

# Path under contract/schemas/ and contract/examples/ (without extension) -> model.
CONTRACT_MODELS: dict[str, type[Wire]] = {
    "requests/place_bet": PlaceBetRequest,
    "requests/cash_out": CashOutRequest,
    "responses/account": AccountResponse,
    "responses/current_round": CurrentRoundResponse,
    "responses/place_bet": BetResponse,
    "responses/cash_out": CashOutResponse,
    "responses/history": HistoryResponse,
    "responses/verify": VerifyResponse,
    "responses/error": ErrorResponse,
    "responses/config": PublicConfigResponse,
    "responses/health": HealthResponse,
    **{f"events/{name}": model for name, model in EVENT_MODELS.items()},
}

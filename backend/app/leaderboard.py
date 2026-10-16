"""Room leaderboard: rank seated players by wallet balance.

Basis: the balance in play credits, labelled "Balance (play credits)". Every
player starts with the same ``startingBalance``, so ranking by balance and
by profit give the same order; balance is what players see on their phones.

Ties share a rank (standard competition ranking: 1, 1, 3). Inside a tie,
players are listed in join order, so a newcomer appears at the bottom of
the group that has the starting balance.
"""

from __future__ import annotations

from dataclasses import dataclass

from .money import format_credits

BASIS = "balance"
LABEL = "Balance (play credits)"


@dataclass(frozen=True)
class Standing:
    player_id: str
    name: str
    balance_units: int
    joined_order: int


def rank(standings: list[Standing]) -> list[dict]:
    ordered = sorted(standings, key=lambda s: (-s.balance_units, s.joined_order))
    entries, prev_balance, prev_rank = [], None, 0
    for position, s in enumerate(ordered, start=1):
        rank_ = prev_rank if s.balance_units == prev_balance else position
        entries.append({"rank": rank_, "playerId": s.player_id, "name": s.name,
                        "balance": format_credits(s.balance_units)})
        prev_balance, prev_rank = s.balance_units, rank_
    return entries

"""pyrio stat lines in the shape PRSH's State and overlays read.

pyrio's ``BattingLine`` / ``PitchingLine`` hold the counts and compute the rate
stats; this lays them out under the keys the overlays have always read
(``homeruns``, ``walks_bb``, ``so_pct``, ``ip`` …), rounded for display, with 0
where pyrio has nothing to divide by (NaN).
"""
from __future__ import annotations

import math

from pyrio import BattingLine, PitchingLine, format_batting_line, format_pitching_line

__all__ = [
    "batting_counts",
    "batting_state",
    "pitching_counts",
    "pitching_state",
    "format_batting_line",
    "format_pitching_line",
]


def _rate(value: float, places: int, scale: float = 1.0) -> float:
    return 0.0 if math.isnan(value) else round(value * scale, places)


def batting_counts(line: BattingLine) -> dict:
    return {
        "at_bats": line.at_bats,
        "hits": line.hits,
        "singles": line.singles,
        "doubles": line.doubles,
        "triples": line.triples,
        "homeruns": line.home_runs,
        "sac_flys": line.sac_flies,
        "strikeouts": line.strikeouts,
        "walks_bb": line.walks,
        "walks_hbp": line.hit_by_pitch,
        "rbi": line.rbi,
        "stolen_bases": line.stolen_bases,
    }


def batting_state(line: BattingLine) -> dict:
    """Counts plus avg / obp / slg / ops (3 places) and so_pct (a percentage, 1 place)."""
    return {
        **batting_counts(line),
        "avg": _rate(line.avg, 3),
        "slg": _rate(line.slg, 3),
        "obp": _rate(line.obp, 3),
        "ops": _rate(line.ops, 3),
        "so_pct": _rate(line.k_pct, 1, 100),
    }


def pitching_counts(line: PitchingLine) -> dict:
    return {
        "batters_faced": line.batters_faced,
        "runs_allowed": line.runs_allowed,
        "earned_runs": line.earned_runs,
        "walks_bb": line.walks,
        "walks_hbp": line.hit_by_pitch,
        "hits_allowed": line.hits_allowed,
        "total_pitches": line.pitches_thrown,
        "strikeouts_pitched": line.strikeouts,
        "outs_pitched": line.outs_pitched,
        "hrs_allowed": line.home_runs_allowed,
    }


def pitching_state(line: PitchingLine) -> dict:
    """Counts plus era (1 place), ip ("6.1"), k_pct (a percentage) and opp_avg."""
    return {
        **pitching_counts(line),
        "era": _rate(line.era, 1),
        "ip": f"{line.outs_pitched // 3}.{line.outs_pitched % 3}",
        "k_pct": _rate(line.k_pct, 1, 100),
        "opp_avg": _rate(line.avg_against, 3),
    }

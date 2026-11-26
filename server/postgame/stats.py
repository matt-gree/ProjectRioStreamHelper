"""Box-score shaping for the post-game capture (``server/postgame/capture.py``).

Pure functions over a ``pyrio.Game``: per-character batting/pitching blocks,
the event-derived counters a stat file has no aggregate for (stars won, star
swings, wall jumps, runs scored), the line score, and the full per-side block
the projector broadcasts. Every game rule is pyrio's; this lays the answers out
in the payload shape the overlays read. No State/Settings access here.
"""
from __future__ import annotations

from collections import Counter

from pyrio import BattingLine, FielderAction, Game, PitchingLine, RosterSpot, Side, team_name

from server.rio.stat_lines import (
    batting_state, format_batting_line, format_pitching_line, pitching_state,
)


def batting_block(line: BattingLine) -> dict:
    return {**batting_state(line), "line": format_batting_line(line)}


def pitching_block(line: PitchingLine) -> dict:
    return {**pitching_state(line), "line": format_pitching_line(line)}


def stars_won(game: Game) -> dict[Side, int]:
    """Stars each side won on star chances (pyrio's ``AtBat.star_chance_winner``)."""
    won = Counter(ab.star_chance_winner for ab in game.at_bats)
    return {side: won[side] for side in Side}


def char_event_derived(game: Game) -> dict[RosterSpot, Counter]:
    """Per-character counters only the events can give, keyed by roster spot.

    ``star_swings`` counts every star swing (fouls included; the spent half of
    "star hits vs stars spent" is this times the spot's ``star_swing_cost``),
    ``star_hits`` the star swings that ended the at-bat in a hit,
    ``wall_jumps`` / ``sliding_catches`` the first fielder's action, and
    ``runs`` the times the character scored (``Event.scorers``).
    """
    out: dict[RosterSpot, Counter] = {}

    def bump(spot: RosterSpot, key: str) -> None:
        out.setdefault(spot, Counter())[key] += 1

    for event in game.events:
        for spot in event.scorers:
            bump(spot, "runs")
        if event.is_star_swing:
            bump(event.batter_spot, "star_swings")
            if event.is_hit:
                bump(event.batter_spot, "star_hits")
        if event.fielding is not None:
            if event.fielding.action is FielderAction.WALL_JUMP:
                bump(event.fielding.spot, "wall_jumps")
            elif event.fielding.action is FielderAction.SLIDING:
                bump(event.fielding.spot, "sliding_catches")
    return out


def linescore(game: Game, side: Side) -> list:
    """Runs per inning for one side; ``None`` for a half never batted (the "X" cell)."""
    return list(game.inning_runs(side))


def side_totals(game: Game, side: Side, stars: int) -> dict:
    """Side-level aggregate line for the Game Summary callout."""
    team = game.team(side)
    return {
        "runs": team.score,
        "hits": team.batting.hits,
        "homeruns": team.batting.home_runs,
        "stars_won": stars,
        "strikeouts_pitched": team.pitching.strikeouts,
    }


def side_block(game: Game, side: Side, stars: int = 0,
               derived: dict[RosterSpot, Counter] | None = None) -> dict:
    """One team's full box score."""
    team = game.team(side)
    derived = derived or {}
    characters = []
    for spot in team.roster:
        dv = derived.get(spot, Counter())
        batting = batting_block(spot.batting)
        batting["star_swings"] = dv["star_swings"] * spot.star_swing_cost
        batting["star_hits"] = dv["star_hits"]
        batting["runs"] = dv["runs"]
        pitching = None
        if spot.was_pitcher:
            pitching = pitching_block(spot.pitching)
            pitching["star_pitches"] = spot.pitching.star_pitches_thrown
        outs = {position.label: n for position, n in spot.outs_per_position.items()}
        characters.append({
            "rosterIndex": spot.index,
            "name": spot.character.label,
            "isStarred": spot.is_superstar,
            "isCaptain": spot.is_captain,
            "battingHand": spot.batting_hand.label,
            "fieldingHand": spot.fielding_hand.label,
            "wasPitcher": spot.was_pitcher,
            "batting": batting,
            "pitching": pitching,
            "defense": {
                "big_plays": spot.big_plays,
                "wall_jumps": dv["wall_jumps"],
                "sliding_catches": dv["sliding_catches"],
                "outs_per_position": outs,
                "outs_at_position": sum(outs.values()),
            },
        })
    name = team_name([spot.character for spot in team.roster], team.captain.character)
    return {
        "rioName": team.player,
        "score": team.score,
        "isWinner": game.result.winner is side,
        "captain": team.captain.character.label,
        "teamName": "" if name is None else name.label,
        "totals": side_totals(game, side, stars),
        "characters": characters,
    }

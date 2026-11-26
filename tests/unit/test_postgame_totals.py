"""Post-game side totals over a real game: stars won from star chances, the
line score, and the aggregate block the Game Summary callout reads.

The game rules (who wins a star chance, a line score's "X" cell, runs from the
score) are pyrio's and tested there; these pin how PRSH lays them out.
"""
import pyrio
from pyrio import Side

from server.postgame import stats as postgame_stats
from tests.stat_file import FIXTURE

GAME = pyrio.read_game(FIXTURE)


def test_stars_won_counts_each_sides_star_chances():
    won = postgame_stats.stars_won(GAME)
    expected = {side: sum(ab.star_chance_winner is side for ab in GAME.at_bats) for side in Side}
    assert won == expected
    assert sum(won.values()) == sum(ab.is_star_chance and ab.is_complete for ab in GAME.at_bats)


def test_linescore_adds_up_to_the_final_score():
    for side in Side:
        line = postgame_stats.linescore(GAME, side)
        assert line == list(GAME.inning_runs(side))
        assert sum(r or 0 for r in line) == GAME.team(side).score


def test_side_totals_shape():
    totals = postgame_stats.side_totals(GAME, Side.AWAY, stars=4)
    team = GAME.away
    assert totals == {
        "runs": team.score,
        "hits": team.batting.hits,
        "homeruns": team.batting.home_runs,
        "stars_won": 4,
        "strikeouts_pitched": team.pitching.strikeouts,
    }


def test_side_block_runs_add_up_and_star_swings_are_cost_weighted():
    derived = postgame_stats.char_event_derived(GAME)
    for side in Side:
        block = postgame_stats.side_block(GAME, side, 0, derived)
        chars = block["characters"]
        assert len(chars) == 9
        assert sum(c["batting"]["runs"] for c in chars) == GAME.team(side).score
        for spot, char in zip(GAME.team(side).roster, chars):
            swings = sum(e.is_star_swing for e in GAME.events if e.batter_spot == spot)
            assert char["batting"]["star_swings"] == swings * spot.star_swing_cost
            assert char["battingHand"] in ("Right", "Left")
            assert (char["pitching"] is not None) is spot.was_pitcher
        assert block["teamName"]
        assert block["isWinner"] is (GAME.result.winner is side)

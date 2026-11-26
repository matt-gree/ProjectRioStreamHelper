"""Character Spotlight server layer over a real game: the event-derived
per-character counters and the per-AB walkthrough (``PostGame.character_abs``)."""
import pyrio
from pyrio import FielderAction, Side

from server.postgame import contacts as postgame_contacts, stats as postgame_stats
from server.postgame import PostGame
from tests.stat_file import FIXTURE

GAME = pyrio.read_game(FIXTURE)


def test_char_event_derived_counts_what_the_events_say():
    derived = postgame_stats.char_event_derived(GAME)
    for spot, counts in derived.items():
        mine = [e for e in GAME.events if e.batter_spot == spot]
        assert counts["star_swings"] == sum(e.is_star_swing for e in mine)
        assert counts["star_hits"] == sum(e.is_star_swing and e.is_hit for e in mine)
        fielded = [e for e in GAME.events if e.fielding and e.fielding.spot == spot]
        assert counts["wall_jumps"] == sum(e.fielding.action is FielderAction.WALL_JUMP for e in fielded)
    assert sum(c["runs"] for c in derived.values()) == GAME.away.score + GAME.home.score


def test_runner_entries_out_scored_and_advance():
    event = next(e for e in GAME.events if any(r.scored for r in e.runners))
    entries = postgame_contacts.runner_entries(event)
    assert {r["base"] for r in entries} == {r.start_base for r in event.runners}
    scored = [r for r in entries if r["scored"]]
    assert scored and all(r["resultBase"] == 4 and not r["out"] for r in scored)


def _prime_capture(sb, team_nums=None):
    payload = PostGame._build_payload(("", ""), GAME, FIXTURE.name)
    if team_nums:
        payload["teamNums"] = team_nums
    PostGame._captured[sb] = payload
    PostGame._games[sb] = GAME
    PostGame._contacts.pop(sb, None)
    return payload


def test_character_abs_lists_every_finished_plate_appearance():
    _prime_capture(9)
    spot = GAME.away.roster[3]
    res = PostGame.character_abs(9, 1, 3)
    at_bats = [ab for ab in GAME.at_bats if ab.batter_spot == spot and ab.is_complete]
    assert res["success"] and res["count"] == len(at_bats)
    for ab, rec in zip(at_bats, res["abs"]):
        state = ab.final.state
        assert rec["result"] == ab.result.label
        # Side 1 is away here, so its score is the away score.
        assert rec["before"]["score"] == {"1": state.away_score, "2": state.home_score}
        assert rec["after"]["score"]["1"] == state.away_score + ab.final.runs
        assert rec["after"]["outs"] == state.outs + (ab.final.outs_during_play or 0)


def test_character_abs_orients_by_the_seated_side():
    _prime_capture(9, team_nums={"1": 1, "2": 0})   # home seated on side 1
    res = PostGame.character_abs(9, 1, 0)
    first = res["abs"][0]
    ab = next(a for a in GAME.at_bats if a.batter_spot == GAME.home.roster[0] and a.is_complete)
    assert first["before"]["score"] == {"1": ab.final.state.home_score, "2": ab.final.state.away_score}


def test_balls_in_play_carry_a_flight():
    _prime_capture(9)
    flights = [rec["contact"] for side in (1, 2) for i in range(9)
               for rec in PostGame.character_abs(9, side, i)["abs"] if rec["contact"]]
    assert flights
    assert all(f["path"] and f["hangTime"] > 0 for f in flights)


def test_stars_used_counts_every_star_swing_in_the_pa():
    _prime_capture(9)
    for side, team in ((1, GAME.away), (2, GAME.home)):
        for spot in team.roster:
            at_bats = [ab for ab in GAME.at_bats if ab.batter_spot == spot and ab.is_complete]
            res = PostGame.character_abs(9, side, spot.index)
            for ab, rec in zip(at_bats, res["abs"]):
                swings = sum(e.is_star_swing for e in ab.events)
                assert rec["starsUsed"] == swings * spot.star_swing_cost


def test_character_abs_rejects_bad_args_and_missing_capture():
    _prime_capture(9)
    assert not PostGame.character_abs(9, 3, 0)["success"]
    assert not PostGame.character_abs(9, 1, 11)["success"]
    PostGame._captured.pop(9, None)
    PostGame._games.pop(9, None)
    assert not PostGame.character_abs(9, 1, 0)["success"]


# --- swingInfo.chargePct ---

class _Contact:
    def __init__(self, up, down):
        self.charge_power_up, self.charge_power_down = up, down


class _Pitch:
    def __init__(self, swing):
        self.swing = swing


def test_charge_pct_under_full_and_over():
    charge = _Pitch(pyrio.SwingType.CHARGE)
    assert postgame_contacts.charge_pct(charge, _Contact(0.6, 0.0)) == 60
    assert postgame_contacts.charge_pct(charge, _Contact(1.0, 0.0)) == 100
    assert postgame_contacts.charge_pct(charge, _Contact(1.0, 0.25)) == 125


def test_charge_pct_null_without_a_charge_contact():
    assert postgame_contacts.charge_pct(_Pitch(pyrio.SwingType.CHARGE), None) is None
    assert postgame_contacts.charge_pct(_Pitch(pyrio.SwingType.SLAP), _Contact(1.0, 0.0)) is None


def test_charge_swings_in_the_walkthrough_carry_their_charge():
    _prime_capture(9)
    infos = [rec["swingInfo"] for side in (1, 2) for i in range(9)
             for rec in PostGame.character_abs(9, side, i)["abs"]]
    charged = [i for i in infos if i["type"] == "Charge" and i["chargePct"] is not None]
    assert charged and all(0 <= i["chargePct"] <= 200 for i in charged)
    assert all(i["chargePct"] is None for i in infos if i["type"] != "Charge")


# --- starChanceOutcome ---

def test_star_chance_outcome_follows_the_winner():
    _prime_capture(9)
    for side, team in ((1, GAME.away), (2, GAME.home)):
        for spot in team.roster:
            at_bats = [ab for ab in GAME.at_bats if ab.batter_spot == spot and ab.is_complete]
            for ab, rec in zip(at_bats, PostGame.character_abs(9, side, spot.index)["abs"]):
                winner = ab.star_chance_winner
                expected = None if winner is None else ("won" if winner is ab.batting_side else "lost")
                assert rec["starChanceOutcome"] == expected


# --- character block passthrough ---

def test_character_block_carries_batting_hand():
    _prime_capture(9)
    res = PostGame.character_abs(9, 1, 3)
    assert res["character"]["battingHand"] == GAME.away.roster[3].batting_hand.label

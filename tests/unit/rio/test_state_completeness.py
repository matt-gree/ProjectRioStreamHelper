"""State completeness tests.

Two concerns:
  1. Key parity — HUD and API-ongoing game data must produce identical state
     key sets. HUD supplies {team}_defensive_diamond directly; the API path
     derives it from {team}_fielding_positions. Both go through the same
     parse_game_data + apply_parsed_game_to_state, so the resulting State
     key sets must be identical.

  2. Bleed-through — apply_completed_game_to_state must clear every key that
     a live game writes but a completed game doesn't provide (in-play display
     state, diamond positions, starred flags, etc.).

  3. Reset — the key list expected after a manual reset (mirrors what
     resetBaseballState in ScoreControls.jsx sends). Any key written by a live
     game that the reset omits would leave stale data visible on overlays.
"""
import pytest

from server.rio.provider import (
    RioGameDataProvider as P,
    apply_parsed_game_to_state,
    apply_completed_game_to_state,
)
from server.state import State
from server.utils.deep_dict import deep_get, deep_set


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def s(key):
    return deep_get(State.state, key)


def flatten_keys(d, prefix=""):
    """Return the set of all leaf key paths in a nested dict."""
    keys = set()
    for k, v in d.items():
        full = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys |= flatten_keys(v, full)
        else:
            keys.add(full)
    return keys


def make_game(**overrides):
    """Complete flat game dict — the shape HudWatcher emits."""
    g = {
        "away_score": 3, "home_score": 5,
        "away_captain": 0, "home_captain": 1,
        "away_player": "Alice", "home_player": "Bob",
        "away_logo": 0, "home_logo": 1,
        "away_port": 0, "home_port": 1,
        "away_stars": 2, "home_stars": 4,
        "away_inning_scores": [0, 1, 2], "home_inning_scores": [1, 0, 4],
        # positions 0-8 = P,C,1B,2B,3B,SS,LF,CF,RF — one slot per position
        "away_fielding_positions": list(range(9)),
        "home_fielding_positions": list(range(9)),
        "batter": 0, "pitcher": 0, "half_inning": 0,
        "inning": 3, "outs": 1, "strikes": 2, "balls": 3,
        "runner_on_first": False, "runner_on_second": False, "runner_on_third": False,
        "runner_on_first_roster": None, "runner_on_second_roster": None,
        "runner_on_third_roster": None,
        "star_chance": False, "stadium_id": 0, "innings_selected": 9,
        "first_batting_team": 0, "tag_set": 42, "game_id": "G1",
    }
    for i in range(9):
        for team in ("away", "home"):
            g[f"{team}_roster_{i}_char"] = i
            g[f"{team}_roster_{i}_batting_hand"] = 0
            g[f"{team}_roster_{i}_fielding_hand"] = 0
            g[f"{team}_roster_{i}_is_starred"] = (i == 0)  # captain starred
    g.update(overrides)
    return g


def make_completed(**overrides):
    g = {
        "away_user": "Alice", "home_user": "Bob",
        "away_score": 2, "home_score": 7,
        "away_captain": "Mario", "home_captain": "Luigi",
        "game_id": "C1",
        "linescore": {"0": [0, 1, 1], "1": [2, 3, 2]},
        "stadium": "Bowser Castle",
        "winner_user": "Bob", "loser_user": "Alice",
        "innings_played": 9,
    }
    g.update(overrides)
    return g


# ---------------------------------------------------------------------------
# 1. Key parity: HUD (with defensive_diamond) vs API (derived from positions)
# ---------------------------------------------------------------------------

async def test_hud_and_api_live_produce_same_state_keys(mock_socket):
    """HUD-format data (with pre-computed diamond) and API-format data (diamond
    derived from fielding positions) must write identical State key sets."""

    # HUD format: pyrio computes defensive_diamond and adds it to the dict.
    # With positions [0..8], slot i occupies position i, so diamond[i] = i.
    hud_game = make_game(
        away_defensive_diamond=list(range(9)),
        home_defensive_diamond=list(range(9)),
    )

    # API-ongoing format: no defensive_diamond key present; code derives it.
    api_game = make_game()
    assert "away_defensive_diamond" not in api_game

    parsed_hud = P.parse_game_data(hud_game)
    await apply_parsed_game_to_state(parsed_hud, 1)
    hud_keys = flatten_keys(State.state)

    State.state.clear()

    parsed_api = P.parse_game_data(api_game)
    await apply_parsed_game_to_state(parsed_api, 1)
    api_keys = flatten_keys(State.state)

    only_hud = hud_keys - api_keys
    only_api = api_keys - hud_keys
    assert not only_hud and not only_api, (
        f"Key mismatch between HUD and API paths.\n"
        f"  HUD only: {sorted(only_hud)}\n"
        f"  API only: {sorted(only_api)}"
    )


async def test_hud_and_api_live_produce_same_field_values(mock_socket):
    """With equivalent position data, both paths must write the same field
    character names and pitcher_roster_index."""
    hud_game = make_game(
        away_defensive_diamond=list(range(9)),
        home_defensive_diamond=list(range(9)),
    )
    api_game = make_game()

    parsed_hud = P.parse_game_data(hud_game)
    parsed_api = P.parse_game_data(api_game)

    # field dict and pitcher_roster_index must match
    assert parsed_hud["field"] == parsed_api["field"]
    assert parsed_hud["pitcher_roster_index"] == parsed_api["pitcher_roster_index"]
    assert parsed_hud["pitcher"] == parsed_api["pitcher"]
    assert parsed_hud["pitcher_hand"] == parsed_api["pitcher_hand"]


# ---------------------------------------------------------------------------
# 2. Bleed-through: completed game must clear all live in-play state
# ---------------------------------------------------------------------------

async def test_completed_clears_in_play_hand_and_side(mock_socket):
    parsed = P.parse_game_data(make_game(
        # Give the batter a non-default hand so we can detect if it persists.
        **{f"away_roster_0_batting_hand": 1}
    ))
    await apply_parsed_game_to_state(parsed, 1)
    assert s("score.1.batter_hand") == 1   # confirm it was set
    assert s("score.1.batterSide") == "left"

    await apply_completed_game_to_state(make_completed(), 1)

    assert s("score.1.batter_hand") == 0
    assert s("score.1.pitcher_hand") == 0
    assert s("score.1.batterSide") == "right"


async def test_completed_clears_diamond_positions(mock_socket):
    parsed = P.parse_game_data(make_game())
    await apply_parsed_game_to_state(parsed, 1)
    # At least the pitcher position was populated
    assert s("score.1.field.P") != ""

    await apply_completed_game_to_state(make_completed(), 1)

    for pos in ("P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"):
        assert s(f"score.1.field.{pos}") == "", f"field.{pos} not cleared"


async def test_completed_clears_star_chance_and_tag_set(mock_socket):
    parsed = P.parse_game_data(make_game(star_chance=True, tag_set=99))
    await apply_parsed_game_to_state(parsed, 1)
    assert s("score.1.star_chance") is True
    assert s("score.1.tag_set") == 99

    await apply_completed_game_to_state(make_completed(), 1)

    assert s("score.1.star_chance") is False
    assert s("score.1.tag_set") is None


async def test_completed_clears_is_starred_for_all_slots(mock_socket):
    # make_game marks slot 0 as starred for each team
    parsed = P.parse_game_data(make_game())
    await apply_parsed_game_to_state(parsed, 1)
    assert s("score.1.player.1.character.0.is_starred") is True

    await apply_completed_game_to_state(make_completed(), 1)

    for t in (1, 2):
        for i in range(9):
            val = s(f"score.1.player.{t}.character.{i}.is_starred")
            assert val is False, f"player.{t}.character.{i}.is_starred not cleared (got {val!r})"


# ---------------------------------------------------------------------------
# 3. Reset key coverage
#
# These mirror what resetBaseballState in ScoreControls.jsx sends.
# We apply a live game to State (giving everything a non-default value),
# then apply the same key→value pairs the reset button would send, and
# assert the resulting state matches what we'd expect from a clean slate.
# ---------------------------------------------------------------------------

def apply_reset(sb: int):
    """Simulate the key/value pairs that resetBaseballState sends via setItem."""
    base = f"score.{sb}"
    resets = {
        f"{base}.score_left": 0,
        f"{base}.score_right": 0,
        f"{base}.inning": 1,
        f"{base}.half_inning": "Top",
        f"{base}.outs": 0,
        f"{base}.strikes": 0,
        f"{base}.balls": 0,
        f"{base}.cbRioRunnerOn1": False,
        f"{base}.cbRioRunnerOn2": False,
        f"{base}.cbRioRunnerOn3": False,
        f"{base}.runner1Name": "",
        f"{base}.runner2Name": "",
        f"{base}.runner3Name": "",
        f"{base}.batter": "",
        f"{base}.pitcher": "",
        f"{base}.batter_hand": 0,
        f"{base}.pitcher_hand": 0,
        f"{base}.batterSide": "right",
        f"{base}.batter_roster_index": -1,
        f"{base}.pitcher_roster_index": -1,
        f"{base}.star_chance": False,
        f"{base}.game_completed": False,
        f"{base}.game_id": None,
        f"{base}.home_team": 2,
        f"{base}.innings_selected": None,
        f"{base}.stadium": "",
        f"{base}.tag_set": None,
        f"{base}.away_linescore": [],
        f"{base}.home_linescore": [],
    }
    for pos in ("P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"):
        resets[f"{base}.field.{pos}"] = ""
    for t in (1, 2):
        resets[f"{base}.player.{t}.rioName"] = ""
        resets[f"{base}.player.{t}.msb_team"] = ""
        resets[f"{base}.player.{t}.rio_captainIndex"] = -1
        resets[f"{base}.player.{t}.logo"] = ""
        resets[f"{base}.player.{t}.port"] = None
        resets[f"{base}.player.{t}.team_stars"] = 0
        resets[f"{base}.player.{t}.batting_hands"] = []
        resets[f"{base}.player.{t}.fielding_hands"] = []
        for i in range(9):
            resets[f"{base}.player.{t}.character.{i}.name"] = ""
            resets[f"{base}.player.{t}.character.{i}.is_starred"] = False
            resets[f"{base}.player.{t}.character.{i}.position"] = ""
    for key, val in resets.items():
        deep_set(State.state, key, val)


async def test_reset_clears_all_in_play_fields(mock_socket):
    """After a live game then a reset, all in-play display keys are at their
    empty/default values."""
    parsed = P.parse_game_data(make_game(
        star_chance=True,
        **{f"away_roster_0_batting_hand": 1},
    ))
    await apply_parsed_game_to_state(parsed, 1)

    apply_reset(1)

    assert s("score.1.batter") == ""
    assert s("score.1.pitcher") == ""
    assert s("score.1.batter_hand") == 0
    assert s("score.1.pitcher_hand") == 0
    assert s("score.1.batterSide") == "right"
    assert s("score.1.batter_roster_index") == -1
    assert s("score.1.pitcher_roster_index") == -1
    assert s("score.1.star_chance") is False
    assert s("score.1.game_completed") is False
    for pos in ("P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"):
        assert s(f"score.1.field.{pos}") == "", f"field.{pos} not cleared by reset"


async def test_reset_clears_all_roster_and_hand_data(mock_socket):
    """After reset, roster names, hands, and starred flags are all empty."""
    parsed = P.parse_game_data(make_game())
    await apply_parsed_game_to_state(parsed, 1)

    apply_reset(1)

    for t in (1, 2):
        assert s(f"score.1.player.{t}.rioName") == ""
        assert s(f"score.1.player.{t}.batting_hands") == []
        assert s(f"score.1.player.{t}.fielding_hands") == []
        for i in range(9):
            assert s(f"score.1.player.{t}.character.{i}.name") == ""
            assert s(f"score.1.player.{t}.character.{i}.is_starred") is False
            assert s(f"score.1.player.{t}.character.{i}.position") == ""


async def test_reset_covers_all_live_game_keys(mock_socket):
    """Every key written by a live game must be covered by the reset.

    The reset key list in apply_reset() above is the source of truth for what
    resetBaseballState in ScoreControls.jsx sends. This test catches any key
    a future live-game addition writes that the reset doesn't clear.
    """
    parsed = P.parse_game_data(make_game())
    await apply_parsed_game_to_state(parsed, 1)
    live_keys = flatten_keys(State.state)

    State.state.clear()
    apply_reset(1)
    reset_keys = flatten_keys(State.state)

    uncovered = live_keys - reset_keys
    assert not uncovered, (
        f"Live game writes keys not covered by reset:\n  {sorted(uncovered)}\n"
        "Add them to resetBaseballState in ScoreControls.jsx and apply_reset() in this test."
    )

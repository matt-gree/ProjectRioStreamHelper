"""HUD game parsing: value resolvers + parse_game_data + team-name derivation.

parse_game_data converts Project Rio's flat HUD/API game dict into the TSH
entrant format the rest of the app consumes. The id→name resolvers handle the
fact that the HUD ships names while the API ships integer ids.
"""
import pytest

from server.rio.pyrio.lookup import LookupDicts
from server.rio.provider import _stadium_slug, RioGameDataProvider as P


# --- _stadium_slug ---

@pytest.mark.parametrize("val,expected", [
    (0, "mario_stadium"),          # int id → name → slug
    ("Bowser Castle", "bowser_castle"),  # human name → slug
    ("mario_stadium", "mario_stadium"),  # already a slug → passthrough
    (None, ""),
    ("", ""),
    (-1, ""),
    (True, ""),                    # bool guarded before the int branch
    (9999, ""),                    # unknown id → ""
])
def test_stadium_slug(val, expected):
    assert _stadium_slug(val) == expected


# --- _resolve_char ---

@pytest.mark.parametrize("val,expected", [
    (0, "Mario"),
    (1, "Luigi"),
    ("Peach", "Peach"),   # string passthrough
    (None, ""),
    (9999, "9999"),       # unknown int → str(id) fallback
])
def test_resolve_char(val, expected):
    assert P._resolve_char(val) == expected


# --- _resolve_logo ---

@pytest.mark.parametrize("val,expected", [
    (0, "Mario Sunshines"),
    ("Custom Banner", "Custom Banner"),
    (None, ""),
    ("", ""),
    (True, ""),
    (9999, ""),           # unknown id → ""
])
def test_resolve_logo(val, expected):
    assert P._resolve_logo(val) == expected


# --- _resolve_position ---

@pytest.mark.parametrize("val,expected", [
    (0, "P"),
    (2, "1B"),
    ("SS", "SS"),
    (None, ""),
    ("", ""),
    (True, ""),
    (9999, ""),
])
def test_resolve_position(val, expected):
    assert P._resolve_position(val) == expected


def test_resolve_position_inv_and_none_map_to_empty():
    # The int branch explicitly blanks the placeholder positions.
    inv_ids = [k for k, v in LookupDicts.POSITION.items() if v in ("Inv", "None")]
    for i in inv_ids:
        assert P._resolve_position(i) == ""


# --- parse_game_data ---

def make_game(**over):
    """Build a complete flat HUD game dict (the shape HudWatcher emits)."""
    g = {
        "away_score": 3, "home_score": 5,
        "away_captain": 0, "home_captain": 1,
        "away_player": "Alice", "home_player": "Bob",
        "away_logo": 0, "home_logo": 1,
        "away_port": 0, "home_port": 1,
        "away_stars": 2, "home_stars": 4,
        "away_inning_scores": [0, 1, 2], "home_inning_scores": [1, 0, 4],
        "away_fielding_positions": list(range(9)),
        "home_fielding_positions": list(range(9)),
        "batter": 0, "pitcher": 0,
        "half_inning": 0,
        "inning": 3, "outs": 1, "strikes": 2, "balls": 3,
        "runner_on_first": True, "runner_on_second": False, "runner_on_third": False,
        "runner_on_first_roster": 1, "runner_on_second_roster": None,
        "runner_on_third_roster": None,
        "star_chance": False, "stadium_id": 0, "innings_selected": 9,
        "first_batting_team": 0, "tag_set": 42, "game_id": "G1",
    }
    for i in range(9):
        for team in ("away", "home"):
            g[f"{team}_roster_{i}_char"] = i
            g[f"{team}_roster_{i}_batting_hand"] = 0
            g[f"{team}_roster_{i}_fielding_hand"] = 0
            g[f"{team}_roster_{i}_is_starred"] = False
    g.update(over)
    return g


def test_parse_basic_shape_and_scores():
    d = P.parse_game_data(make_game())
    assert len(d["entrants"]) == 2
    assert d["team1score"] == 3
    assert d["team2score"] == 5


def test_parse_resolves_roster_names():
    d = P.parse_game_data(make_game())
    away = d["entrants"][0][0]
    assert len(away["roster"]) == 9
    assert away["roster"][0] == "Mario"
    assert away["roster"][1] == "Luigi"
    assert away["roster"][6] == "Yoshi"


def test_parse_entrant_metadata():
    d = P.parse_game_data(make_game())
    away, home = d["entrants"][0][0], d["entrants"][1][0]
    assert away["rioName"] == "Alice"
    assert home["rioName"] == "Bob"
    assert away["captainIndex"] == 0
    assert away["logo"] == "Mario Sunshines"
    assert away["port"] == 0
    assert away["team_stars"] == 2
    assert away["inning_scores"] == [0, 1, 2]
    assert isinstance(away["msb_team"], str)


def test_parse_positions_resolved():
    d = P.parse_game_data(make_game())
    positions = d["entrants"][0][0]["positions"]
    assert len(positions) == 9
    assert positions[0] == "P"
    assert positions[2] == "1B"


def test_parse_top_inning_batting_side():
    d = P.parse_game_data(make_game(half_inning=0))
    assert d["half_inning"] == "Top"
    # Top → away (entrants[0]) bats; batter index 0 → "Mario".
    assert d["batter"] == "Mario"
    assert d["pitcher"] == "Mario"  # home roster[0]


def test_parse_bottom_inning_batting_side():
    d = P.parse_game_data(make_game(half_inning=1))
    assert d["half_inning"] == "Bottom"


def test_parse_count_and_inning_state():
    d = P.parse_game_data(make_game())
    assert (d["inning"], d["outs"], d["strikes"], d["balls"]) == (3, 1, 2, 3)


def test_parse_runner_name_from_roster_index():
    d = P.parse_game_data(make_game())
    assert d["runnerOn1"] is True
    assert d["runner1Name"] == "Luigi"   # away roster[1]
    assert d["runner2Name"] == ""        # base empty
    assert d["runner3Name"] == ""


def test_parse_runner_name_fallback_to_name_field():
    # When no roster index is present, fall back to the *_name field.
    d = P.parse_game_data(make_game(
        runner_on_first_roster=None, runner_1b_name="Wario"
    ))
    assert d["runner1Name"] == "Wario"


def test_parse_game_mode_and_metadata():
    d = P.parse_game_data(make_game())
    assert d["tag_set"] == 42
    assert d["game_mode"] == 42
    assert d["stadium_id"] == 0
    assert d["innings_selected"] == 9
    assert d["star_chance"] is False


# --- _get_msb_team_name ---

def test_get_msb_team_name_returns_string():
    roster = ["Mario", "Luigi", "DK", "Diddy", "Peach", "Daisy", "Yoshi",
              "Baby Mario", "Baby Luigi"]
    assert isinstance(P._get_msb_team_name(roster, 0), str)


def test_get_msb_team_name_bad_index_returns_empty():
    assert P._get_msb_team_name(["Mario"], 99) == ""

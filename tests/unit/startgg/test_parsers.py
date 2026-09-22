"""server/startgg/parsers.py — pure dict-in/dict-out transforms of start.gg
GraphQL responses. These have no HTTP/State dependency but sit at 8%
coverage; lock the score-derivation fallback chain, phase-label pool
suffixing, and the two set-shape parsers (list-query vs single-set-query)
including their player/participant fallbacks, since a silent regression here
would corrupt match seating from a start.gg import."""
import pytest

from server.startgg.parsers import (
    deep,
    derive_scores,
    phase_label,
    parse_set,
    parse_set_full,
    parse_entrant,
)


# ---------------------------------------------------------------- deep() ---

def test_deep_nested_path_hit():
    assert deep({"a": {"b": {"c": 5}}}, "a.b.c") == 5


def test_deep_missing_path_returns_default():
    assert deep({"a": {}}, "a.b.c", "X") == "X"


def test_deep_non_dict_mid_path_returns_default():
    # "a" resolves to a non-dict (5); continuing to "b" must not raise.
    assert deep({"a": 5}, "a.b", "X") == "X"


# --------------------------------------------------------- derive_scores ---

def test_derive_scores_explicit_scores_pass_through():
    raw = {"entrant1Score": 3, "entrant2Score": 1}
    assert derive_scores(raw, {}, {}) == (3, 1)


@pytest.mark.parametrize("p1_placement,p2_placement,expected", [
    (1, 2, ("W", "L")),
    (2, 1, ("L", "W")),
    (3, 4, (None, None)),  # why: placement 3+ has no W/L mapping
])
def test_derive_scores_placement_derives_win_loss(p1_placement, p2_placement, expected):
    raw = {}
    p1 = {"standing": {"placement": p1_placement}}
    p2 = {"standing": {"placement": p2_placement}}
    assert derive_scores(raw, p1, p2) == expected


def test_derive_scores_standing_score_used_when_no_placement():
    raw = {}
    p1 = {"standing": {"stats": {"score": {"value": 10}}}}
    p2 = {"standing": {"stats": {"score": {"value": 20}}}}
    assert derive_scores(raw, p1, p2) == (10, 20)


def test_derive_scores_nothing_available_returns_none_none():
    assert derive_scores({}, {}, {}) == (None, None)


# ----------------------------------------------------------- phase_label ---

def test_phase_label_single_group_plain_name():
    raw = {"phaseGroup": {"phase": {"name": "Winners Bracket", "groupCount": 1}}}
    assert phase_label(raw) == "Winners Bracket"


def test_phase_label_multi_group_with_display_identifier():
    raw = {
        "phaseGroup": {
            "phase": {"name": "Pools", "groupCount": 4},
            "displayIdentifier": "B",
        }
    }
    assert phase_label(raw) == "Pools - Pool B"


def test_phase_label_multi_group_without_display_identifier():
    raw = {
        "phaseGroup": {
            "phase": {"name": "Pools", "groupCount": 4},
            "displayIdentifier": "",
        }
    }
    assert phase_label(raw) == "Pools"


# -------------------------------------------------------------- parse_set --

def _raw_set(**over):
    s = {
        "id": 555,
        "entrant1Score": None,
        "entrant2Score": None,
        "fullRoundText": "Winners Round 2",
        "round": 2,
        "totalGames": 3,
        "state": 3,
        "phaseGroup": {
            "phase": {"name": "Bracket", "groupCount": 1, "bracketType": "DOUBLE_ELIMINATION"},
        },
        "slots": [
            {
                "entrant": {
                    "id": 11,
                    "name": "Alice",
                    "initialSeedNum": 1,
                    "participants": [
                        {"player": {"id": 101, "gamerTag": "Alice", "prefix": "AAA"}},
                    ],
                },
            },
            {
                "entrant": {
                    "id": 22,
                    "name": "Bob",
                    "initialSeedNum": 2,
                    "participants": [
                        {"player": {"id": 102, "gamerTag": "Bob", "prefix": "BBB"}},
                    ],
                },
            },
        ],
    }
    s.update(over)
    return s


def test_parse_set_full_shape():
    result = parse_set(_raw_set())
    assert result == {
        "id": 555,
        "team1score": None,
        "team2score": None,
        "round_name": "Winners Round 2",
        "round": 2,
        "tournament_phase": "Bracket",
        "bracket_type": "DOUBLE_ELIMINATION",
        "p1_name": "Alice",
        "p2_name": "Bob",
        "p1_seed": 1,
        "p2_seed": 2,
        "state": "completed",
        "entrants": [
            [{"gamerTag": "Alice", "prefix": "AAA", "playerId": 101}],
            [{"gamerTag": "Bob", "prefix": "BBB", "playerId": 102}],
        ],
        "seeds": [1, 2],
        "entrant_ids": [11, 22],
        "totalGames": 3,
    }


@pytest.mark.parametrize("state_value,expected", [
    (1, "created"),
    (3, "completed"),
    (99, "99"),  # why: unknown int state falls back to str(value)
])
def test_parse_set_state_mapping(state_value, expected):
    result = parse_set(_raw_set(state=state_value))
    assert result["state"] == expected


def test_parse_set_fallback_synthesizes_single_player_from_entrant_name():
    raw = _raw_set()
    # Strip participant detail — only the bare entrant name survives, as in a
    # preview set from an unseeded phase.
    raw["slots"][0]["entrant"]["participants"] = []
    result = parse_set(raw)
    assert result["entrants"][0] == [{"gamerTag": "Alice", "prefix": "", "playerId": None}]


def test_parse_set_name_drops_the_sponsor_prefix():
    """start.gg's entrant name is "AAA | Alice"; every set list prints the tag.

    The cached-bracket path (bracket_cache.sets_from_cache) already answered
    with the bare gamerTag, so the same set read two ways used to print two
    different names.
    """
    raw = _raw_set()
    raw["slots"][0]["entrant"]["name"] = "AAA | Alice"
    result = parse_set(raw)
    assert result["p1_name"] == "Alice"


def test_parse_set_name_keeps_a_team_entrants_own_name():
    """Two participants have no single gamerTag to answer with."""
    raw = _raw_set()
    e = raw["slots"][0]["entrant"]
    e["name"] = "The Bench"
    e["participants"] = [
        {"player": {"id": 101, "gamerTag": "Alice", "prefix": ""}},
        {"player": {"id": 103, "gamerTag": "Carol", "prefix": ""}},
    ]
    assert parse_set(raw)["p1_name"] == "The Bench"


def test_parse_set_name_falls_back_when_participant_detail_is_absent():
    """A preview set from an unseeded phase carries only the entrant name."""
    raw = _raw_set()
    raw["slots"][0]["entrant"]["participants"] = []
    raw["slots"][0]["entrant"]["name"] = "AAA | Alice"
    assert parse_set(raw)["p1_name"] == "AAA | Alice"


def test_parse_set_empty_slots_produce_empty_names():
    raw = _raw_set(slots=[])
    result = parse_set(raw)
    assert result["p1_name"] == ""
    assert result["p2_name"] == ""
    assert result["p1_seed"] is None
    assert result["p2_seed"] is None
    assert result["entrants"] == [[], []]
    assert result["entrant_ids"] == [None, None]


# --------------------------------------------------------- parse_set_full --

def _raw_set_full_with_user():
    return {
        "id": 777,
        "entrant1Score": 2,
        "entrant2Score": 1,
        "fullRoundText": "Grand Final",
        "round": 5,
        "totalGames": 5,
        "phaseGroup": {
            "phase": {"name": "Bracket", "groupCount": 1, "bracketType": "DOUBLE_ELIMINATION"},
        },
        "slots": [
            {
                "entrant": {
                    "id": 11,
                    "initialSeedNum": 1,
                    "participants": [
                        {
                            "player": {"id": 101, "gamerTag": "Alice", "prefix": "AAA"},
                            "user": {
                                "id": 9001,
                                "slug": "user/alice",
                                "name": "Alice Full Name",
                                "genderPronoun": "she/her",
                                "authorizations": [{"externalUsername": "alice_tw"}],
                                "images": [{"url": "https://example.com/alice.png"}],
                                "location": {
                                    "country": "USA",
                                    "state": "CA",
                                    "city": "Los Angeles",
                                },
                            },
                        },
                    ],
                },
            },
            # Second slot has no entrant at all.
            {"entrant": None},
        ],
    }


def test_parse_set_full_player_data_flows_through_user_profile():
    result = parse_set_full(_raw_set_full_with_user())
    assert result["entrants"][0] == [{
        "gamerTag": "Alice",
        "prefix": "AAA",
        "playerId": 101,
        "userId": 9001,
        "userSlug": "user/alice",
        "full_name": "Alice Full Name",
        "pronoun": "she/her",
        "twitter": "alice_tw",
        "avatar": "https://example.com/alice.png",
        "country": "USA",
        "state": "CA",
        "city": "Los Angeles",
    }]


def test_parse_set_full_missing_entrant_yields_none_id_and_empty_entrants():
    result = parse_set_full(_raw_set_full_with_user())
    assert result["entrant_ids"] == [11, None]
    assert result["entrants"][1] == []
    assert result["seeds"] == [1, None]


# ----------------------------------------------------------- parse_entrant --

def test_parse_entrant_shape():
    raw = {
        "id": 33,
        "name": "Charlie",
        "initialSeedNum": 4,
        "participants": [
            {
                "player": {"id": 103, "gamerTag": "Charlie", "prefix": ""},
                "user": {"id": 9002, "name": "Charlie User"},
            },
        ],
    }
    result = parse_entrant(raw)
    assert result["id"] == 33
    assert result["name"] == "Charlie"
    assert result["seed"] == 4
    assert result["players"] == [{
        "gamerTag": "Charlie",
        "prefix": "",
        "playerId": 103,
        "userId": 9002,
        "full_name": "Charlie User",
    }]

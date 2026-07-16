"""Matchup history: the pure head-to-head fold (orientation, tallies, cards)
and the match-side series helpers it feeds (side_for_rio / award_game)."""
import pytest

from server.match import Match
from server.matchup import build_matchup, default_team_name
from server.state import State
from server.utils.deep_dict import deep_get


def game(away, home, a_score, h_score, end, **extra):
    g = {
        "game_id": extra.pop("game_id", hash((away, home, end)) % 10_000),
        "away_user": away, "home_user": home,
        "away_score": a_score, "home_score": h_score,
        "away_captain": extra.pop("away_captain", "Mario"),
        "home_captain": extra.pop("home_captain", "Bowser"),
        "game_mode": extra.pop("game_mode", "Stars Off"),
        "stadium": extra.pop("stadium", "Mario Stadium"),
        "date_time_end": end,
    }
    g.update(extra)
    return g


# --- build_matchup ---

def test_orientation_maps_away_home_to_authored_sides():
    games = [
        game("Alice", "Bob", 5, 3, "2026-06-01T12:00:00"),   # Alice away, wins
        game("Bob", "Alice", 2, 9, "2026-06-02T12:00:00"),   # Alice home, wins
    ]
    p = build_matchup(games, "Alice", "Bob")
    assert p["side1"]["wins"] == 2 and p["side2"]["wins"] == 0
    # Newest first; scores oriented so side1 is always Alice.
    assert [c["side1Score"] for c in p["games"]] == [9, 5]
    assert [c["winnerSide"] for c in p["games"]] == [1, 1]


def test_orientation_is_case_insensitive():
    p = build_matchup([game("ALICE", "bob", 1, 4, "2026-06-01T12:00:00")], "alice", "Bob")
    assert p["side2"]["wins"] == 1
    assert p["games"][0]["side2Score"] == 4


def test_games_with_other_players_are_skipped():
    games = [
        game("Alice", "Carol", 5, 0, "2026-06-01T12:00:00"),
        game("Alice", "Bob", 3, 1, "2026-06-02T12:00:00"),
    ]
    p = build_matchup(games, "Alice", "Bob")
    assert p["totalGames"] == 1
    assert len(p["games"]) == 1


def test_tie_counts_in_total_but_credits_neither():
    p = build_matchup([game("Alice", "Bob", 2, 2, "2026-06-01T12:00:00")], "Alice", "Bob")
    assert p["totalGames"] == 1
    assert p["side1"]["wins"] == 0 and p["side2"]["wins"] == 0
    assert p["games"][0]["winnerSide"] is None


def test_summary_counts_all_games_but_cards_cap_at_five_newest():
    games = [game("Alice", "Bob", 1 + i, 0, f"2026-06-{i + 1:02d}T12:00:00") for i in range(8)]
    p = build_matchup(games, "Alice", "Bob")
    assert p["totalGames"] == 8
    assert p["side1"]["wins"] == 8
    assert len(p["games"]) == 5
    assert p["games"][0]["date"].startswith("2026-06-08")


def test_captain_team_names_attached_with_fallback():
    p = build_matchup(
        [game("Alice", "Bob", 1, 0, "2026-06-01T12:00:00",
              away_captain="Mario", home_captain="")],
        "Alice", "Bob")
    c = p["games"][0]
    assert c["side1Team"] == "Mario Heroes"
    assert c["side2Team"] == ""  # no captain (quit) → overlay falls back


def test_default_team_name_non_captain_is_empty():
    assert default_team_name("Boo") == ""
    assert default_team_name(None) == ""


# --- Match series helpers ---

@pytest.fixture
def bound_match():
    State.state["match"] = {
        "3": {
            "label": "", "stage": "live",
            "format": {"bestOf": 5}, "series": {"1": 1, "2": 0},
            "gameMode": "", "provider": {"startgg": {"setId": None}},
            "player": {
                "1": {"participantId": None, "rioName": "Alice", "captain": "", "port": None},
                "2": {"participantId": None, "rioName": "Bob", "captain": "", "port": None},
            },
        },
    }
    State.state["score"] = {"1": {"match": "3"}}
    return "3"


def test_side_for_rio_resolves_case_insensitively(bound_match):
    assert Match.side_for_rio(bound_match, "alice") == 1
    assert Match.side_for_rio(bound_match, "BOB") == 2
    assert Match.side_for_rio(bound_match, "Carol") is None
    assert Match.side_for_rio(bound_match, "") is None


async def test_award_game_increments_winner_and_projects(bound_match, mock_socket):
    side = await Match.award_game(bound_match, "Bob")
    assert side == 2
    assert deep_get(State.state, "match.3.series.2") == 1
    # Re-projection mirrors the series onto the bound board.
    assert deep_get(State.state, "score.1.player.2.series_wins") == 1
    assert deep_get(State.state, "score.1.player.1.series_wins") == 1
    assert deep_get(State.state, "score.1.best_of") == 5


async def test_award_game_unknown_winner_leaves_series_alone(bound_match):
    assert await Match.award_game(bound_match, "Carol") is None
    assert deep_get(State.state, "match.3.series") == {"1": 1, "2": 0}


async def test_award_game_same_game_id_credits_once(bound_match):
    # HUD post-game capture and the API GameEndWatcher can both report the
    # same finished game — the second report must not double-advance.
    assert await Match.award_game(bound_match, "Bob", game_id="g-1") == 2
    assert await Match.award_game(bound_match, "Bob", game_id="g-1") == 2
    assert deep_get(State.state, "match.3.series.2") == 1


async def test_award_game_distinct_game_ids_credit_separately(bound_match):
    await Match.award_game(bound_match, "Bob", game_id="g-1")
    await Match.award_game(bound_match, "Bob", game_id="g-2")
    assert deep_get(State.state, "match.3.series.2") == 2


async def test_award_game_without_game_id_never_dedupes(bound_match):
    # Legacy/manual callers pass no id — each call is a deliberate credit.
    await Match.award_game(bound_match, "Bob")
    await Match.award_game(bound_match, "Bob")
    assert deep_get(State.state, "match.3.series.2") == 2


async def test_award_game_unknown_winner_does_not_burn_game_id(bound_match):
    # A name-mismatch decline must not mark the id credited — the producer can
    # fix the fixture and the same game can then be credited.
    assert await Match.award_game(bound_match, "Carol", game_id="g-9") is None
    assert await Match.award_game(bound_match, "Bob", game_id="g-9") == 2
    assert deep_get(State.state, "match.3.series.2") == 1

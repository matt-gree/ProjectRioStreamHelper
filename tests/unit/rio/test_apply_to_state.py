"""apply_parsed_game_to_state / apply_completed_game_to_state.

These write the score.{N}.* keys that every overlay and the React store read —
an external contract. Both must collapse to a single SetBatch frame.
"""
from server.rio.provider import (
    RioGameDataProvider as P,
    apply_parsed_game_to_state,
    apply_completed_game_to_state,
)
from server.state import State
from server.utils.deep_dict import deep_get


def make_game(**over):
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
            g[f"{team}_roster_{i}_is_starred"] = False
    g.update(over)
    return g


def s(key):
    return deep_get(State.state, key)


# --- apply_parsed_game_to_state (live HUD/ongoing) ---

async def test_apply_parsed_writes_score_keys(mock_socket):
    parsed = P.parse_game_data(make_game())
    await apply_parsed_game_to_state(parsed, 1, home_team=2)

    assert s("score.1.home_team") == 2
    assert s("score.1.score_left") == 3
    assert s("score.1.score_right") == 5
    assert s("score.1.inning") == 3
    assert s("score.1.half_inning") == "Top"
    assert s("score.1.game_completed") is False
    assert s("score.1.stadium") == "mario_stadium"  # id resolved to slug
    assert s("score.1.player.1.rioName") == "Alice"
    assert s("score.1.player.2.rioName") == "Bob"
    assert s("score.1.player.1.character.0.name") == "Mario"


async def test_apply_parsed_swapped_sets_home_team_one(mock_socket):
    parsed = P.parse_game_data(make_game())
    await apply_parsed_game_to_state(parsed, 1, home_team=1)
    assert s("score.1.home_team") == 1


async def test_apply_parsed_emits_single_batch(mock_socket):
    parsed = P.parse_game_data(make_game())
    await apply_parsed_game_to_state(parsed, 2, home_team=2)
    assert mock_socket.await_count == 1
    assert mock_socket.await_args.args[0] == "v1.state.set_batch"


# --- apply_completed_game_to_state (finished /games row) ---

def make_completed(**over):
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
    g.update(over)
    return g


async def test_apply_completed_marks_final_and_scores(mock_socket):
    await apply_completed_game_to_state(make_completed(), 1)
    assert s("score.1.game_completed") is True
    assert s("score.1.half_inning") == "Final"
    assert s("score.1.score_left") == 2
    assert s("score.1.score_right") == 7
    assert s("score.1.stadium") == "bowser_castle"


async def test_apply_completed_captain_in_slot_zero_rest_cleared(mock_socket):
    await apply_completed_game_to_state(make_completed(), 1)
    assert s("score.1.player.1.rioName") == "Alice"
    assert s("score.1.player.1.character.0.name") == "Mario"
    # Slots 1-8 cleared so a prior live game's roster doesn't bleed through.
    assert s("score.1.player.1.character.1.name") is None
    assert s("score.1.player.2.character.0.name") == "Luigi"


async def test_apply_completed_splits_linescore(mock_socket):
    await apply_completed_game_to_state(make_completed(), 1)
    assert s("score.1.away_linescore") == [0, 1, 1]
    assert s("score.1.home_linescore") == [2, 3, 2]


async def test_apply_completed_emits_single_batch(mock_socket):
    await apply_completed_game_to_state(make_completed(), 1)
    assert mock_socket.await_count == 1
    assert mock_socket.await_args.args[0] == "v1.state.set_batch"

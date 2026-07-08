"""GameEndWatcher._candidate — the Phase C API-side game-end detector's board
selector. Locks in the pool+playback rename (is_set -> is_rotating,
binding.gameId -> binding.playback.gameId) since a silent miss here would
break API-side match winner detection for single-game boards."""
from server.match import Match, default_match
from server.rio.game_end import GameEndWatcher
from server.state import State


async def _make_match(sb, decided=None):
    m = Match.next_id()
    match = default_match()
    match["decided"] = decided
    await State.Set(f"match.{m}", match)
    await Match.project_scoreboard(sb, m)
    await State.Set(f"score.{sb}.match", m)
    await State.Save()
    return m


async def test_candidate_matches_single_api_board_following_the_game(set_setting):
    set_setting("scoreboards.active", [2])
    set_setting("scoreboards.binding.2", {
        "playback": {"mode": "single", "gameId": 42},
    })
    m = await _make_match(2)
    cand = GameEndWatcher._candidate(42, {"away_player": "A", "home_player": "B", "start_time": 100})
    assert cand is not None
    sb, mid, away, home, start_time = cand
    assert (sb, mid, away, home) == (2, m, "A", "B")


async def test_candidate_none_when_board_is_rotating(set_setting):
    set_setting("scoreboards.active", [2])
    set_setting("scoreboards.binding.2", {
        "playback": {"mode": "rotate"}, "pool": {"pinned": [42]},
    })
    m = await _make_match(2)
    assert GameEndWatcher._candidate(42, {"away_player": "A", "home_player": "B"}) is None


async def test_candidate_none_when_gameid_does_not_match(set_setting):
    set_setting("scoreboards.active", [2])
    set_setting("scoreboards.binding.2", {"playback": {"mode": "single", "gameId": 999}})
    m = await _make_match(2)
    assert GameEndWatcher._candidate(42, {"away_player": "A", "home_player": "B"}) is None


async def test_candidate_none_when_match_already_decided(set_setting):
    set_setting("scoreboards.active", [2])
    set_setting("scoreboards.binding.2", {"playback": {"mode": "single", "gameId": 42}})
    m = await _make_match(2, decided="1")
    assert GameEndWatcher._candidate(42, {"away_player": "A", "home_player": "B"}) is None


async def test_candidate_none_for_hud_board(set_setting):
    set_setting("project_rio.hud_enabled", True)
    set_setting("scoreboards.active", [1])
    set_setting("scoreboards.binding.1", {"playback": {"mode": "single", "gameId": 42}})
    m = await _make_match(1)
    assert GameEndWatcher._candidate(42, {"away_player": "A", "home_player": "B"}) is None

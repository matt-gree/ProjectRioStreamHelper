"""GameEndWatcher — the API-side game-end detector that credits series wins.

Covers the full pipeline: `_candidate` board selection (locks the pool+playback
rename: is_set -> is_rotating, binding.gameId -> binding.playback.gameId),
`on_ongoing_poll` dedup via _pending/_done, the `_resolve` retry/abandon/award
loop, and `_lookup_winner`'s start-time cutoff — the guard that keeps a Bo-series
rematch from re-crediting the previous game."""
from unittest.mock import AsyncMock

import pandas as pd
import pytest

import server.rio.game_end as game_end
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


# --- on_ongoing_poll (drop-out detection + dedup) ---

def _followed_board(set_setting, game_id=42):
    set_setting("scoreboards.active", [2])
    set_setting("scoreboards.binding.2", {
        "playback": {"mode": "single", "gameId": game_id},
    })


_GAME = {"away_player": "A", "home_player": "B", "start_time": 100}


async def test_poll_spawns_resolver_for_dropped_followed_game(
        set_setting, monkeypatch):
    _followed_board(set_setting)
    m = await _make_match(2)
    resolve = AsyncMock()
    monkeypatch.setattr(GameEndWatcher, "_resolve", resolve)
    GameEndWatcher.on_ongoing_poll({42: _GAME}, {})
    assert 42 in GameEndWatcher._pending
    await asyncio_yield()
    resolve.assert_awaited_once_with(42, 2, m, "A", "B", 100)


async def test_poll_skips_games_already_pending_or_done(
        set_setting, monkeypatch):
    _followed_board(set_setting)
    await _make_match(2)
    resolve = AsyncMock()
    monkeypatch.setattr(GameEndWatcher, "_resolve", resolve)
    GameEndWatcher._done.add(42)
    GameEndWatcher.on_ongoing_poll({42: _GAME}, {})
    await asyncio_yield()
    resolve.assert_not_awaited()


async def test_poll_noop_on_first_poll_with_empty_prev(
        set_setting, monkeypatch):
    # why: an empty prev means "first poll", not "everything just ended".
    _followed_board(set_setting)
    await _make_match(2)
    resolve = AsyncMock()
    monkeypatch.setattr(GameEndWatcher, "_resolve", resolve)
    GameEndWatcher.on_ongoing_poll({}, {})
    await asyncio_yield()
    resolve.assert_not_awaited()
    assert GameEndWatcher._pending == set()


async def test_poll_ignores_unfollowed_dropped_game(set_setting, monkeypatch):
    _followed_board(set_setting, game_id=999)   # board follows a different game
    await _make_match(2)
    resolve = AsyncMock()
    monkeypatch.setattr(GameEndWatcher, "_resolve", resolve)
    GameEndWatcher.on_ongoing_poll({42: _GAME}, {})
    await asyncio_yield()
    resolve.assert_not_awaited()
    assert 42 not in GameEndWatcher._pending


async def asyncio_yield():
    """Let a just-created task run to its first await (or completion)."""
    import asyncio
    for _ in range(3):
        await asyncio.sleep(0)


# --- _resolve (retry / abandon / award) ---

async def _bound_fixture_match(set_setting, rio1="A", rio2="B"):
    """Board 2 following game 42, bound to a match with rioNames on both sides."""
    _followed_board(set_setting)
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = rio1
    match["player"]["2"]["rioName"] = rio2
    await State.Set(f"match.{m}", match)
    await State.Set(f"score.2.match", m)
    await State.Save()
    return m


async def test_resolve_awards_series_and_marks_done(set_setting, monkeypatch):
    m = await _bound_fixture_match(set_setting)
    monkeypatch.setattr(GameEndWatcher, "_lookup_winner",
                        AsyncMock(return_value="A"))
    GameEndWatcher._pending.add(42)
    await GameEndWatcher._resolve(42, 2, m, "A", "B", 100)
    assert Match.get(m)["series"]["1"] == 1
    assert 42 in GameEndWatcher._done
    assert 42 not in GameEndWatcher._pending


async def test_resolve_name_mismatch_marks_done_without_crediting(
        set_setting, monkeypatch):
    # why: a finished game with an off-fixture winner is a real result the
    # producer resolves by hand — retrying would just re-find the same game.
    m = await _bound_fixture_match(set_setting)
    monkeypatch.setattr(GameEndWatcher, "_lookup_winner",
                        AsyncMock(return_value="Stranger"))
    GameEndWatcher._pending.add(42)
    await GameEndWatcher._resolve(42, 2, m, "A", "B", 100)
    series = Match.get(m)["series"]
    assert (series.get("1") or 0) == 0 and (series.get("2") or 0) == 0
    assert 42 in GameEndWatcher._done


async def test_resolve_abandons_when_match_decided(set_setting, monkeypatch):
    m = await _bound_fixture_match(set_setting)
    await State.Set(f"match.{m}.decided", "1")
    lookup = AsyncMock(return_value="A")
    monkeypatch.setattr(GameEndWatcher, "_lookup_winner", lookup)
    GameEndWatcher._pending.add(42)
    await GameEndWatcher._resolve(42, 2, m, "A", "B", 100)
    lookup.assert_not_awaited()
    assert 42 not in GameEndWatcher._pending
    assert 42 not in GameEndWatcher._done


async def test_resolve_abandons_when_board_rebound(set_setting, monkeypatch):
    m = await _bound_fixture_match(set_setting)
    await State.Set("score.2.match", m + 1)   # producer rebound the board
    lookup = AsyncMock(return_value="A")
    monkeypatch.setattr(GameEndWatcher, "_lookup_winner", lookup)
    await GameEndWatcher._resolve(42, 2, m, "A", "B", 100)
    lookup.assert_not_awaited()


async def test_resolve_retries_until_game_is_ingested(set_setting, monkeypatch):
    m = await _bound_fixture_match(set_setting)
    monkeypatch.setattr(game_end, "RETRY_DELAY", 0)
    monkeypatch.setattr(GameEndWatcher, "_lookup_winner",
                        AsyncMock(side_effect=["", "", "A"]))
    await GameEndWatcher._resolve(42, 2, m, "A", "B", 100)
    assert Match.get(m)["series"]["1"] == 1


async def test_resolve_gives_up_after_retry_max_without_marking_done(
        set_setting, monkeypatch):
    # why: leaving the gid out of _done lets a later ongoing-feed flicker
    # retry it; the producer resolves it by hand meanwhile.
    m = await _bound_fixture_match(set_setting)
    monkeypatch.setattr(game_end, "RETRY_DELAY", 0)
    monkeypatch.setattr(game_end, "RETRY_MAX", 3)
    lookup = AsyncMock(return_value="")
    monkeypatch.setattr(GameEndWatcher, "_lookup_winner", lookup)
    GameEndWatcher._pending.add(42)
    await GameEndWatcher._resolve(42, 2, m, "A", "B", 100)
    assert lookup.await_count == 3
    assert 42 not in GameEndWatcher._done
    assert 42 not in GameEndWatcher._pending
    series = Match.get(m)["series"]
    assert (series.get("1") or 0) == 0


# --- _lookup_winner (start-time cutoff against the completed pool) ---

_T0 = 1_700_000_000   # the followed game's start_time


def _games_df(rows):
    """rows: list of (winner_user, start_epoch_seconds)."""
    return pd.DataFrame({
        "winner_user": [w for w, _ in rows],
        "date_time_start": [
            pd.Timestamp(t, unit="s", tz="UTC").isoformat() for _, t in rows
        ],
    })


@pytest.fixture
def fake_completed(monkeypatch):
    from server.rio import stats_api

    holder = {"df": None, "raises": False, "calls": 0}

    async def fetch(**kw):
        holder["calls"] += 1
        if holder["raises"]:
            raise RuntimeError("api down")
        return holder["df"]

    monkeypatch.setattr(stats_api, "fetch_completed_games", fetch)
    return holder


async def test_lookup_empty_names_short_circuits(fake_completed):
    assert await GameEndWatcher._lookup_winner("", "", _T0) == ""
    assert fake_completed["calls"] == 0


async def test_lookup_not_ingested_yet_returns_empty(fake_completed):
    fake_completed["df"] = _games_df([])
    assert await GameEndWatcher._lookup_winner("A", "B", _T0) == ""


async def test_lookup_missing_winner_column_returns_empty(fake_completed):
    fake_completed["df"] = pd.DataFrame({"something_else": [1]})
    assert await GameEndWatcher._lookup_winner("A", "B", _T0) == ""


async def test_lookup_filters_out_games_older_than_the_followed_one(
        fake_completed):
    # why: an earlier Bo-series game between the same pairing must not be
    # mistaken for the game that just ended — "only old games" means "not
    # ingested yet", which the resolver treats as retry.
    fake_completed["df"] = _games_df([("A", _T0 - 3600)])
    assert await GameEndWatcher._lookup_winner("A", "B", _T0) == ""


async def test_lookup_returns_most_recent_qualifying_winner(fake_completed):
    fake_completed["df"] = _games_df([
        ("A", _T0 + 60),
        ("B", _T0 + 900),    # most recent — wins the sort
        ("A", _T0 - 3600),   # pre-cutoff — filtered
    ])
    assert await GameEndWatcher._lookup_winner("A", "B", _T0) == "B"


async def test_lookup_api_failure_returns_empty(fake_completed):
    fake_completed["raises"] = True
    assert await GameEndWatcher._lookup_winner("A", "B", _T0) == ""

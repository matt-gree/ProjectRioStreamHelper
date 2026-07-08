"""PoolState membership recompute — the continuously-evaluated pool that
replaces the old additive-only RotationState._refresh_game_list (see
~/.claude/plans/pool-playback-unification.md). Covers: pinned/excluded
overrides, live vs completed scope filtering, and the scope-exit rule (a
currently-displayed game that falls out of scope finishes its turn before
being dropped, never yanked mid-display)."""
from unittest.mock import AsyncMock

import pandas as pd
import pytest

from server.rio.game_pool import OngoingGamePool
from server.rio.rotation import PoolState, _chip_matches
from server.rio import stats_api


def _live(game_id, away, home, mode="Ranked"):
    return {
        "game_id": game_id, "away_user": away, "home_user": home,
        "game_mode_name": mode,
    }


@pytest.fixture(autouse=True)
def clean_ongoing_pool(monkeypatch):
    monkeypatch.setattr(OngoingGamePool, "games", {})


def _completed_df(rows):
    return pd.DataFrame(rows)


# --- _chip_matches ---

def test_chip_with_no_fields_matches_nothing():
    assert _chip_matches(_live(1, "A", "B"), {}) is False


def test_chip_matches_on_tag():
    chip = {"tag": ["Ranked"]}
    assert _chip_matches(_live(1, "A", "B", mode="Ranked"), chip) is True
    assert _chip_matches(_live(1, "A", "B", mode="Casual"), chip) is False


def test_chip_matches_on_username_either_side():
    chip = {"username": ["A"]}
    assert _chip_matches(_live(1, "A", "B"), chip) is True
    assert _chip_matches(_live(1, "B", "A"), chip) is True
    assert _chip_matches(_live(1, "C", "D"), chip) is False


def test_chip_matches_requires_all_specified_fields():
    chip = {"tag": ["Ranked"], "username": ["A"]}
    assert _chip_matches(_live(1, "A", "B", mode="Ranked"), chip) is True
    assert _chip_matches(_live(1, "A", "B", mode="Casual"), chip) is False
    assert _chip_matches(_live(1, "C", "D", mode="Ranked"), chip) is False


# --- PoolState._compute_members ---

async def test_pinned_included_even_when_out_of_every_filter():
    OngoingGamePool.games = {1: _live(1, "A", "B")}
    state = PoolState(sb_id=1, pool_cfg={
        "filters": [{"tag": ["Ranked"]}], "scope": "live",
        "pinned": [1], "excluded": [],
    }, interval=30)
    members = await state._compute_members()
    # game 1 matches the filter anyway; add a second pinned game that doesn't.
    OngoingGamePool.games[2] = _live(2, "C", "D", mode="Casual")
    state.pool_cfg["pinned"] = [1, 2]
    members = await state._compute_members()
    assert set(members) == {1, 2}


async def test_excluded_removed_even_if_pinned_or_matching():
    OngoingGamePool.games = {1: _live(1, "A", "B")}
    state = PoolState(sb_id=1, pool_cfg={
        "filters": [{"username": ["A"]}], "scope": "live",
        "pinned": [1], "excluded": [1],
    }, interval=30)
    members = await state._compute_members()
    assert members == {}


async def test_live_scope_only_returns_matching_ongoing_games():
    OngoingGamePool.games = {
        1: _live(1, "A", "B", mode="Ranked"),
        2: _live(2, "C", "D", mode="Casual"),
    }
    state = PoolState(sb_id=1, pool_cfg={
        "filters": [{"tag": ["Ranked"]}], "scope": "live", "pinned": [], "excluded": [],
    }, interval=30)
    members = await state._compute_members()
    assert set(members) == {1}


async def test_completed_scope_absent_when_scope_is_live_only():
    """A live-only pool must never hit the completed-games API."""
    fetch = AsyncMock(return_value=_completed_df([{"game_id": 9, "away_user": "A", "home_user": "B"}]))
    import server.rio.rotation as rotation_mod
    orig = stats_api.fetch_completed_games
    rotation_mod.stats_api.fetch_completed_games = fetch
    try:
        state = PoolState(sb_id=1, pool_cfg={
            "filters": [{"tag": ["Ranked"]}], "scope": "live", "pinned": [], "excluded": [],
        }, interval=30)
        await state._compute_members()
        fetch.assert_not_called()
    finally:
        rotation_mod.stats_api.fetch_completed_games = orig


async def test_completed_scope_fetches_per_chip_and_sanitizes_rows():
    fetch = AsyncMock(return_value=_completed_df([
        {"game_id": 9, "away_user": "A", "home_user": "B"},
    ]))
    import server.rio.rotation as rotation_mod
    orig = stats_api.fetch_completed_games
    rotation_mod.stats_api.fetch_completed_games = fetch
    try:
        state = PoolState(sb_id=1, pool_cfg={
            "filters": [{"username": ["A"]}], "scope": "completed", "pinned": [], "excluded": [],
        }, interval=30)
        members = await state._compute_members()
        assert set(members) == {9}
        assert members[9]["game_completed"] is True
        fetch.assert_called_once_with(username=["A"])
    finally:
        rotation_mod.stats_api.fetch_completed_games = orig


# --- PoolState.refresh_now — add/remove + scope-exit deferral ---

def _mark_rotating(set_setting, sb=1):
    """_apply_current() self-cancels (and stops any tracked rotation) unless
    the board is actually marked rotating — mirror that so refresh_now's
    initial-population apply behaves like it would under a real running
    PoolManager-owned rotation instead of tripping the self-cancel path."""
    set_setting(f"scoreboards.binding.{sb}.playback.mode", "rotate")


async def test_refresh_now_adds_new_live_matches(mock_socket, set_setting):
    _mark_rotating(set_setting)
    OngoingGamePool.games = {1: _live(1, "A", "B")}
    state = PoolState(sb_id=1, pool_cfg={
        "filters": [{"tag": ["Ranked"]}], "scope": "live", "pinned": [], "excluded": [],
    }, interval=30)
    await state.refresh_now()
    assert state.game_ids == [1]

    OngoingGamePool.games[2] = _live(2, "C", "D")
    await state.refresh_now()
    assert set(state.game_ids) == {1, 2}


async def test_refresh_now_drops_game_that_left_scope_when_not_displayed(mock_socket, set_setting):
    _mark_rotating(set_setting)
    OngoingGamePool.games = {1: _live(1, "A", "B"), 2: _live(2, "C", "D")}
    state = PoolState(sb_id=1, pool_cfg={
        "filters": [{"tag": ["Ranked"]}], "scope": "live", "pinned": [], "excluded": [],
    }, interval=30)
    await state.refresh_now()
    state.current_index = 0  # displaying game_ids[0]
    displayed = state.game_ids[0]
    other = state.game_ids[1]

    # The *other* (non-displayed) game goes final and drops from ongoing.
    del OngoingGamePool.games[other]
    await state.refresh_now()
    assert other not in state.game_ids
    assert displayed in state.game_ids


async def test_refresh_now_defers_removal_of_currently_displayed_game(mock_socket, set_setting):
    """Scope-exit rule: the currently-displayed game finishes its turn — it's
    kept for the recompute where it falls out of scope, and only actually
    dropped on a later recompute after the cursor has moved off it (here,
    off a real advance() — the mechanism a running rotation actually uses)."""
    _mark_rotating(set_setting)
    OngoingGamePool.games = {1: _live(1, "A", "B"), 2: _live(2, "C", "D")}
    state = PoolState(sb_id=1, pool_cfg={
        "filters": [{"tag": ["Ranked"]}], "scope": "live", "pinned": [], "excluded": [],
    }, interval=30)
    await state.refresh_now()
    assert set(state.game_ids) == {1, 2}
    state.current_index = state.game_ids.index(1)  # displaying game 1

    # Game 1 goes final and drops from ongoing — it's still the displayed game.
    del OngoingGamePool.games[1]
    await state.refresh_now()
    assert 1 in state.game_ids, "currently-displayed game must not be yanked mid-turn"

    # The rotation timer fires and advances the cursor off game 1...
    await state.advance(1)
    assert state.game_ids[state.current_index] != 1

    # ...so the next recompute finally drops it (out of scope, not pinned,
    # and no longer under the cursor).
    await state.refresh_now()
    assert 1 not in state.game_ids


async def test_refresh_now_excluded_wins_over_pinned(mock_socket, set_setting):
    _mark_rotating(set_setting)
    OngoingGamePool.games = {1: _live(1, "A", "B")}
    state = PoolState(sb_id=1, pool_cfg={
        "filters": [], "scope": "live", "pinned": [1], "excluded": [1],
    }, interval=30)
    await state.refresh_now()
    assert state.game_ids == []

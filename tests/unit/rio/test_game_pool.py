"""Game-pool helpers: pandas/numpy row sanitizing, pinned-swap detection, and
the completed-game apply path (swap + persist)."""
import math

import numpy as np
import pandas as pd
import pytest

from server.rio.game_pool import (
    _sanitize_row,
    _pinned_swap_needed,
    apply_completed_game_dict,
)
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get


# --- _sanitize_row ---

def test_sanitize_timestamp_to_isoformat():
    out = _sanitize_row({"t": pd.Timestamp("2024-01-02T03:04:05")})
    assert out["t"] == "2024-01-02T03:04:05"


def test_sanitize_nat_and_nan_to_none():
    out = _sanitize_row({
        "a": pd.NaT,
        "b": np.float64(np.nan),
        "c": float("nan"),
    })
    assert out == {"a": None, "b": None, "c": None}


def test_sanitize_numpy_scalars_to_python_types():
    out = _sanitize_row({
        "i": np.int64(5),
        "f": np.float64(1.5),
        "b": np.bool_(True),
    })
    assert out["i"] == 5 and isinstance(out["i"], int)
    assert out["f"] == 1.5 and isinstance(out["f"], float)
    assert out["b"] is True and isinstance(out["b"], bool)


def test_sanitize_passthrough_plain_values():
    out = _sanitize_row({"s": "hello", "n": 7, "ok": True})
    assert out == {"s": "hello", "n": 7, "ok": True}


# --- _pinned_swap_needed ---

def test_pinned_swap_none_when_no_pin():
    assert _pinned_swap_needed("Alice", "Bob") is None


def test_pinned_swap_none_when_pin_not_in_game(set_setting):
    set_setting("project_rio.pinned_player", "Zoe")
    assert _pinned_swap_needed("Alice", "Bob") is None


@pytest.mark.parametrize("side,p0,p1,expected", [
    ("Team 1", "Alice", "Bob", False),  # pinned Alice already on left
    ("Team 2", "Alice", "Bob", True),   # pinned Alice on left, wants right
    ("Team 1", "Bob", "Alice", True),   # pinned Alice on right, wants left
    ("Team 2", "Bob", "Alice", False),  # pinned Alice already on right
])
def test_pinned_swap_decisions(set_setting, side, p0, p1, expected):
    set_setting("project_rio.pinned_player", "Alice")
    set_setting("project_rio.pinned_side", side)
    assert _pinned_swap_needed(p0, p1) is expected


# --- apply_completed_game_dict ---

def _completed(**over):
    g = {
        "away_user": "Alice", "home_user": "Bob",
        "away_score": 2, "home_score": 7,
        "away_captain": "Mario", "home_captain": "Luigi",
        "game_id": "C1",
        "linescore": {"0": [0, 1, 1], "1": [2, 3, 2]},
        "stadium": "Mario Stadium",
    }
    g.update(over)
    return g


def s(key):
    return deep_get(State.state, key)


async def test_apply_completed_dict_returns_false_on_empty():
    assert await apply_completed_game_dict(None, 1) is False


async def test_apply_completed_dict_no_pin(mock_socket):
    ok = await apply_completed_game_dict(_completed(), 1)
    assert ok is True
    assert s("score.1.player.1.rioName") == "Alice"
    assert s("score.1.score_left") == 2
    assert Settings.Get("scoreboards.binding.1.playback.gameId") == "C1"


async def test_apply_completed_dict_applies_pinned_swap(set_setting, mock_socket):
    # Pin the home player to Team 1 → away/home must swap before applying.
    set_setting("project_rio.pinned_player", "Bob")
    set_setting("project_rio.pinned_side", "Team 1")
    await apply_completed_game_dict(_completed(), 1)
    assert s("score.1.player.1.rioName") == "Bob"      # swapped to the left
    assert s("score.1.player.2.rioName") == "Alice"
    assert s("score.1.score_left") == 7                # home score now on left


def test_stable_ongoing_game_id_is_deterministic():
    # playback.gameId is persisted across restarts, so the synthetic id must be
    # a pure function of its inputs (never builtin hash(), which is per-process).
    from server.rio.game_pool import _stable_ongoing_game_id

    a = _stable_ongoing_game_id("Alice", "Bob", "2026-07-15 10:00:00")
    assert a == _stable_ongoing_game_id("Alice", "Bob", "2026-07-15 10:00:00")
    assert 0 <= a < 2**31
    assert a != _stable_ongoing_game_id("Bob", "Alice", "2026-07-15 10:00:00")


# --- live_following: is this board's game still being polled for? ---

async def test_live_following_set_when_a_live_game_is_applied(mock_socket, monkeypatch):
    """A game from the ongoing feed is on the board, so the feed is worth polling
    for it. The console's live-refresh countdown renders on this flag."""
    from server.rio.game_pool import OngoingGamePool

    monkeypatch.setattr(OngoingGamePool, "games", {7: {
        "game_id": 7, "away_player": "Alice", "home_player": "Bob",
        "away_user": "Alice", "home_user": "Bob", "game_completed": False,
    }})
    await OngoingGamePool.apply_game_to_scoreboard(7, 1)
    assert s("score.1.live_following") is True


async def test_live_following_cleared_when_the_followed_game_leaves_the_feed(
    mock_socket, set_setting, monkeypatch,
):
    """The end-of-follow case the flag exists for. `_live_consumers_exist` stops
    counting the board, so nothing will ever update it again — but game_completed
    stays False, and the poll's socket event is app-wide (another board's rotation
    keeps firing it). Without this the console would promise a refresh forever."""
    from server.rio.game_pool import OngoingGamePool, END_MISS_TOLERANCE

    set_setting("scoreboards.active", [1])
    set_setting("project_rio.hud_enabled", False)
    set_setting("scoreboards.binding.1.playback", {"mode": "single", "gameId": 7})
    await State.Set("score.1.live_following", True)

    # The game is gone from the feed; a flickering feed gets grace first.
    monkeypatch.setattr(OngoingGamePool, "games", {})
    monkeypatch.setattr(OngoingGamePool, "_follow_misses", {})
    monkeypatch.setattr(OngoingGamePool, "_ended_follow", {})
    for _ in range(END_MISS_TOLERANCE - 1):
        await OngoingGamePool._reapply_single_live()
        assert s("score.1.live_following") is True

    await OngoingGamePool._reapply_single_live()
    assert s("score.1.live_following") is False
    assert OngoingGamePool._ended_follow.get(1) == 7


async def test_live_following_cleared_by_a_completed_game(mock_socket):
    """A board moving from a live game to a completed one has to clear the flag,
    or it keeps the last live game's countdown running under it."""
    await State.Set("score.1.live_following", True)
    await apply_completed_game_dict(_completed(), 1)
    assert s("score.1.live_following") is False

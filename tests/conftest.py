"""Shared pytest fixtures.

The server is built on class-level singletons (State, Settings,
RioGameDataProvider, StatsTracker, PoolManager) whose mutable class
variables would otherwise leak between tests. The autouse fixtures here give
every test a clean baseline, redirect all disk writes into a temp dir, and a
SocketIO emit that never touches a real server.
"""
import asyncio
import copy
from unittest.mock import AsyncMock

import pytest

import server


@pytest.fixture(autouse=True)
def mock_socket(monkeypatch):
    """Replace the shared SocketIO server's emit with an AsyncMock.

    ``server.socketio`` is a single AsyncServer instance imported by State and
    Settings, so patching the instance method covers every caller. Returned so
    a test can assert on emitted frames (e.g. SetBatch must emit exactly one).
    """
    emit = AsyncMock()
    monkeypatch.setattr(server.socketio, "emit", emit)
    return emit


@pytest.fixture(autouse=True)
def isolate_user_data(tmp_path, monkeypatch):
    """Point every persisted-file path at a per-test temp dir.

    State.Export/SaveImmediately and Settings.Save write to user_data/ by
    default; redirect them so a test that triggers a save never clobbers the
    developer's real settings.json / state.json / stream_labels.
    """
    from aiopath import AsyncPath
    from server.state import State
    from server.settings import Settings

    monkeypatch.setattr(State, "_program_state_out",
                        AsyncPath(str(tmp_path / "state.json")))
    monkeypatch.setattr(State, "_stream_labels_out",
                        AsyncPath(str(tmp_path / "stream_labels")))
    monkeypatch.setattr(Settings, "_settings_out",
                        AsyncPath(str(tmp_path / "settings.json")))
    return tmp_path


@pytest.fixture(autouse=True)
def reset_singletons():
    """Snapshot and restore class-level singleton state around every test."""
    from server.state import State
    from server.settings import Settings
    from server.rio.provider import RioGameDataProvider as Provider
    from server.rio.stats_tracker import StatsTracker
    from server.rio.rotation import PoolManager

    saved = {
        "state": copy.deepcopy(State.state),
        "last_state": copy.deepcopy(State.last_state),
        "changed_keys": list(State.changed_keys),
        "settings": copy.deepcopy(Settings.settings),
        "prev_sides": dict(Provider._prev_player_sides),
        "prev_inning": Provider._prev_inning,
        "sides_swapped": Provider._sides_swapped,
        "user_overridden": Provider._user_overridden,
        "hud_targets": list(Provider._hud_targets),
        "hud_watcher": Provider.hud_watcher,
        "stats_slots": dict(StatsTracker._slots),
        "rotations": dict(PoolManager._rotations),
    }

    # Clean baseline for the test.
    State.state = {}
    State.last_state = {}
    State.changed_keys = []
    # Fresh queue per test so a coroutine enqueued under one test's event loop
    # never gets awaited under another's ("attached to a different loop").
    State.queue = asyncio.Queue()

    Provider._prev_player_sides = {}
    Provider._prev_inning = None
    Provider._sides_swapped = False
    Provider._user_overridden = False
    Provider._hud_targets = []
    Provider.hud_watcher = None

    StatsTracker._slots = {}
    PoolManager._rotations = {}

    yield

    State.state = saved["state"]
    State.last_state = saved["last_state"]
    State.changed_keys = saved["changed_keys"]
    Settings.settings = saved["settings"]
    Provider._prev_player_sides = saved["prev_sides"]
    Provider._prev_inning = saved["prev_inning"]
    Provider._sides_swapped = saved["sides_swapped"]
    Provider._user_overridden = saved["user_overridden"]
    Provider._hud_targets = saved["hud_targets"]
    Provider.hud_watcher = saved["hud_watcher"]
    StatsTracker._slots = saved["stats_slots"]
    PoolManager._rotations = saved["rotations"]


@pytest.fixture
def set_setting():
    """Set a dotted settings key for the duration of a test (auto-restored)."""
    from server.settings import Settings
    from server.utils.deep_dict import deep_set

    def _set(key, value):
        deep_set(Settings.settings, key, value)

    return _set

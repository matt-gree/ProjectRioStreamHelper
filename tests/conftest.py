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
    from server.participants import Participants
    from server.state import State
    from server.settings import Settings

    monkeypatch.setattr(State, "_program_state_out",
                        AsyncPath(str(tmp_path / "state.json")))
    monkeypatch.setattr(State, "_stream_labels_out",
                        AsyncPath(str(tmp_path / "stream_labels")))
    monkeypatch.setattr(Settings, "_settings_out",
                        AsyncPath(str(tmp_path / "settings.json")))
    monkeypatch.setattr(Participants, "_out",
                        AsyncPath(str(tmp_path / "participants.json")))
    return tmp_path


@pytest.fixture(autouse=True)
def reset_singletons():
    """Snapshot and restore class-level singleton state around every test."""
    from server.announcements import Announcements
    from server.automations import Automations
    from server.participants import Participants
    from server.state import State
    from server.settings import Settings
    from server.match import Match
    from server.postgame import PostGame
    from server.postgame_watch import StatFileWatcher
    from server.rio.game_end import GameEndWatcher
    from server.rio.game_pool import CompletedGamePool, OngoingGamePool
    from server.rio.provider import RioGameDataProvider as Provider
    from server.rio.stats_tracker import StatsTracker
    from server.rio.rotation import PoolManager
    from server.startgg.provider import StartGGProvider

    saved = {
        "state": copy.deepcopy(State.state),
        "last_state": copy.deepcopy(State.last_state),
        "changed_keys": list(State.changed_keys),
        "settings": copy.deepcopy(Settings.settings),
        "prev_sides": dict(Provider._prev_player_sides),
        "prev_inning": Provider._prev_inning,
        "prev_game_id": Provider._prev_game_id,
        "sides_swapped": Provider._sides_swapped,
        "user_overridden": Provider._user_overridden,
        "feed_released": Provider._feed_released,
        "hud_targets": list(Provider._hud_targets),
        "hud_watcher": Provider.hud_watcher,
        "stats_slots": dict(StatsTracker._slots),
        "rotations": dict(PoolManager._rotations),
        "credited_games": copy.deepcopy(Match._credited_games),
        "gameend_pending": set(GameEndWatcher._pending),
        "gameend_done": set(GameEndWatcher._done),
        "autocapture_done": set(StatFileWatcher._done),
        "announcements_active": list(Announcements._active),
        "participants": dict(Participants.participants),
        # The API-game pools and the post-game caches are class-level dicts
        # like every entry above. They were missed, so a test that seeded a
        # pool or captured a box score left it visible to every later test —
        # latent only because nothing yet asserts on an empty pool.
        "ongoing_games": dict(OngoingGamePool.games),
        "ongoing_follow_misses": dict(OngoingGamePool._follow_misses),
        "ongoing_ended_follow": dict(OngoingGamePool._ended_follow),
        "completed_games": dict(CompletedGamePool.games),
        "pg_captured": dict(PostGame._captured),
        "pg_stat_objs": dict(PostGame._stat_objs),
        "pg_contacts": dict(PostGame._contacts),
        # The loaded event and its parsed brackets are class state too, so a
        # test that loads one leaves every later test looking at a provider
        # that already has an event.
        "sgg_bracket_cache": dict(StartGGProvider._bracket_cache),
        "sgg_event_slug": StartGGProvider._event_slug,
        "sgg_event_url": StartGGProvider._event_url,
        "sgg_tournament_data": StartGGProvider._tournament_data,
    }

    # Clean baseline for the test.
    State.state = {}
    State.last_state = {}
    State.changed_keys = []
    # Fresh queue per test so a coroutine enqueued under one test's event loop
    # never gets awaited under another's ("attached to a different loop").
    State.queue = asyncio.Queue()
    # The write-path hooks are class-level too: a consumer registered in one
    # test would otherwise run inside every later test's writes.
    State.hooks = []
    State.unset_hooks = []
    # Same loop-binding hazard as the queue: an Event/Lock binds on first await.
    State._persist_dirty = None
    State._save_lock = None
    Automations.reset()

    Provider._prev_player_sides = {}
    Provider._prev_inning = None
    Provider._prev_game_id = None
    Provider._sides_swapped = False
    Provider._user_overridden = False
    Provider._feed_released = False
    Provider._hud_targets = []
    Provider.hud_watcher = None
    # Sticky across games by design (it drives the next frame's mode retry), so
    # a test that leaves it raised makes the next one retry a mode it never set.
    Provider._game_mode_unresolved = False
    # asyncio.Lock binds to the loop it first awaits under — each test gets a
    # fresh event loop, so drop any lock created under a previous test's loop.
    Provider._update_lock = None
    PostGame._capture_lock = None

    StatsTracker._slots = {}
    PoolManager._rotations = {}
    Match._credited_games = {}
    GameEndWatcher._pending = set()
    GameEndWatcher._done = set()
    StatFileWatcher._done = set()
    Announcements._active = []
    Participants.participants = {}
    OngoingGamePool.games = {}
    OngoingGamePool._follow_misses = {}
    OngoingGamePool._ended_follow = {}
    CompletedGamePool.games = {}
    PostGame._captured = {}
    PostGame._stat_objs = {}
    PostGame._contacts = {}
    StartGGProvider._bracket_cache = {}
    StartGGProvider._event_slug = None
    StartGGProvider._event_url = None
    StartGGProvider._tournament_data = None
    # Same loop-binding hazard as the two locks above.
    StartGGProvider._load_lock = None

    yield

    Automations.reset()
    State.hooks = []
    State.unset_hooks = []
    State.state = saved["state"]
    State.last_state = saved["last_state"]
    State.changed_keys = saved["changed_keys"]
    Settings.settings = saved["settings"]
    Provider._prev_player_sides = saved["prev_sides"]
    Provider._prev_inning = saved["prev_inning"]
    Provider._prev_game_id = saved["prev_game_id"]
    Provider._sides_swapped = saved["sides_swapped"]
    Provider._user_overridden = saved["user_overridden"]
    Provider._feed_released = saved["feed_released"]
    Provider._hud_targets = saved["hud_targets"]
    Provider.hud_watcher = saved["hud_watcher"]
    Provider._update_lock = None
    PostGame._capture_lock = None
    StatsTracker._slots = saved["stats_slots"]
    PoolManager._rotations = saved["rotations"]
    Match._credited_games = saved["credited_games"]
    GameEndWatcher._pending = saved["gameend_pending"]
    GameEndWatcher._done = saved["gameend_done"]
    StatFileWatcher._done = saved["autocapture_done"]
    Announcements._active = saved["announcements_active"]
    Participants.participants = saved["participants"]
    OngoingGamePool.games = saved["ongoing_games"]
    OngoingGamePool._follow_misses = saved["ongoing_follow_misses"]
    OngoingGamePool._ended_follow = saved["ongoing_ended_follow"]
    CompletedGamePool.games = saved["completed_games"]
    PostGame._captured = saved["pg_captured"]
    PostGame._stat_objs = saved["pg_stat_objs"]
    PostGame._contacts = saved["pg_contacts"]
    StartGGProvider._bracket_cache = saved["sgg_bracket_cache"]
    StartGGProvider._event_slug = saved["sgg_event_slug"]
    StartGGProvider._event_url = saved["sgg_event_url"]
    StartGGProvider._tournament_data = saved["sgg_tournament_data"]


@pytest.fixture
def rig():
    """Put boards in the rig for a test (`rig(1, 2, 3)`).

    The default rig is one board, and the bind routes 404 a board that is not in
    it (`require_board`) — a board id off a request must not write
    `score.{N}.match` for a board no layout reads and no rack row lists. A test
    exercising a two- or three-board rig has to actually have one.
    """
    from server.settings import Settings
    from server.utils.deep_dict import deep_set

    def _rig(*ids):
        deep_set(Settings.settings, "scoreboards.active", [int(i) for i in ids])
        Settings.revision += 1

    return _rig


@pytest.fixture
def set_setting():
    """Set a dotted settings key for the duration of a test (auto-restored)."""
    from server.settings import Settings
    from server.utils.deep_dict import deep_set

    def _set(key, value):
        deep_set(Settings.settings, key, value)
        # Settings.Set bumps this on every write; consumers that cache a
        # normalized subtree against it would otherwise never see a
        # fixture-written setting.
        Settings.revision += 1

    return _set

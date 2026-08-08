"""Game-mode resolution must never hold the live scoreboard off air.

`_apply_hud_game_mode` runs inside the HUD frame handler, BEFORE the frame is
parsed and written to state, and under the provider lock — so anything it waits
on delays the board itself and queues every frame behind it. Two things used to
make that wait unbounded:

  * the startup `force=True` refresh held the game-modes lock across pyrio's
    completer-cache rebuild (~42s cold), which nothing waiting on `_game_modes`
    needs; and
  * pyrio builds its requests session with no HTTP timeout, so an unreachable
    Project Rio is an indefinite wait rather than a failed one.
"""
import asyncio

import pytest

from server.rio import stats_api


@pytest.fixture(autouse=True)
def _reset_module_cache(monkeypatch):
    monkeypatch.setattr(stats_api, "_game_modes", {}, raising=False)
    monkeypatch.setattr(stats_api, "_game_modes_lock", None, raising=False)
    monkeypatch.setattr(stats_api, "_cache_refresh_lock", None, raising=False)
    yield


class _Client:
    """Stand-in for pyrio's RioWeb: a fast mode list, a slow cache refresh."""

    def __init__(self, refresh_delay=0.0, list_delay=0.0):
        self.refresh_delay = refresh_delay
        self.list_delay = list_delay
        self.refreshed = 0
        self.cache = self

    def refresh_cache(self):
        import time
        time.sleep(self.refresh_delay)
        self.refreshed += 1

    def list_game_modes(self, active=False):
        import time
        time.sleep(self.list_delay)
        return {"Tag Sets": [{"name": "Ranked", "id": 7}]}


async def test_the_slow_cache_refresh_no_longer_gates_the_mode_list():
    """The startup refresh is ~20x slower than the call that fills _game_modes.
    A concurrent resolve must wait for the mode list only."""
    client = _Client(refresh_delay=0.6, list_delay=0.0)
    stats_api._get_client = lambda: client

    startup = asyncio.create_task(stats_api.fetch_game_modes(force=True))
    await asyncio.sleep(0)  # let it reach the lock

    loop = asyncio.get_running_loop()
    began = loop.time()
    name = await stats_api.resolve_tag_set_name(7, timeout=stats_api.LIVE_RESOLVE_TIMEOUT)
    waited = loop.time() - began

    assert name == "Ranked"
    # Regression: this waited out the whole refresh (0.6s here, ~42s in life).
    assert waited < 0.3, f"live resolve waited {waited:.2f}s on the cache refresh"

    await startup
    assert client.refreshed == 1, "the completer cache must still be refreshed"


async def test_a_concurrent_fetch_is_not_serialised_behind_the_cache_refresh():
    """The lock-scope fix, stated without the new `timeout` argument.

    Deliberately uses only the original call surface, so it fails on the old
    code for the BEHAVIOUR (waiting out the refresh) rather than for a changed
    signature — which is the claim that actually matters.
    """
    client = _Client(refresh_delay=0.6, list_delay=0.0)
    stats_api._get_client = lambda: client

    startup = asyncio.create_task(stats_api.fetch_game_modes(force=True))
    await asyncio.sleep(0)

    loop = asyncio.get_running_loop()
    began = loop.time()
    modes = await stats_api.fetch_game_modes()      # no force, no timeout
    waited = loop.time() - began

    assert modes == {"Ranked": 7}
    assert waited < 0.3, f"waited {waited:.2f}s behind the completer-cache refresh"
    await startup


async def test_an_unreachable_api_gives_up_instead_of_holding_the_board():
    """pyrio has no HTTP timeout, so without a budget this never returns and the
    scoreboard never comes up."""
    import threading

    # A real blocking call (to_thread can't be cancelled), released explicitly so
    # the suite doesn't pay for the hang it is simulating.
    released = threading.Event()

    class _Hanging(_Client):
        def list_game_modes(self, active=False):
            released.wait(30)
            return {"Tag Sets": []}

    stats_api._get_client = lambda: _Hanging()

    loop = asyncio.get_running_loop()
    began = loop.time()
    try:
        name = await stats_api.resolve_tag_set_name(7, timeout=0.1)
        waited = loop.time() - began
    finally:
        released.set()

    assert name == ""          # '' already means "leave the tag alone"
    assert waited < 1.0, f"live resolve blocked for {waited:.2f}s on a dead API"


async def test_a_timed_out_resolve_leaves_the_fetch_running_for_the_next_frame():
    """shield, not cancel: the next HUD frame should find the cache warm rather
    than restarting the same round-trip."""
    client = _Client(list_delay=0.3)
    stats_api._get_client = lambda: client

    assert await stats_api.resolve_tag_set_name(7, timeout=0.05) == ""
    await asyncio.sleep(0.5)                       # the shielded fetch finishes
    assert stats_api._game_modes == {"Ranked": 7}
    assert await stats_api.resolve_tag_set_name(7, timeout=0.05) == "Ranked"


async def test_no_timeout_keeps_the_original_blocking_behaviour():
    # Background callers (the pools, the Settings refresh) still wait properly.
    stats_api._get_client = lambda: _Client(list_delay=0.05)
    assert await stats_api.resolve_tag_set_name(7) == "Ranked"


async def test_an_unknown_tag_set_still_resolves_to_empty():
    stats_api._get_client = lambda: _Client()
    assert await stats_api.resolve_tag_set_name(999, timeout=1.0) == ""
    assert await stats_api.resolve_tag_set_name(None, timeout=1.0) == ""
    assert await stats_api.resolve_tag_set_name(-1, timeout=1.0) == ""


# --- the retry that keeps a cold start from costing the whole game its tag ---

async def test_a_cold_start_frame_retries_the_mode_on_the_next_frame(monkeypatch):
    """Giving up inside the budget must not mean giving up on the game.

    `_apply_hud_game_mode` only runs on a NEW game, so a cold-start timeout used
    to leave stats_tag unset for the entire game — the log line for that is
    "no game mode configured; skipping API stats fetch".
    """
    from server.rio.provider import RioGameDataProvider as P
    from server.settings import Settings

    monkeypatch.setattr(P, "_hud_targets", [1])
    monkeypatch.setattr(P, "_game_mode_unresolved", False)

    # Frame 1: modes not loaded yet, resolve times out.
    async def slow(_id, timeout=None):
        return ""
    monkeypatch.setattr(stats_api, "resolve_tag_set_name", slow)
    monkeypatch.setattr(stats_api, "modes_ready", lambda: False)

    await P._apply_hud_game_mode({"tag_set": 7})
    assert P._game_mode_unresolved is True
    assert Settings.Get("scoreboards.binding.1.stats_tag", None) is None

    # Frame 2: the modes have arrived; the retry resolves and writes the tag.
    async def fast(_id, timeout=None):
        return "Ranked"
    monkeypatch.setattr(stats_api, "resolve_tag_set_name", fast)
    monkeypatch.setattr(stats_api, "modes_ready", lambda: True)

    await P._apply_hud_game_mode({"tag_set": 7})
    assert P._game_mode_unresolved is False
    assert Settings.Get("scoreboards.binding.1.stats_tag") == "Ranked"


async def test_a_genuinely_unknown_mode_stops_retrying(monkeypatch):
    from server.rio.provider import RioGameDataProvider as P

    monkeypatch.setattr(P, "_hud_targets", [1])
    monkeypatch.setattr(P, "_game_mode_unresolved", True)

    async def unknown(_id, timeout=None):
        return ""
    monkeypatch.setattr(stats_api, "resolve_tag_set_name", unknown)
    monkeypatch.setattr(stats_api, "modes_ready", lambda: True)   # we DID look

    await P._apply_hud_game_mode({"tag_set": 999})
    assert P._game_mode_unresolved is False, "an unknown mode must settle, not spin"


# --- launch-time ordering -------------------------------------------------

async def test_prime_caches_publishes_modes_before_the_slow_rebuild(monkeypatch):
    """The mode list must be available long before the completer-cache rebuild,
    because a HUD frame waits on the first and nothing live reads the second."""
    order = []

    async def fake_fetch(force=False):
        order.append("modes")
        stats_api._game_modes = {"Ranked": 7}
        return stats_api._game_modes

    async def fake_refresh():
        order.append("refresh")

    monkeypatch.setattr(stats_api, "fetch_game_modes", fake_fetch)
    monkeypatch.setattr(stats_api, "refresh_completer_cache", fake_refresh)
    monkeypatch.setattr(stats_api, "STARTUP_CACHE_REFRESH_DELAY", 0.05)

    task = asyncio.create_task(stats_api.prime_caches())
    await asyncio.sleep(0.01)
    # Modes are up while the rebuild is still waiting out its delay.
    assert order == ["modes"]
    assert stats_api.modes_ready()

    await task
    assert order == ["modes", "refresh"]


async def test_the_completer_refresh_still_happens(monkeypatch):
    # Deferred, not dropped — the stale-cache.pkl problem it exists for is real.
    client = _Client(refresh_delay=0.0)
    stats_api._get_client = lambda: client
    monkeypatch.setattr(stats_api, "STARTUP_CACHE_REFRESH_DELAY", 0.01)
    await stats_api.prime_caches()
    assert client.refreshed == 1

"""PoolManager resume-on-startup gate.

Renamed from RotationManager as part of the pool+playback unification (see
~/.claude/plans/pool-playback-unification.md). A running rotation is now
`scoreboards.binding.{N}.playback.mode == "rotate"` with a non-empty pool
(filters or pinned games) — resume no longer reads the legacy `sources`/
`rotation.{N}.enabled` shape. `_resume_rotations` (which would hit the API) is
mocked — we only assert which scoreboards the gate selects.
"""
import asyncio
from unittest.mock import AsyncMock

from server.rio.rotation import PoolManager
from server.settings import Settings


def _configure(set_setting, active, binding):
    set_setting("scoreboards.active", active)
    set_setting("scoreboards.binding", binding)


async def test_resumes_rotating_boards_with_a_populated_pool(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(PoolManager, "_resume_rotations", resume)
    # Board 1 defaults to HUD transport (project_rio.hud_enabled defaults
    # True) — disable it here so board 1's rotate binding is actually
    # eligible; the HUD-vs-rotate interaction has its own dedicated test.
    set_setting("project_rio.hud_enabled", False)
    _configure(
        set_setting,
        active=[1, 2, 3],
        binding={
            "1": {"playback": {"mode": "rotate", "running": True}, "pool": {"filters": [{"id": 1, "tag": ["Ranked"]}]}},
            "2": {"playback": {"mode": "rotate", "running": True}, "pool": {"pinned": [30]}},  # pinned-only also qualifies
            "3": {"playback": {"mode": "single"}, "pool": {"filters": [{"id": 1, "tag": ["Ranked"]}]}},  # not rotating
        },
    )
    await PoolManager.Start()
    await asyncio.sleep(0)  # let the scheduled resume task settle

    resume.assert_called_once()
    assert set(resume.call_args.args[0]) == {1, 2}


async def test_paused_rotator_not_resumed(monkeypatch, set_setting):
    """A board left in rotate mode but with `running` cleared (a user Stop)
    stays paused across a restart — it does not auto-resume."""
    resume = AsyncMock()
    monkeypatch.setattr(PoolManager, "_resume_rotations", resume)
    set_setting("project_rio.hud_enabled", False)
    _configure(
        set_setting,
        active=[1],
        binding={
            "1": {"playback": {"mode": "rotate", "running": False},
                  "pool": {"filters": [{"id": 1, "tag": ["Ranked"]}]}},
        },
    )
    await PoolManager.Start()
    resume.assert_not_called()


async def test_rotating_but_empty_pool_not_resumed(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(PoolManager, "_resume_rotations", resume)
    _configure(
        set_setting,
        active=[1],
        binding={"1": {"playback": {"mode": "rotate"}, "pool": {"filters": [], "pinned": []}}},
    )
    await PoolManager.Start()
    resume.assert_not_called()


async def test_inactive_scoreboard_not_resumed(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(PoolManager, "_resume_rotations", resume)
    _configure(
        set_setting,
        active=[1],
        binding={
            "1": {"playback": {"mode": "single"}},
            "2": {"playback": {"mode": "rotate"}, "pool": {"pinned": [99]}},  # sb 2 not active
        },
    )
    await PoolManager.Start()
    resume.assert_not_called()


async def test_hud_board_never_resumed_even_if_marked_rotating(monkeypatch, set_setting):
    """Board 1 with HUD on is always HUD transport regardless of its stored
    playback.mode — a stray "rotate" from before HUD was (re)enabled must not
    fight the HUD writer for score.1.*."""
    resume = AsyncMock()
    monkeypatch.setattr(PoolManager, "_resume_rotations", resume)
    set_setting("project_rio.hud_enabled", True)
    _configure(
        set_setting,
        active=[1],
        binding={"1": {"playback": {"mode": "rotate"}, "pool": {"pinned": [1]}}},
    )
    await PoolManager.Start()
    resume.assert_not_called()

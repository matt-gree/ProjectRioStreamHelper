"""RotationManager resume-on-startup gate.

A rotation only resumes if its scoreboard is still active, its source is still
'rotator', it's enabled, and it has game_ids. _resume_rotations (which would hit
the API) is mocked — we only assert which rotations the gate selects.
"""
import asyncio
from unittest.mock import AsyncMock

from server.rio.rotation import RotationManager
from server.settings import Settings


def _configure(set_setting, active, sources, rotation):
    set_setting("scoreboards.active", active)
    set_setting("scoreboards.sources", sources)
    set_setting("scoreboards.rotation", rotation)


async def test_resumes_only_qualifying_rotations(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(RotationManager, "_resume_rotations", resume)
    _configure(
        set_setting,
        active=[1, 2, 3],
        sources={
            "1": {"type": "rotator"},
            "2": {"type": "hud"},       # wrong source → skip
            "3": {"type": "rotator"},
        },
        rotation={
            "1": {"enabled": True, "game_ids": [10, 20]},  # qualifies
            "2": {"enabled": True, "game_ids": [30]},       # source not rotator
            "3": {"enabled": False, "game_ids": [40]},      # disabled
        },
    )
    await RotationManager.Start()
    await asyncio.sleep(0)  # let the scheduled resume task settle

    resume.assert_called_once()
    to_resume = resume.call_args.args[0]
    assert set(to_resume.keys()) == {1}


async def test_clears_stale_enabled_flag_when_source_no_longer_rotator(monkeypatch, set_setting):
    monkeypatch.setattr(RotationManager, "_resume_rotations", AsyncMock())
    _configure(
        set_setting,
        active=[1],
        sources={"1": {"type": "hud"}},
        rotation={"1": {"enabled": True, "game_ids": [1]}},
    )
    await RotationManager.Start()
    # The stale enabled flag is turned off so it isn't reconsidered next launch.
    assert Settings.Get("scoreboards.rotation.1.enabled") is False


async def test_enabled_but_empty_game_ids_not_resumed(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(RotationManager, "_resume_rotations", resume)
    _configure(
        set_setting,
        active=[1],
        sources={"1": {"type": "rotator"}},
        rotation={"1": {"enabled": True, "game_ids": []}},
    )
    await RotationManager.Start()
    resume.assert_not_called()


async def test_inactive_scoreboard_not_resumed(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(RotationManager, "_resume_rotations", resume)
    _configure(
        set_setting,
        active=[1],
        sources={"1": {"type": "rotator"}, "2": {"type": "rotator"}},
        rotation={"2": {"enabled": True, "game_ids": [99]}},  # sb 2 not active
    )
    await RotationManager.Start()
    resume.assert_not_called()

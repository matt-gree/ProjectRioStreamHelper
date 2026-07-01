"""RotationManager resume-on-startup gate.

Since the rotator was pulled out of the source enum (a rotation is now a
per-board game FEED, orthogonal to the board's source type), the resume gate
is: scoreboard still active + the feed's own ``enabled`` flag + non-empty
``game_ids``. Startup also migrates any board still typed with the legacy
``rotator`` source to ``manual`` (its feed survives via the enabled flag).
_resume_rotations (which would hit the API) is mocked — we only assert which
rotations the gate selects.
"""
import asyncio
from unittest.mock import AsyncMock

from server.rio.rotation import RotationManager
from server.settings import Settings


def _configure(set_setting, active, sources, rotation):
    set_setting("scoreboards.active", active)
    set_setting("scoreboards.sources", sources)
    set_setting("scoreboards.rotation", rotation)


async def test_resumes_qualifying_feeds_regardless_of_source(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(RotationManager, "_resume_rotations", resume)
    _configure(
        set_setting,
        active=[1, 2, 3],
        sources={
            "1": {"type": "manual"},
            "2": {"type": "hud"},       # source type no longer gates the feed
            "3": {"type": "manual"},
        },
        rotation={
            "1": {"enabled": True, "game_ids": [10, 20]},  # qualifies
            "2": {"enabled": True, "game_ids": [30]},       # qualifies too
            "3": {"enabled": False, "game_ids": [40]},      # disabled
        },
    )
    await RotationManager.Start()
    await asyncio.sleep(0)  # let the scheduled resume task settle

    resume.assert_called_once()
    to_resume = resume.call_args.args[0]
    assert set(to_resume.keys()) == {1, 2}


async def test_legacy_rotator_source_migrates_to_manual(monkeypatch, set_setting):
    monkeypatch.setattr(RotationManager, "_resume_rotations", AsyncMock())
    _configure(
        set_setting,
        active=[1],
        sources={"1": {"type": "rotator"}},
        rotation={"1": {"enabled": True, "game_ids": [1]}},
    )
    await RotationManager.Start()
    # The legacy source type is rewritten; the feed itself stays enabled.
    assert Settings.Get("scoreboards.sources.1.type") == "manual"
    assert Settings.Get("scoreboards.rotation.1.enabled") is True


async def test_enabled_but_empty_game_ids_not_resumed(monkeypatch, set_setting):
    resume = AsyncMock()
    monkeypatch.setattr(RotationManager, "_resume_rotations", resume)
    _configure(
        set_setting,
        active=[1],
        sources={"1": {"type": "manual"}},
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
        sources={"1": {"type": "manual"}, "2": {"type": "manual"}},
        rotation={"2": {"enabled": True, "game_ids": [99]}},  # sb 2 not active
    )
    await RotationManager.Start()
    resume.assert_not_called()

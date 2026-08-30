"""Post-game endpoints (Phase 6) — capture a finished game's box score from the
Project Rio stat file and project it onto a scoreboard.

Plain @router (like match.py / commentary.py): the projected ``postgame.{N}.*``
fields live in the State store and reach clients through the state broadcast. Only
the heavy per-event ``Events`` array is served directly from here (it is kept out
of State on purpose — see server/postgame.py).

Capture is a **manual producer action** (no auto game-end detection yet). The
default path matches the stat file by ``score.{N}.game_id`` + the
``Loaded from HUD == 0`` gate; ``GET /postgame/files`` lists recent usable files
and ``POST /postgame/capture?file=`` captures one of them, skipping the game-id
match — the escape hatch for a game the automatic match cannot find.
"""
import asyncio

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from server import postgame_files
from server.postgame import PostGame

router = APIRouter(prefix="/postgame", tags=["postgame"])


@router.post("/capture", response_class=ORJSONResponse)
async def capture(scoreboard: int, file: str | None = None):
    """Capture the finished game for ``scoreboard`` from its stat file.

    With no ``file``, matches by ``score.{N}.game_id``. Pass a filename from
    ``GET /postgame/files`` to override that match — the producer's escape hatch
    for a game the automatic match cannot find. Untrusted input; the path is
    resolved inside the stat directory by ``postgame_files.resolve_pick``.

    Returns ``{success, ...}``; ``success=False`` carries a ``reason`` (no usable
    stat file, GameID mismatch, or a HUD-replay file) without erroring.
    """
    return await PostGame.capture(scoreboard, file=file)


@router.get("", response_class=ORJSONResponse)
async def get_postgame(scoreboard: int):
    """The full captured payload for a board, including the ``events`` array, or
    ``{present: False}`` when nothing has been captured."""
    payload = PostGame.get_payload(scoreboard)
    return payload or {"present": False, "scoreboard": scoreboard}


@router.get("/abs", response_class=ORJSONResponse)
async def character_abs(scoreboard: int, team: int, char_index: int):
    """Per-AB walkthrough payload for one captured-game roster character
    (Character Spotlight): every resolved plate appearance with before/after
    situation, runner movements, and the re-simulated flight path for balls in
    play. Heavy (full trajectories) — served REST-only, never through State.

    The first call per capture runs the hit simulator over every contact in the
    game, so it is pushed off the event loop."""
    return await asyncio.to_thread(PostGame.character_abs, scoreboard, team, char_index)


@router.get("/files", response_class=ORJSONResponse)
async def list_files(limit: int = 25):
    """Recent usable (non-HUD-replay) stat files, newest first, for a manual pick."""
    return {"files": postgame_files.list_files(limit=limit)}


@router.post("/clear", response_class=ORJSONResponse)
async def clear(scoreboard: int):
    """Blank a board's captured post-game box score."""
    await PostGame.clear(scoreboard)
    return {"success": True, "scoreboard": scoreboard}

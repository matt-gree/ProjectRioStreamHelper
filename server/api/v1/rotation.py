from typing import Any

from pydantic import BaseModel

from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.rio.rotation import PoolManager

router = APIRouter()


class PoolUpdatePayload(BaseModel):
    """Partial update to a scoreboard's pool config. Any field omitted is
    left unchanged (merged against the current config, not replaced)."""
    filters: list[dict[str, Any]] | None = None
    scope: str | None = None
    pinned: list[int] | None = None
    excluded: list[int] | None = None
    refresh_interval: float | None = None


class PlaybackUpdatePayload(BaseModel):
    """Partial update to a scoreboard's playback config."""
    mode: str | None = None
    gameId: int | None = None
    interval: float | None = None


class PinPayload(BaseModel):
    game_id: int
    game: dict[str, Any] | None = None


class GameIdPayload(BaseModel):
    game_id: int


@method(
    router.get, "/rotation/{sb_id}",
    version="1", id="rotation.get",
    response_class=ORJSONResponse
)
async def get_rotation(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Get pool + playback config and live status for a scoreboard."""
    config = await PoolManager.get_config(sb_id)
    status = PoolManager.get_status(sb_id)
    return ORJSONResponse({**config, **status})


@method(
    router.put, "/rotation/{sb_id}/pool",
    version="1", id="rotation.set_pool",
    response_class=ORJSONResponse
)
async def set_pool(
    sb_id: int,
    payload: PoolUpdatePayload,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Update a scoreboard's pool config (filters/scope/pinned/excluded/
    refresh_interval). If a rotation is running, triggers an immediate
    recompute instead of waiting for the next scheduled tick."""
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return ORJSONResponse({"success": True, **await PoolManager.get_config(sb_id)})
    await PoolManager.set_pool(sb_id, updates)
    return ORJSONResponse({"success": True, **await PoolManager.get_config(sb_id)})


@method(
    router.put, "/rotation/{sb_id}/playback",
    version="1", id="rotation.set_playback",
    response_class=ORJSONResponse
)
async def set_playback(
    sb_id: int,
    payload: PlaybackUpdatePayload,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Update a scoreboard's playback config (mode/gameId/interval)."""
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return ORJSONResponse({"success": True, **await PoolManager.get_config(sb_id)})
    await PoolManager.set_playback(sb_id, updates)
    return ORJSONResponse({"success": True, **await PoolManager.get_config(sb_id)})


@method(
    router.post, "/rotation/{sb_id}/pin",
    version="1", id="rotation.pin",
    response_class=ORJSONResponse
)
async def pin_game(sb_id: int, payload: PinPayload, session_id: str | None = None) -> ORJSONResponse:
    """Add a game to the pool's pinned list (always-included regardless of
    filter) — the "Find a game" search/pin flow, since game IDs aren't
    human-readable."""
    await PoolManager.pin_game(sb_id, payload.game_id, payload.game)
    return ORJSONResponse({"success": True})


@method(
    router.post, "/rotation/{sb_id}/unpin",
    version="1", id="rotation.unpin",
    response_class=ORJSONResponse
)
async def unpin_game(sb_id: int, payload: GameIdPayload, session_id: str | None = None) -> ORJSONResponse:
    await PoolManager.unpin_game(sb_id, payload.game_id)
    return ORJSONResponse({"success": True})


@method(
    router.post, "/rotation/{sb_id}/exclude",
    version="1", id="rotation.exclude",
    response_class=ORJSONResponse
)
async def exclude_game(sb_id: int, payload: GameIdPayload, session_id: str | None = None) -> ORJSONResponse:
    """Exclude a game even if it matches a filter — the visible, persisted
    replacement for the old hidden deselected-ids ref."""
    await PoolManager.exclude_game(sb_id, payload.game_id)
    return ORJSONResponse({"success": True})


@method(
    router.post, "/rotation/{sb_id}/unexclude",
    version="1", id="rotation.unexclude",
    response_class=ORJSONResponse
)
async def unexclude_game(sb_id: int, payload: GameIdPayload, session_id: str | None = None) -> ORJSONResponse:
    await PoolManager.unexclude_game(sb_id, payload.game_id)
    return ORJSONResponse({"success": True})


@method(
    router.post, "/rotation/{sb_id}/start",
    version="1", id="rotation.start",
    response_class=ORJSONResponse
)
async def start_rotation(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Start rotating a scoreboard's pool (playback.mode -> "rotate")."""
    # A HUD-transport board (board 1 with hud_enabled) has the local game as its
    # exclusive writer — refuse to start a rotation there so it can't fight the
    # HUD writer for the same score keys. Any other board can rotate.
    from server.bindings import transport
    if transport(sb_id) == "hud":
        raise HTTPException(
            status_code=409,
            detail=f"scoreboard {sb_id} is HUD-bound; cannot start a rotation",
        )
    await PoolManager.start_rotation(sb_id)
    return ORJSONResponse({"success": True, **PoolManager.get_status(sb_id)})


@method(
    router.post, "/rotation/{sb_id}/stop",
    version="1", id="rotation.stop",
    response_class=ORJSONResponse
)
async def stop_rotation(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Stop rotation for a scoreboard (playback.mode -> "single")."""
    await PoolManager.stop_rotation(sb_id)
    return ORJSONResponse({"success": True})


@method(
    router.post, "/rotation/{sb_id}/next",
    version="1", id="rotation.next",
    response_class=ORJSONResponse
)
async def next_game(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Advance to the next game in the pool."""
    await PoolManager.next_game(sb_id)
    return ORJSONResponse({"success": True, **PoolManager.get_status(sb_id)})


@method(
    router.post, "/rotation/{sb_id}/prev",
    version="1", id="rotation.prev",
    response_class=ORJSONResponse
)
async def prev_game(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Go to the previous game in the pool."""
    await PoolManager.prev_game(sb_id)
    return ORJSONResponse({"success": True, **PoolManager.get_status(sb_id)})

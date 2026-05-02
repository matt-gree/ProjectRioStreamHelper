import json

from typing import Any

from pydantic import BaseModel

from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.rio.rotation import RotationManager
from server.settings import Settings


class RotationGamesPayload(BaseModel):
    """Body for POST /rotation/{sb_id}/games — full snapshot of the
    rotation's pool. `games` are the completed-game dicts from the modal
    search results (ongoing games are resolved live from OngoingGamePool
    and are not persisted). `game_ids` is the user's selected order, which
    may include both completed and ongoing ids.
    """
    games: list[dict[str, Any]] = []
    game_ids: list[int] = []

router = APIRouter()


@method(
    router.get, "/rotation/{sb_id}",
    version="1", id="rotation.get",
    response_class=ORJSONResponse
)
async def get_rotation(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Get rotation config and status for a scoreboard."""
    config = await RotationManager.get_config(sb_id)
    status = RotationManager.get_status(sb_id)
    return ORJSONResponse({**config, **status})


@method(
    router.put, "/rotation/{sb_id}",
    version="1", id="rotation.set",
    response_class=ORJSONResponse
)
async def set_rotation(
    sb_id: int,
    enabled: bool | None = None,
    interval: float | None = None,
    game_ids: str | None = None,
    poll_interval: float | None = None,
    source_pool: str | None = None,
    filters: str | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Update rotation config for a scoreboard.

    `filters` is a JSON-encoded dict of completed-games filters
    (tag, username, vs_username, limit_games, etc.) — persisted on the
    rotation so each scoreboard's rotator can fetch its own slice of games
    independently.
    """
    config = {}
    if enabled is not None:
        config["enabled"] = enabled
    if interval is not None:
        config["interval"] = interval
    if game_ids is not None:
        # Accept comma-separated game IDs
        config["game_ids"] = [int(gid.strip()) for gid in game_ids.split(",") if gid.strip()]
    if poll_interval is not None:
        config["poll_interval"] = poll_interval
    if source_pool is not None:
        config["source_pool"] = source_pool
    if filters is not None:
        try:
            parsed = json.loads(filters) if filters else {}
            if not isinstance(parsed, dict):
                raise ValueError("filters must be a JSON object")
            config["filters"] = parsed
        except (json.JSONDecodeError, ValueError) as e:
            raise HTTPException(status_code=400, detail=f"invalid filters: {e}")

    await RotationManager.set_config(sb_id, config)
    return ORJSONResponse({"success": True, **await RotationManager.get_config(sb_id)})


@method(
    router.post, "/rotation/{sb_id}/games",
    version="1", id="rotation.set_games",
    response_class=ORJSONResponse
)
async def set_rotation_games(
    sb_id: int,
    payload: RotationGamesPayload,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Set the rotation's persisted game pool (cached_games + game_ids).

    This is the source of truth the rotator reads from. Filters seed the
    poll's auto-discovery of new matches but never replace this snapshot.
    Frontend calls this before /start so resume works across restart.
    """
    await RotationManager.set_config(sb_id, {
        "cached_games": payload.games,
        "game_ids": payload.game_ids,
        # Reset index whenever the pool changes wholesale
        "current_index": 0,
    })
    return ORJSONResponse({
        "success": True,
        "count": len(payload.game_ids),
        "cached": len(payload.games),
    })


@method(
    router.post, "/rotation/{sb_id}/start",
    version="1", id="rotation.start",
    response_class=ORJSONResponse
)
async def start_rotation(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Start rotation for a scoreboard."""
    # Refuse to start a rotation on a scoreboard whose source isn't "rotator".
    # _apply_current self-cancels, but writing enabled=True first leaves a stale
    # flag that resume-on-startup has to clean up; rejecting here is symmetric
    # with the assign_game guard and avoids the round-trip.
    source_type = Settings.Get(f"scoreboards.sources.{sb_id}.type")
    if source_type != "rotator":
        raise HTTPException(
            status_code=409,
            detail=f"scoreboard {sb_id} source is {source_type!r}, not 'rotator'",
        )
    await RotationManager.start_rotation(sb_id)
    return ORJSONResponse({"success": True, **RotationManager.get_status(sb_id)})


@method(
    router.post, "/rotation/{sb_id}/stop",
    version="1", id="rotation.stop",
    response_class=ORJSONResponse
)
async def stop_rotation(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Stop rotation for a scoreboard."""
    await RotationManager.stop_rotation(sb_id)
    return ORJSONResponse({"success": True})


@method(
    router.post, "/rotation/{sb_id}/next",
    version="1", id="rotation.next",
    response_class=ORJSONResponse
)
async def next_game(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Advance to the next game in rotation."""
    await RotationManager.next_game(sb_id)
    return ORJSONResponse({"success": True, **RotationManager.get_status(sb_id)})


@method(
    router.post, "/rotation/{sb_id}/prev",
    version="1", id="rotation.prev",
    response_class=ORJSONResponse
)
async def prev_game(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Go to the previous game in rotation."""
    await RotationManager.prev_game(sb_id)
    return ORJSONResponse({"success": True, **RotationManager.get_status(sb_id)})

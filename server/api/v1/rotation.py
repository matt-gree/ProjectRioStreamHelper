from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.rio.rotation import RotationManager
from server.settings import Settings

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
    session_id: str | None = None,
) -> ORJSONResponse:
    """Update rotation config for a scoreboard."""
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

    await RotationManager.set_config(sb_id, config)
    return ORJSONResponse({"success": True, **await RotationManager.get_config(sb_id)})


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

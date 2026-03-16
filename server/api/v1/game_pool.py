from server.utils.router import method
from fastapi import APIRouter, Query
from fastapi.responses import ORJSONResponse
from server.rio.game_pool import OngoingGamePool, CompletedGamePool
from server.rio.stats_api import get_last_completed_fetch_info

router = APIRouter()


# --- Ongoing games ---

@method(
    router.get, "/game-pool/ongoing",
    version="1", id="game_pool.ongoing.list",
    response_class=ORJSONResponse
)
async def list_ongoing_games(session_id: str | None = None) -> ORJSONResponse:
    """List all ongoing games from the shared API pool."""
    return ORJSONResponse(OngoingGamePool.list_games())


@method(
    router.post, "/game-pool/ongoing/refresh",
    version="1", id="game_pool.ongoing.refresh",
    response_class=ORJSONResponse
)
async def refresh_ongoing_games(session_id: str | None = None) -> ORJSONResponse:
    """Force an immediate re-poll of ongoing games."""
    await OngoingGamePool._fetch_games()
    return ORJSONResponse({"success": True, "count": len(OngoingGamePool.games)})


# --- Completed games ---

@method(
    router.get, "/game-pool/completed",
    version="1", id="game_pool.completed.list",
    response_class=ORJSONResponse
)
async def list_completed_games(
    session_id: str | None = None,
) -> ORJSONResponse:
    """List completed games currently in the pool."""
    return ORJSONResponse(CompletedGamePool.list_games())


@method(
    router.post, "/game-pool/completed/refresh",
    version="1", id="game_pool.completed.refresh",
    response_class=ORJSONResponse
)
async def refresh_completed_games(
    tag: list[str] | None = Query(None),
    username: list[str] | None = Query(None),
    vs_username: list[str] | None = Query(None),
    exclude_username: list[str] | None = Query(None),
    start_time: int | None = None,
    end_time: int | None = None,
    stadium: int | None = None,
    limit_games: int | None = None,
    captain: str | None = None,
    vs_captain: str | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Fetch completed games from the API with optional filters."""
    filters = {}
    if tag:
        filters["tag"] = tag
    if username:
        filters["username"] = username
    if vs_username:
        filters["vs_username"] = vs_username
    if exclude_username:
        filters["exclude_username"] = exclude_username
    if start_time is not None:
        filters["start_time"] = start_time
    if end_time is not None:
        filters["end_time"] = end_time
    if stadium is not None:
        filters["stadium"] = stadium
    if limit_games is not None:
        filters["limit_games"] = limit_games
    if captain:
        filters["captain"] = captain
    if vs_captain:
        filters["vs_captain"] = vs_captain

    try:
        await CompletedGamePool.refresh(filters if filters else None)
    except Exception as e:
        from loguru import logger
        logger.exception("[game_pool] refresh_completed_games failed")
        diag = get_last_completed_fetch_info()
        diag["error"] = diag.get("error") or str(e)
        return ORJSONResponse({
            "success": False,
            "count": 0,
            "diagnostics": diag,
        })

    diag = get_last_completed_fetch_info()
    return ORJSONResponse({
        "success": True,
        "count": len(CompletedGamePool.games),
        "diagnostics": diag,
    })


@method(
    router.post, "/game-pool/completed/auto-poll",
    version="1", id="game_pool.completed.auto_poll",
    response_class=ORJSONResponse
)
async def set_completed_auto_poll(
    enabled: bool = False,
    interval: float | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Enable or disable auto-polling for completed games."""
    await CompletedGamePool.set_auto_poll(enabled, interval)
    return ORJSONResponse({
        "success": True,
        "auto_poll": enabled,
        "interval": interval or CompletedGamePool._poll_interval,
    })


# --- Assign (works for both ongoing and completed) ---

@method(
    router.post, "/game-pool/assign",
    version="1", id="game_pool.assign",
    response_class=ORJSONResponse
)
async def assign_game(
    game_id: int,
    scoreboard_number: int,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Assign a game (ongoing or completed) to a scoreboard."""
    # Try ongoing first, then completed
    if OngoingGamePool.get_game(game_id):
        success = await OngoingGamePool.apply_game_to_scoreboard(game_id, scoreboard_number)
    elif CompletedGamePool.get_game(game_id):
        success = await CompletedGamePool.apply_game_to_scoreboard(game_id, scoreboard_number)
    else:
        return ORJSONResponse({"success": False, "error": "Game not found in any pool"})

    return ORJSONResponse({"success": success})


# --- Backward compatibility: /game-pool still lists ongoing ---

@method(
    router.get, "/game-pool",
    version="1", id="game_pool.list",
    response_class=ORJSONResponse
)
async def list_games_compat(session_id: str | None = None) -> ORJSONResponse:
    """List ongoing games (backward compatibility)."""
    return ORJSONResponse(OngoingGamePool.list_games())

from server.utils.router import method
from fastapi import APIRouter, Request
from fastapi.responses import ORJSONResponse
from server.rio.stats_tracker import StatsTracker
from server.rio import stats_api

router = APIRouter()


@method(
    router.get, "/rio/stats",
    version="1", id="rio.stats",
    response_class=ORJSONResponse
)
async def rio_stats(session_id: str | None = None) -> ORJSONResponse:
    """Get all merged character stats for the active game."""
    return ORJSONResponse(StatsTracker.get_all_stats())


@method(
    router.get, "/rio/stats/character",
    version="1", id="rio.stats.character",
    response_class=ORJSONResponse
)
async def rio_stats_character(
    team: int = 1,
    roster_index: int = 0,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Get merged stats for a single character by team and roster index."""
    all_stats = StatsTracker.get_all_stats()
    team_key = f"team_{team}"
    team_data = all_stats.get(team_key, {})
    characters = team_data.get("characters", {})

    for char_name, char_data in characters.items():
        if char_data.get("roster_index") == roster_index:
            return ORJSONResponse({
                "name": char_name,
                "team": team,
                "roster_index": roster_index,
                **char_data,
            })

    return ORJSONResponse({"error": f"No character at team {team}, roster index {roster_index}"}, status_code=404)


@method(
    router.post, "/rio/stats/refresh",
    version="1", id="rio.stats.refresh",
    response_class=ORJSONResponse
)
async def rio_stats_refresh(session_id: str | None = None) -> ORJSONResponse:
    """Force re-fetch character stats from the Project Rio API."""
    await StatsTracker.refresh_api_stats()
    return ORJSONResponse({
        "success": True,
        "api_ready": StatsTracker._api_ready,
    })


@method(
    router.get, "/rio/stats/diagnostics",
    version="1", id="rio.stats.diagnostics",
    response_class=ORJSONResponse
)
async def rio_stats_diagnostics(session_id: str | None = None) -> ORJSONResponse:
    """Return diagnostic info about the last stats API fetch."""
    return ORJSONResponse(stats_api.get_last_fetch_info())


@method(
    router.get, "/rio/key/status",
    version="1", id="rio.key.status",
    response_class=ORJSONResponse
)
async def rio_key_status(session_id: str | None = None) -> ORJSONResponse:
    """Check whether a Rio API key is configured (never exposes the key)."""
    return ORJSONResponse({"configured": stats_api.load_rio_key() is not None})


@method(
    router.put, "/rio/key",
    version="1", id="rio.key.set",
    response_class=ORJSONResponse
)
async def rio_key_set(request: Request, session_id: str | None = None) -> ORJSONResponse:
    """Save a Rio API key to user_data/.env and reset the API client."""
    body = await request.json()
    key = body.get("key", "").strip()
    if not key:
        return ORJSONResponse({"error": "key is required"}, status_code=400)
    stats_api.save_rio_key(key)
    stats_api.reset_client()
    return ORJSONResponse({"success": True})


@method(
    router.get, "/rio/game-modes",
    version="1", id="rio.game_modes.get",
    response_class=ORJSONResponse
)
async def rio_game_modes(session_id: str | None = None) -> ORJSONResponse:
    """Get cached active game modes (name -> id)."""
    modes = await stats_api.fetch_game_modes()
    return ORJSONResponse(modes)


@method(
    router.post, "/rio/game-modes/refresh",
    version="1", id="rio.game_modes.refresh",
    response_class=ORJSONResponse
)
async def rio_game_modes_refresh(session_id: str | None = None) -> ORJSONResponse:
    """Force re-fetch active game modes from the Project Rio API."""
    modes = await stats_api.fetch_game_modes(force=True)
    return ORJSONResponse({"success": True, "count": len(modes), "modes": modes})

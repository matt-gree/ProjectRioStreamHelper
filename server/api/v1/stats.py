from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from server.rio.stats_tracker import StatsTracker
from server.rio import stats_api

router = APIRouter()


@method(
    router.post, "/rio/stats/refresh",
    version="1", id="rio.stats.refresh",
    response_class=ORJSONResponse
)
async def rio_stats_refresh(
    scoreboard: int | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Force re-fetch character stats from the Project Rio API.

    Args:
        scoreboard: If given, only fetch stats for players on that scoreboard.
    """
    await StatsTracker.refresh_api_stats(scoreboard_number=scoreboard)
    if scoreboard is not None:
        ready = {scoreboard: StatsTracker.is_api_ready(scoreboard)}
    else:
        from server.settings import Settings
        ready = {sb: StatsTracker.is_api_ready(sb)
                 for sb in Settings.Get("scoreboards.active", [1])}
    return ORJSONResponse({"success": True, "api_ready": ready})


@method(
    router.get, "/rio/stats/diagnostics",
    version="1", id="rio.stats.diagnostics",
    response_class=ORJSONResponse
)
async def rio_stats_diagnostics(
    scoreboard: int | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Return diagnostic info about the last stats API fetch for a scoreboard."""
    return ORJSONResponse(stats_api.get_last_fetch_info(scoreboard_number=scoreboard))


@method(
    router.get, "/rio/game-modes",
    version="1", id="rio.game_modes.get",
    response_class=ORJSONResponse
)
async def rio_game_modes(
    scope: str = "active", session_id: str | None = None
) -> ORJSONResponse:
    """Game modes as {name: id}.

    `scope=active` (the default, and what every existing caller gets) is the
    list a producer picks from TODAY. `scope=all` is the whole catalogue,
    ended seasons included — what a console picker needs to be able to SAY the
    mode a completed game was played in, and what the pool's mode filter needs
    to be able to search one. Same shape either way, so a caller that wants both
    tiers asks twice and takes the difference.
    """
    if scope == "all":
        return ORJSONResponse(await stats_api.fetch_all_game_modes())
    return ORJSONResponse(await stats_api.fetch_game_modes())


@method(
    router.post, "/rio/game-modes/refresh",
    version="1", id="rio.game_modes.refresh",
    response_class=ORJSONResponse
)
async def rio_game_modes_refresh(session_id: str | None = None) -> ORJSONResponse:
    """Force re-fetch active game modes from the Project Rio API."""
    modes = await stats_api.fetch_game_modes(force=True)
    return ORJSONResponse({"success": True, "count": len(modes), "modes": modes})

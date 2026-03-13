from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from server.rio.game_pool import RioGamePool

router = APIRouter()


@method(
    router.get, "/game-pool",
    version="1", id="game_pool.list",
    response_class=ORJSONResponse
)
async def list_games(session_id: str | None = None) -> ORJSONResponse:
    """List all ongoing games from the shared API pool."""
    return ORJSONResponse(RioGamePool.list_games())


@method(
    router.post, "/game-pool/refresh",
    version="1", id="game_pool.refresh",
    response_class=ORJSONResponse
)
async def refresh_games(session_id: str | None = None) -> ORJSONResponse:
    """Force an immediate re-poll of the API."""
    await RioGamePool._fetch_games()
    return ORJSONResponse({"success": True, "count": len(RioGamePool.games)})


@method(
    router.post, "/game-pool/assign",
    version="1", id="game_pool.assign",
    response_class=ORJSONResponse
)
async def assign_game(
    game_id: str,
    scoreboard_number: int,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Assign an API game to a scoreboard."""
    success = await RioGamePool.apply_game_to_scoreboard(game_id, scoreboard_number)
    if success:
        return ORJSONResponse({"success": True})
    return ORJSONResponse({"success": False, "error": "Game not found in pool"})

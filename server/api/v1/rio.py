from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from server.rio.provider import RioGameDataProvider

router = APIRouter()


@method(
    router.get, "/rio/game",
    version="1", id="rio.game",
    response_class=ORJSONResponse
)
async def rio_game(session_id: str | None = None) -> ORJSONResponse:
    """Get the current parsed game state from the HUD file."""
    return ORJSONResponse(RioGameDataProvider.current_game)


@method(
    router.post, "/rio/refresh",
    version="1", id="rio.refresh",
    response_class=ORJSONResponse
)
async def rio_refresh(session_id: str | None = None) -> ORJSONResponse:
    """Force a re-read of the HUD file and update state."""
    game = await RioGameDataProvider.FetchHUDGame()
    if game:
        return ORJSONResponse({"success": True, "game": game})
    return ORJSONResponse({"success": False, "error": "No HUD data available"})


@method(
    router.post, "/rio/swap",
    version="1", id="rio.swap",
    response_class=ORJSONResponse
)
async def rio_swap(session_id: str | None = None) -> ORJSONResponse:
    """Toggle team sides (manual swap)."""
    await RioGameDataProvider.toggle_sides_swapped()
    return ORJSONResponse({
        "success": True,
        "sides_swapped": RioGameDataProvider._sides_swapped
    })

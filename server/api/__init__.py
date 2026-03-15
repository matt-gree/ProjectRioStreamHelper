from fastapi import APIRouter
from server.api.v1 import (
    update_team,
    state,
    settings,
    rio,
    scoreboards,
    game_pool,
    stats,
    layouts,
)

router_v1 = APIRouter(
    prefix="/api/v1",
    tags=["api","api_v1"]
)

router_v1.include_router(update_team.router)
router_v1.include_router(state.router)
router_v1.include_router(settings.router)
router_v1.include_router(rio.router)
router_v1.include_router(scoreboards.router)
router_v1.include_router(game_pool.router)
router_v1.include_router(stats.router)
router_v1.include_router(layouts.router)
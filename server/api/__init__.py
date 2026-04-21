from fastapi import APIRouter
from server.api.v1 import (
    update_team,
    state,
    settings,
    rio,
    scoreboards,
    game_pool,
    rotation,
    stats,
    layouts,
    branding,
    startgg,
    challonge,
    controller,
    announcements,
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
router_v1.include_router(rotation.router)
router_v1.include_router(stats.router)
router_v1.include_router(layouts.router)
router_v1.include_router(branding.router)
router_v1.include_router(startgg.router)
router_v1.include_router(challonge.router)
router_v1.include_router(controller.router)
router_v1.include_router(announcements.router)
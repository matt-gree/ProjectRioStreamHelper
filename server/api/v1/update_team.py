from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

# This only needs to be declared once in the file
router = APIRouter()

# /api/v1/update_team
@method(
        router.post, "/update_team",
        # Version and Socketio ID (v1:update_team)
        version="1", id="update_team",
        # Parameters for FastAPI
        response_class=ORJSONResponse
)
async def update_team(scoreboardNumber: int = 1, team: int = 1, player: int = 1, session_id: str | None = None):
    return ORJSONResponse({
        "scoreboardNumber": scoreboardNumber
    })
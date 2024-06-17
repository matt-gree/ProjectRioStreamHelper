from server.utils.router import method
from fastapi.responses import ORJSONResponse
from server.api import router_v1

@method(
        # Method and endpoint (/api/v1/update_team)
        router_v1.post, "/update_team",
        # Version and Socketio ID (v1:update_team)
        version="1", id="update_team",
        # Parameters for FastAPI
        response_class=ORJSONResponse
)
async def update_team(scoreboardNumber: int = 1, team: int = 1, player: int = 1, session_id: str | None = None):
    return ORJSONResponse({
        "scoreboardNumber": scoreboardNumber
    })
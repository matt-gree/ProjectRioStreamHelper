from server.utils.router import method
from fastapi.responses import ORJSONResponse
from server.api import router_v1

@method(router_v1.post, "/update_team", id="update_team_v1", response=ORJSONResponse)
async def update_team(scoreboardNumber: int = 1, team: int = 1, player: int = 1, session_id: str | None = None):
    return {
        "scoreboardNumber": scoreboardNumber
    }
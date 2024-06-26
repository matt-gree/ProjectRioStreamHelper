from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse, Response
from loguru import logger
from server.settings import get_settings, Config

# This only needs to be declared once in the file
router = APIRouter()

@method(
    router.get, "/settings",
    version="1", id="settings.get",
    response_class=Response
)
async def settings_get(session_id: str | None = None) -> Response:
    return Response(
        content=get_settings().model_dump_json(), 
        media_type="application/json"
    )

@method(
    router.get, "/config",
    version="1", id="config.get",
    response_class=ORJSONResponse
)
async def config_get(session_id: str | None = None) -> ORJSONResponse:
    return ORJSONResponse(Config.config)
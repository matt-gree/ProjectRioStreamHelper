from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse, Response
from server.settings import Settings, Config

# This only needs to be declared once in the file
router = APIRouter()

@method(
    router.get, "/settings",
    version="1", id="settings.get",
    response_class=Response
)
async def settings_get(key: str | None = None, session_id: str | None = None) -> ORJSONResponse:
    if key == None or key == "":
        return ORJSONResponse(Settings.settings)
    
    return ORJSONResponse(await Settings.Get(key))

@method(
    router.put, "/settings",
    version="1", id="settings.set",
    response_class=ORJSONResponse
)
async def settings_set(key: str = "", value: str | None = None, session_id: str | None = None):
    try:
        await Settings.Set(key, value, session_id=session_id)
    except Exception as e:
        return ORJSONResponse({
            "error": e
        })
    
    return ORJSONResponse({
        "success": True
    })

@method(
    router.delete, "/settings",
    version="1", id="settings.unset",
    response_class=ORJSONResponse
)
async def settings_unset(key: str = "", session_id: str | None = None):
    try:
        await Settings.Unset(key, session_id=session_id)
    except Exception as e:
        return ORJSONResponse({
            "error": e
        })
    
    return ORJSONResponse({
        "success": True
    })

@method(
    router.get, "/config",
    version="1", id="config.get",
    response_class=ORJSONResponse
)
async def config_get(session_id: str | None = None) -> ORJSONResponse:
    return ORJSONResponse(Config.config)
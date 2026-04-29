from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse, Response
from server.settings import Settings, Config, SECRET_KEYS, redact_settings

# This only needs to be declared once in the file
router = APIRouter()

@method(
    router.get, "/settings",
    version="1", id="settings.get",
    response_class=Response
)
async def settings_get(key: str | None = None, session_id: str | None = None) -> ORJSONResponse:
    if key == None or key == "":
        return ORJSONResponse(redact_settings(Settings.settings))

    value = Settings.Get(key)
    # For secret keys, return whether configured (not the raw value)
    if key in SECRET_KEYS:
        return ORJSONResponse(bool(value))
    return ORJSONResponse(value)

@method(
    router.put, "/settings",
    version="1", id="settings.set",
    response_class=ORJSONResponse
)
async def settings_set(key: str = "", value: str | None = None, session_id: str | None = None):
    await Settings.Set(key, value, session_id=session_id)
    return ORJSONResponse({"success": True})

@method(
    router.delete, "/settings",
    version="1", id="settings.unset",
    response_class=ORJSONResponse
)
async def settings_unset(key: str = "", session_id: str | None = None):
    await Settings.Unset(key, session_id=session_id)
    return ORJSONResponse({"success": True})

@method(
    router.get, "/config",
    version="1", id="config.get",
    response_class=ORJSONResponse
)
async def config_get(session_id: str | None = None) -> ORJSONResponse:
    return ORJSONResponse(Config.config)

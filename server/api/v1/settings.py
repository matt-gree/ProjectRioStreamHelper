from loguru import logger
from server import socketio
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

# Socket-only, like `v1.state.set_batch`: the app is the one writer, and it
# talks to settings over the socket already. Echoes carry the caller's sid.
@socketio.on('v1.settings.apply_batch')
async def on_settings_apply_batch(sid, data):
    """Apply {items: [{key, value}], unset: [key]} as one settings commit."""
    try:
        items = (data or {}).get("items") or []
        unset = (data or {}).get("unset") or []
        await Settings.ApplyBatch(
            [(item["key"], item.get("value")) for item in items],
            [str(key) for key in unset],
            session_id=sid,
        )
        return {"success": True}
    except Exception as e:
        logger.exception("settings.apply_batch handler failed")
        return {"error": str(e)}

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

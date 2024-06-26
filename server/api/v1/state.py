from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from server.state import State

# This only needs to be declared once in the file
router = APIRouter()

@method(
    router.get, "/state",
    version="1", id="state.get",
    response_class=ORJSONResponse
)
async def state_get(key: str | None = None, session_id: str | None = None) -> ORJSONResponse:
    if key == None or key == "":
        return ORJSONResponse(State.state)
    
    return ORJSONResponse(await State.Get(key))

@method(
    router.put, "/state",
    version="1", id="state.set",
    response_class=ORJSONResponse
)
async def state_set(key: str = "", value: str | None = None, session_id: str | None = None):
    try:
        await State.Set(key, value, session_id=session_id)
    except Exception as e:
        return ORJSONResponse({
            "error": e
        })
    
    return ORJSONResponse({
        "success": True
    })

@method(
    router.delete, "/state",
    version="1", id="state.unset",
    response_class=ORJSONResponse
)
async def state_unset(key: str = "", session_id: str | None = None):
    try:
        await State.Unset(key, session_id=session_id)
    except Exception as e:
        return ORJSONResponse({
            "error": e
        })
    
    return ORJSONResponse({
        "success": True
    })
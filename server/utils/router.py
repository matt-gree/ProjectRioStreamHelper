import orjson
import asyncio
from functools import partial
from fastapi.responses import Response, JSONResponse
from server import socketio

async def on_socketio_event(sid, data, event_id, func):
    parsed = await asyncio.to_thread(orjson.loads, data)

    uuid = ""
    if isinstance(parsed, dict):
        uuid = parsed.pop("uuid", "")

    content = await func(**parsed, session_id=sid)

    isJson = True
    if isinstance(content, JSONResponse):
        content = await asyncio.to_thread(content.body.decode, content.charset)
    else:
        isJson = False
        if isinstance(content, Response):
            content = await asyncio.to_thread(content.body.decode, content.charset)

    if isinstance(content, dict) and uuid != "":
        content["uuid"] = uuid

    if sid == None or sid == "":
        await socketio.emit(event_id, content, json=isJson)
    else:
        await socketio.emit(event_id, content, json=isJson, to=sid)

def method(*args, **kwargs):
    def wrapper(func):
        # Remove session id for APIRouter
        if "session_id" in kwargs:
            del kwargs["session_id"]

        # Remove Socketio Event ID
        id = kwargs.pop("id", "")

        # Remove Socketio extra params
        namespace = kwargs.pop("namespace", None)
        version = kwargs.pop("version", 1)

        # Call router.get() with async func
        router = args[0]
        router(*args[1:], **kwargs)(func)

        if id != "":
            handler = partial(
                on_socketio_event,
                event_id=id,
                func=func
            )

            # Add one for API version
            socketio.on(f"v{version}.{id}", namespace=namespace)(handler)
            # This will overwrite the old event ID as well
            socketio.on(id, namespace=namespace)(handler)

    return wrapper


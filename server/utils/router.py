import orjson
from functools import partial
from fastapi.responses import Response, JSONResponse
from server import app

async def on_socketio_event(sid, data, event_id, func):
    parsed = orjson.loads(data)

    uuid = ""
    if isinstance(parsed, dict) and parsed.has_key("uuid"):
        uuid = parsed.get("uuid")
        del parsed["uuid"]

    content = await func(**parsed, session_id=sid)

    if content == None:
        return
    
    if isinstance(content, dict) and uuid != "":
        content["uuid"] = uuid

    isJson = True
    if isinstance(content, JSONResponse):
        content = content.body.decode(content.charset)
    else:
        isJson = False
        if isinstance(content, Response):
            content = content.body.decode(content.charset)

    if sid == None or sid == '':
        await app.socketio.emit(event_id, content, json=isJson)
    else:
        await app.socketio.emit(event_id, content, json=isJson, to=sid)

def method(*args, **kwargs):
    def wrapper(func):
        # Remove session id for APIRouter
        del kwargs["session_id"]

        # Remove Socketio Event ID
        id = kwargs.pop("id", "")

        # Remove Socketio extra params
        handler = kwargs.pop("handler", None)
        namespace = kwargs.pop("namespace", None)
        version = kwargs.pop("version", 1)

        # Call router.get() with async func
        router = args[0]
        router(*args[1:], **kwargs)(func)

        if id != "":
            app.socketio.on(
                f"v{version}:{id}", 
                handler=handler, 
                namespace=namespace
            )(partial(
                on_socketio_event,
                event_id=id,
                func=func
            ))

    return wrapper
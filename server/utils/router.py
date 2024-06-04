import orjson
from functools import partial
from server import app

async def on_socketio_event(sid, data, event_id, func):
    parsed = orjson.loads(data)

    uuid = ""
    if isinstance(parsed, dict) and parsed.has_key("uuid"):
        uuid = parsed.get("uuid")
        del parsed["uuid"]

    content = await func(**parsed, session_id=sid)

    if isinstance(content, dict) and uuid != "":
        content["uuid"] = uuid

    if content != None:
        await app.socketio.emit(event_id, content, json=True, to=sid)

def method(*args, **kwargs):
    def wrapper(func):
        # Remove session id for APIRouter
        del kwargs["session_id"]

        # Remove Socketio Event ID
        id = kwargs.get("id", "")
        del kwargs["id"]

        # Remove Socketio extra params
        handler = kwargs.get("handler", None)
        del kwargs["handler"]
        namespace = kwargs.get("namespace", None)
        del kwargs["namespace"]

        # Call router.get() with async func
        router = args[0]
        router(*args[1:], **kwargs)(func)

        if id != "":
            app.socketio.on(
                id, 
                handler=handler, 
                namespace=namespace
            )(partial(
                on_socketio_event,
                event_id=id,
                func=func
            ))

    return wrapper
import orjson
import asyncio
from functools import partial
from loguru import logger
from fastapi.responses import Response
from server import socketio
from server.utils import json

async def on_socketio_event(sid, data, func):
    content = None

    try:
        content = await func(**data, session_id=sid)
        if isinstance(content, Response):
            content = await asyncio.to_thread(
                content.body.decode, 
                content.charset
            )
    except Exception as e:
        logger.exception("error while parsing socketio event")
        content = {
            "error": e
        }

    if isinstance(content, str):
        # Send actual JSON since FastHTTP's encoder likes bytes/str
        content = await json.loads(content)

    return content

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
                func=func
            )

            # Add one for API version
            socketio.on(f"v{version}.{id}", namespace=namespace)(handler)
            # This will overwrite the old event ID as well
            socketio.on(id, namespace=namespace)(handler)

    return wrapper


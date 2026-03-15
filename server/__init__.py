from socketio import AsyncServer

socketio = AsyncServer(async_mode="asgi", cors_allowed_origins="*")
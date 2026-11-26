from server.paths import ensure_pyrio_importable

# Before anything imports pyrio: the pinned submodule must win over any pyrio
# installed in the environment (an old 0.x is a common leftover).
ensure_pyrio_importable()

from socketio import AsyncServer

# Origins are NOT open just because this says "*": server/origin_guard.py wraps
# Socket.IO and refuses any handshake whose Origin is not PRSH itself. "*" only
# stops Socket.IO from running a second, disagreeing origin check of its own.
socketio = AsyncServer(async_mode="asgi", cors_allowed_origins="*")

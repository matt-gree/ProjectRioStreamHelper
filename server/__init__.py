from socketio import AsyncServer

# CORS must allow all origins because:
# 1. OBS browser sources use null/file:// origins
# 2. Local network devices (phones/tablets for remote control) use different IPs
# 3. The Vite dev server runs on a different port (5173)
#
# This is safe because the server only listens on the local network.
# The server is not intended to be exposed to the public internet.
socketio = AsyncServer(async_mode="asgi", cors_allowed_origins="*")

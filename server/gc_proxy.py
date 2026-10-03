"""gc-overlay, served through PRSH at /gc/.

gc-overlay is a subprocess on a loopback port of its own. Reached directly, a
Controller source only worked when OBS ran on the same machine as PRSH: the
URL said `http://localhost:8069`, which on any other machine names that
machine, and gc-overlay only listens on 127.0.0.1 anyway — so a dual-machine
rig drew an empty frame, and so did the Connections tab's previews on a second
screen. Proxied, gc-overlay rides PRSH's own address, port and LAN setting:
whoever can reach PRSH can reach the controller, nobody else can, and the
port it really runs on is private to `ControllerOverlay`.

Two halves, because gc-overlay is two things: its page and settings API over
plain HTTP, and the controller stream over a WebSocket at /ws (which its page
opens RELATIVE to itself as of gc-overlay 1.4.2, so /gc/ws, not PRSH's /ws).
"""

import asyncio

import httpx
import websockets
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, Response
from loguru import logger

from server.controller_overlay import ControllerOverlay

router = APIRouter()

PREFIX = "/gc"

# Response headers worth passing back. Hop-by-hop and length/encoding headers
# are the proxy's own to set: httpx has already decoded the body.
_PASS_HEADERS = ("content-type", "etag", "last-modified")

# Test seam: an httpx transport to use instead of the network.
_transport = None

_NOT_RUNNING = "The controller reader isn't running — start it on the Connections tab."


@router.get(PREFIX, include_in_schema=False)
async def gc_root(request: Request):
    # Without the trailing slash the page's relative WebSocket URL would
    # resolve to PRSH's /ws, not /gc/ws.
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(f"{PREFIX}/{query}", status_code=307)


@router.websocket(f"{PREFIX}/ws")
async def gc_ws(client: WebSocket):
    port = ControllerOverlay.ProxyTarget()
    if port is None:
        await client.close(code=1013)  # try again later
        return
    query = client.url.query
    target = f"ws://127.0.0.1:{port}/ws" + (f"?{query}" if query else "")
    await client.accept()
    try:
        async with websockets.connect(target, max_size=None) as upstream:
            async def down():
                async for msg in upstream:
                    if isinstance(msg, bytes):
                        await client.send_bytes(msg)
                    else:
                        await client.send_text(msg)

            async def up():
                while True:
                    msg = await client.receive()
                    if msg["type"] == "websocket.disconnect":
                        return
                    if msg.get("text") is not None:
                        await upstream.send(msg["text"])
                    elif msg.get("bytes") is not None:
                        await upstream.send(msg["bytes"])

            # Either side ending ends the pair; the other task is cancelled.
            tasks = [asyncio.create_task(down()), asyncio.create_task(up())]
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
    except (OSError, websockets.WebSocketException, WebSocketDisconnect) as e:
        logger.debug("[gc_proxy] websocket ended: {}", e)
    finally:
        try:
            await client.close()
        except RuntimeError:
            pass  # already closed


@router.api_route(f"{PREFIX}/{{path:path}}", methods=["GET", "POST", "OPTIONS"], include_in_schema=False)
async def gc_http(path: str, request: Request):
    port = ControllerOverlay.ProxyTarget()
    if port is None:
        return Response(_NOT_RUNNING, status_code=503, media_type="text/plain")
    url = f"http://127.0.0.1:{port}/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    headers = {}
    if "content-type" in request.headers:
        headers["content-type"] = request.headers["content-type"]
    try:
        async with httpx.AsyncClient(timeout=5, transport=_transport) as c:
            r = await c.request(request.method, url, content=await request.body(), headers=headers)
    except httpx.HTTPError as e:
        logger.debug("[gc_proxy] {} {} failed: {}", request.method, url, e)
        return Response(_NOT_RUNNING, status_code=503, media_type="text/plain")
    out = {k: r.headers[k] for k in _PASS_HEADERS if k in r.headers}
    # gc-overlay's page changes under a URL that doesn't when it is updated,
    # the same reason /layout/ revalidates (server/http_cache.py).
    out["cache-control"] = "no-cache"
    return Response(r.content, status_code=r.status_code, headers=out)

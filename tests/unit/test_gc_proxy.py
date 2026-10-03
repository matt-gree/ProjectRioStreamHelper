"""gc-overlay through PRSH's own address (/gc/).

The proxy is what lets a Controller source draw on an OBS that is not on the
PRSH machine: gc-overlay listens on loopback only, so a URL naming its own port
reached nothing from anywhere else. Both halves are pinned — the page and API
over HTTP, and the controller stream over a WebSocket, which is the one that
carries every frame of input and the one most easily broken by a prefix.
"""
import asyncio
import socket
import threading

import httpx
import pytest
import websockets
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import gc_proxy
from server.controller_overlay import ControllerOverlay


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(gc_proxy.router)
    return TestClient(app)


def _running_on(monkeypatch, port):
    monkeypatch.setattr(ControllerOverlay, "ProxyTarget", classmethod(lambda cls: port))


def test_a_stopped_reader_is_a_503_not_a_hang(client, monkeypatch):
    _running_on(monkeypatch, None)
    r = client.get("/gc/?port=1")
    assert r.status_code == 503
    assert "Connections" in r.text


def test_the_bare_prefix_redirects_to_the_slash_keeping_the_query(client, monkeypatch):
    # Without the slash the page's RELATIVE websocket would resolve to /ws.
    _running_on(monkeypatch, 8069)
    r = client.get("/gc?port=2&bg=transparent", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "/gc/?port=2&bg=transparent"


def test_http_is_forwarded_to_the_loopback_port_with_path_and_query(client, monkeypatch):
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["method"] = request.method
        seen["body"] = request.content
        return httpx.Response(200, text="<html>pad</html>", headers={"content-type": "text/html"})

    _running_on(monkeypatch, 8123)
    monkeypatch.setattr(gc_proxy, "_transport", httpx.MockTransport(handler))

    r = client.get("/gc/?port=3&gear=0")
    assert r.status_code == 200
    assert r.text == "<html>pad</html>"
    assert seen["url"] == "http://127.0.0.1:8123/?port=3&gear=0"
    assert r.headers["cache-control"] == "no-cache"

    r = client.post("/gc/api/calibrate", content=b'{"x":1}', headers={"content-type": "application/json"})
    assert seen == {"url": "http://127.0.0.1:8123/api/calibrate", "method": "POST", "body": b'{"x":1}'}


def test_an_upstream_that_vanished_is_a_503(client, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    _running_on(monkeypatch, 8123)
    monkeypatch.setattr(gc_proxy, "_transport", httpx.MockTransport(handler))
    assert client.get("/gc/").status_code == 503


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def upstream_ws():
    """A real WebSocket server standing in for gc-overlay's /ws: it reports the
    path+query it was reached at, then echoes."""
    port = _free_port()
    loop = asyncio.new_event_loop()
    ready = threading.Event()
    stop = None

    async def handler(ws):
        await ws.send(f"hello {ws.request.path}" if hasattr(ws, "request") else f"hello {ws.path}")
        async for msg in ws:
            await ws.send(f"echo {msg}")

    async def main():
        nonlocal stop
        stop = loop.create_future()
        async with websockets.serve(handler, "127.0.0.1", port):
            ready.set()
            await stop

    t = threading.Thread(target=loop.run_until_complete, args=(main(),), daemon=True)
    t.start()
    ready.wait(5)
    yield port
    loop.call_soon_threadsafe(stop.set_result, None)
    t.join(5)


def test_the_controller_stream_is_relayed_both_ways(client, monkeypatch, upstream_ws):
    _running_on(monkeypatch, upstream_ws)
    with client.websocket_connect("/gc/ws?port=2&bg=transparent") as ws:
        # gc-overlay resolves a source's settings from the query it connected
        # with, so the query must arrive intact.
        assert ws.receive_text() == "hello /ws?port=2&bg=transparent"
        ws.send_text('{"calibrate": true}')
        assert ws.receive_text() == 'echo {"calibrate": true}'


def test_a_stream_to_a_stopped_reader_is_refused(client, monkeypatch):
    _running_on(monkeypatch, None)
    with pytest.raises(Exception):
        with client.websocket_connect("/gc/ws") as ws:
            ws.receive_text()

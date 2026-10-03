"""A page on another website, running in the producer's browser, must not be
able to drive PRSH — with or without LAN access on.

Each refusal here is a real door that was open: Socket.IO writes, query-only
POSTs that skip the CORS preflight, and DNS rebinding through a foreign Host.
Each pass is a client PRSH must keep serving: OBS sources (no Origin), the
console (same origin), a phone on the LAN URL, scripts and curl.
"""
import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from server import origin_guard as og
from server.origin_guard import OriginGuard, host_allowed, origin_allowed


# TestClient's WebSocket handshake sends `Host: testserver` whatever base_url
# says, so the socket tests state the host a real browser would.
HOST = {"Host": "127.0.0.1:5260"}


@pytest.fixture
def client():
    app = FastAPI()

    @app.get("/api/v1/settings")
    async def read():
        return {"ok": True}

    @app.post("/api/v1/scoreboards/reset")
    async def write():
        return {"reset": True}

    @app.websocket("/socket.io/")
    async def ws(sock: WebSocket):
        await sock.accept()
        await sock.send_text("hi")
        await sock.close()

    return TestClient(OriginGuard(app), base_url="http://127.0.0.1:5260")


# ── origin ──────────────────────────────────────────────────────────────────

def test_a_foreign_page_cannot_post_even_without_a_preflight(client):
    r = client.post("/api/v1/scoreboards/reset", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_a_foreign_page_cannot_open_the_socket(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/socket.io/", headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_text()


def test_the_console_itself_is_same_origin(client):
    h = {"Origin": "http://127.0.0.1:5260"}
    assert client.post("/api/v1/scoreboards/reset", headers=h).status_code == 200
    with client.websocket_connect("/socket.io/", headers={**h, **HOST}) as ws:
        assert ws.receive_text() == "hi"


def test_another_port_on_the_same_host_is_another_origin(client):
    r = client.post("/api/v1/scoreboards/reset", headers={"Origin": "http://127.0.0.1:8080"})
    assert r.status_code == 403


def test_no_origin_is_obs_or_a_script_and_passes(client):
    assert client.post("/api/v1/scoreboards/reset").status_code == 200
    with client.websocket_connect("/socket.io/", headers=HOST) as ws:
        assert ws.receive_text() == "hi"


def test_a_null_origin_may_read_but_never_write(client):
    # A sandboxed iframe on any site sends `null`, so it is no credential.
    h = {"Origin": "null"}
    assert client.get("/api/v1/settings", headers=h).status_code == 200
    assert client.post("/api/v1/scoreboards/reset", headers=h).status_code == 403
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/socket.io/", headers=h) as ws:
            ws.receive_text()


def test_a_phone_on_the_lan_url_is_same_origin():
    assert origin_allowed("http://192.168.1.20:5260", "192.168.1.20:5260", "POST")


@pytest.mark.parametrize("origin", ["http://localhost:5260", "file://", "chrome-extension://abc"])
def test_anything_that_is_not_this_address_is_refused(origin):
    assert not origin_allowed(origin, "127.0.0.1:5260", "POST")


# ── host (DNS rebinding) ────────────────────────────────────────────────────

def test_a_rebound_domain_cannot_read(client):
    # The attacker's own name, re-pointed at 127.0.0.1: same-origin with their
    # page, so no Origin check could see it.
    r = client.get("/api/v1/settings", headers={"Host": "attacker.example:5260"})
    assert r.status_code == 403


@pytest.mark.parametrize("host", [
    "127.0.0.1:5260", "localhost:5260", "192.168.1.20:5260", "[::1]:5260", "prsh.localhost",
])
def test_the_names_a_producer_uses_are_allowed(host):
    assert host_allowed(host)


def test_this_machines_own_name_is_allowed_with_a_local_suffix(monkeypatch):
    monkeypatch.setattr(og, "MACHINE_NAMES", {"gaming-pc"})
    for host in ("gaming-pc:5260", "gaming-pc.local:5260", "Gaming-PC.lan"):
        assert host_allowed(host)
    assert not host_allowed("gaming-pc-not.example")
    assert not host_allowed("evil.example")

"""Refuse requests that a web page on some OTHER site made through the
producer's own browser.

Binding to 127.0.0.1 keeps other MACHINES out. It does nothing about other
WEBSITES: a page open in the producer's browser runs on the producer's machine
and can reach 127.0.0.1 like anything else. Before this guard three doors were
open to it, none of which needs LAN access on:

  - Socket.IO took any origin (`cors_allowed_origins="*"`), so any page could
    connect and emit `v1.state.set_batch` / `v1.settings.apply_batch` — write
    the broadcast and the settings.
  - Most POST endpoints take query parameters only, which a browser sends
    cross-site WITHOUT a CORS preflight. The page cannot read the answer, but
    the write happens: `POST /scoreboards/reset` wipes every board.
  - Nothing checked `Host`, so DNS rebinding — the page's own domain re-pointed
    at 127.0.0.1 — made PRSH same-origin with the attacker's page, readable in
    full, OBS websocket password included.

Two checks, both on every HTTP request and WebSocket handshake:

  ORIGIN: when a request names one (browsers do on every cross-origin request,
  every POST/PUT/DELETE and every WebSocket), it must be PRSH itself — the same
  host:port the request was sent to. Requests with no Origin (OBS loading a
  source, curl, scripts) are untouched: a browser cannot be made to omit it on
  the requests that matter. `null` (a file:// page, a sandboxed frame) is
  allowed to READ only, because a sandboxed iframe on any site can send it.

  HOST: must be an IP literal, `localhost`, or this machine's own name. Those
  are the only names a producer reaches PRSH by, and rebinding needs a domain
  the attacker owns — an IP literal can't be rebound.

The three original reasons for `"*"` were all mistaken: OBS sources are served
over http from PRSH (same origin), a phone opening the LAN URL is same-origin
too, and in dev the page is served from 5260 — only its scripts come from Vite.
"""

import ipaddress
from urllib.parse import parse_qs

from loguru import logger

from server.lan_access import UNLOCK_PATH, LanAccess, cookie_header, pin_page, request_key
from server.network import MACHINE_NAMES, Network

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _split_host(value: str) -> tuple[str, str | None]:
    """'Host' header → (hostname, port or None), lowercased, IPv6 brackets kept off."""
    value = (value or "").strip().lower()
    if value.startswith("["):
        end = value.find("]")
        host, rest = value[1:end], value[end + 1:]
        return host, rest[1:] if rest.startswith(":") else None
    if value.count(":") == 1:
        host, port = value.split(":")
        return host, port
    return value, None


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def host_allowed(host_header: str) -> bool:
    host, _ = _split_host(host_header)
    if not host:
        return True  # HTTP/1.0 with no Host: nothing a browser sends
    if _is_ip(host) or host == "localhost" or host.endswith(".localhost"):
        return True
    # This machine by name, with or without a local suffix (.local, .lan, .home).
    return host in MACHINE_NAMES or host.split(".")[0] in MACHINE_NAMES


def origin_allowed(origin: str | None, host_header: str, method: str) -> bool:
    if origin is None:
        return True
    origin = origin.strip().lower()
    if origin == "null":
        return method in _SAFE_METHODS
    scheme, sep, rest = origin.partition("://")
    if not sep or scheme not in ("http", "https"):
        return False
    o_host, o_port = _split_host(rest)
    h_host, h_port = _split_host(host_header)
    default = "443" if scheme == "https" else "80"
    return o_host == h_host and (o_port or default) == (h_port or default)


class OriginGuard:
    """Outermost ASGI middleware — wraps Socket.IO and the FastAPI app alike."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        host = headers.get("host", "")
        origin = headers.get("origin")
        method = "WEBSOCKET" if scope["type"] == "websocket" else scope.get("method", "GET")
        if host_allowed(host) and origin_allowed(origin, host, method):
            client = scope.get("client")
            ip = client[0] if client else None
            # Before the PIN: a device at the PIN page got through the firewall,
            # which is what the Network card's "last reached" line answers.
            Network.note_client(ip)
            if LanAccess.required() and not Network.is_self_client(ip):
                return await self._gate(scope, receive, send, headers, ip)
            return await self.app(scope, receive, send)

        logger.warning(
            "[origin_guard] refused {} {} (Host={!r}, Origin={!r})",
            method, scope.get("path"), host, origin,
        )
        if scope["type"] == "websocket":
            # Closing before accept answers the handshake with a 403.
            await send({"type": "websocket.close", "code": 1008})
            return
        body = b"Refused: this request came from a page that is not PRSH."
        await send({
            "type": "http.response.start",
            "status": 403,
            "headers": [(b"content-type", b"text/plain"), (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})

    # ── the LAN PIN (server/lan_access.py) ──────────────────────────────────

    async def _gate(self, scope, receive, send, headers, ip):
        cookie_key, query_key = request_key(scope, headers)
        if LanAccess.key_ok(cookie_key):
            return await self.app(scope, receive, send)
        if LanAccess.key_ok(query_key):
            # OBS's URL carries the key: let it in and set the cookie, so the
            # page's own fetches and socket (which don't repeat ?key=) follow.
            if scope["type"] == "websocket":
                return await self.app(scope, receive, send)

            async def with_cookie(message):
                if message["type"] == "http.response.start":
                    message = {**message, "headers": [*message.get("headers", []), cookie_header()]}
                await send(message)
            return await self.app(scope, receive, with_cookie)

        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        path = scope.get("path", "/")
        if path == UNLOCK_PATH and scope.get("method") == "POST":
            return await self._unlock(scope, receive, send, ip)
        accepts_html = "text/html" in headers.get("accept", "")
        if scope.get("method") == "GET" and accepts_html:
            qs = (scope.get("query_string") or b"").decode("latin-1")
            return await _respond(send, 401, pin_page(path + (f"?{qs}" if qs else "")), b"text/html; charset=utf-8")
        return await _respond(send, 401, b"PIN required: open PRSH in a browser and enter its PIN.", b"text/plain")

    async def _unlock(self, scope, receive, send, ip):
        body = b""
        while True:
            msg = await receive()
            body += msg.get("body", b"")
            if not msg.get("more_body") or len(body) > 4096:
                break
        pin = (parse_qs(body.decode("latin-1")).get("pin") or [""])[0]
        nxt = (parse_qs((scope.get("query_string") or b"").decode("latin-1")).get("next") or ["/"])[0]
        if not nxt.startswith("/") or nxt.startswith("//"):
            nxt = "/"  # never an open redirect
        verdict = LanAccess.try_pin(ip or "", pin)
        if verdict:
            logger.info("[lan_access] {} entered the PIN", ip)
            await send({"type": "http.response.start", "status": 303,
                        "headers": [(b"location", nxt.encode("latin-1")), cookie_header(), (b"content-length", b"0")]})
            await send({"type": "http.response.body", "body": b""})
            return
        msg = "Too many tries — wait a minute and try again." if verdict is None else "That isn't the PIN."
        return await _respond(send, 401, pin_page(nxt, msg), b"text/html; charset=utf-8")


async def _respond(send, status, body: bytes, content_type: bytes):
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", content_type), (b"content-length", str(len(body)).encode())],
    })
    await send({"type": "http.response.body", "body": body})

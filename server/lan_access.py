"""An optional PIN for every device that is not the PRSH computer.

With LAN access on, anyone on the network could open PRSH and drive the
broadcast — on venue Wi-Fi, that is strangers. This closes it without costing
the common setup anything:

  - The PRSH computer is EXEMPT. A request from loopback or one of this
    machine's own addresses never needs the PIN, so a single-machine producer
    never sees it.
  - A phone or second screen gets a small PIN page once; the right PIN sets a
    cookie and it is remembered from then on.
  - OBS on another computer cannot type a PIN, so its sources carry a long
    random KEY in the URL (`?key=…`) — added by the address repair
    (server/source_addresses.py), which also rewrites it when the PIN is
    regenerated. The first load sets the same cookie, so the page's own
    fetches and socket need nothing further.

The PIN and key live in their own file, not in settings: the settings API is
writable by any device that gets in, and must not be able to read the PIN or
switch the requirement off. Only the PRSH computer can (`POST /network/pin`).
"""

import hmac
import json
import secrets
import time
from html import escape
from urllib.parse import parse_qs, urlencode

from loguru import logger

from server.paths import user_data_dir

COOKIE = "prsh_key"
UNLOCK_PATH = "/__prsh/unlock"

# Guessing a 6-digit PIN over a LAN at full speed takes minutes; this makes it
# weeks. Per client address: 5 misses, then a minute's lockout.
_MAX_MISSES = 5
_LOCKOUT_S = 60


class LanAccess:
    enabled: bool = False
    pin: str = ""
    key: str = ""
    _loaded = False
    _misses: dict[str, tuple[int, float]] = {}

    @classmethod
    def _file(cls):
        return user_data_dir() / "lan_access.json"

    @classmethod
    def load(cls) -> None:
        cls._loaded = True
        try:
            data = json.loads(cls._file().read_text())
        except (OSError, ValueError):
            data = {}
        cls.enabled = bool(data.get("enabled"))
        cls.pin = str(data.get("pin") or "")
        cls.key = str(data.get("key") or "")
        # A secret is minted the first time the PIN is turned on, not on every
        # install's first request.
        if cls.enabled and not (cls.pin and cls.key):
            cls._new_secret()

    @classmethod
    def _ensure(cls):
        if not cls._loaded:
            cls.load()

    @classmethod
    def _new_secret(cls) -> None:
        cls.pin = f"{secrets.randbelow(10**6):06d}"
        cls.key = secrets.token_hex(16)
        cls._save()

    @classmethod
    def _save(cls) -> None:
        try:
            cls._file().write_text(json.dumps({"enabled": cls.enabled, "pin": cls.pin, "key": cls.key}))
        except OSError:
            logger.exception("[lan_access] could not save")

    @classmethod
    def configure(cls, enabled: bool | None = None, regenerate: bool = False) -> None:
        cls._ensure()
        if regenerate or (enabled and not (cls.pin and cls.key)):
            cls._new_secret()
        if enabled is not None:
            cls.enabled = bool(enabled)
            cls._save()

    @classmethod
    def status(cls, for_self: bool) -> dict:
        cls._ensure()
        out = {"pin_enabled": cls.enabled}
        if cls.enabled:
            # Any client that got this far is already let in, so the key it
            # would need to build an OBS URL is not a secret from it.
            out["key"] = cls.key
        if for_self and cls.enabled:
            out["pin"] = cls.pin
        return out

    @classmethod
    def required(cls) -> bool:
        cls._ensure()
        return cls.enabled

    @classmethod
    def key_ok(cls, value: str | None) -> bool:
        return bool(value and cls.key) and hmac.compare_digest(str(value), cls.key)

    # ── the PIN page ────────────────────────────────────────────────────────

    @classmethod
    def try_pin(cls, client: str, pin: str) -> bool | None:
        """True right, False wrong, None locked out."""
        n, at = cls._misses.get(client, (0, 0.0))
        if n >= _MAX_MISSES and time.time() - at < _LOCKOUT_S:
            return None
        if hmac.compare_digest(str(pin or "").strip(), cls.pin):
            cls._misses.pop(client, None)
            return True
        n = 0 if time.time() - at >= _LOCKOUT_S else n
        cls._misses[client] = (n + 1, time.time())
        return False


def request_key(scope, headers: dict) -> tuple[str | None, str | None]:
    """(key from the cookie, key from ?key=) for a request."""
    cookie_key = None
    for part in headers.get("cookie", "").split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE:
            cookie_key = value
    query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
    return cookie_key, (query.get("key") or [None])[0]


def cookie_header() -> tuple[bytes, bytes]:
    # A year: re-entering a PIN on a phone mid-show is the failure to avoid.
    # Regenerating the PIN changes the key and so invalidates every cookie.
    value = f"{COOKIE}={LanAccess.key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000"
    return b"set-cookie", value.encode("latin-1")


def pin_page(next_path: str, message: str = "") -> bytes:
    note = f'<p class="err">{escape(message)}</p>' if message else ""
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PRSH — PIN</title>
<style>
 body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f14;color:#e8e8ee;font:15px system-ui,sans-serif}}
 form{{display:flex;flex-direction:column;gap:12px;width:min(320px,90vw)}}
 h1{{font-size:18px;margin:0}} p{{margin:0;color:#a0a0ad;font-size:13px}} .err{{color:#fca5a5}}
 input{{font:24px ui-monospace,monospace;letter-spacing:.3em;text-align:center;padding:10px;border-radius:8px;border:1px solid #33333f;background:#181820;color:inherit}}
 button{{padding:10px;border-radius:8px;border:0;background:#f59e0b;color:#111;font-weight:600;font-size:15px}}
</style></head><body>
<form method="post" action="{UNLOCK_PATH}?{urlencode({"next": next_path})}">
 <h1>Enter the PRSH PIN</h1>
 <p>It's on the Connections tab of the computer running PRSH.</p>{note}
 <input name="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus required>
 <button type="submit">Continue</button>
</form></body></html>""".encode()

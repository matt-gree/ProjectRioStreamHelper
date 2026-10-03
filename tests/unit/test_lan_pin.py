"""The LAN PIN (server/lan_access.py, enforced by server/origin_guard.py).

Off, nothing changes. On, every device that is not the PRSH computer needs
either the PIN (a person: once, then a cookie) or the key (OBS: in the URL) —
and the PRSH computer itself never needs either.
"""
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from server import network as net
from server import source_addresses as sa
from server.lan_access import COOKIE, UNLOCK_PATH, LanAccess
from server.network import Network
from server.origin_guard import OriginGuard

HOST = "192.168.1.20:5260"


@pytest.fixture(autouse=True)
def pin(monkeypatch):
    monkeypatch.setattr(LanAccess, "_loaded", True)
    monkeypatch.setattr(LanAccess, "enabled", True)
    monkeypatch.setattr(LanAccess, "pin", "123456")
    monkeypatch.setattr(LanAccess, "key", "k" * 32)
    monkeypatch.setattr(LanAccess, "_misses", {})
    monkeypatch.setattr(LanAccess, "_save", classmethod(lambda cls: None))
    # 192.168.1.20 is this machine; anything else is another device.
    monkeypatch.setattr(Network, "_self_cache", {"192.168.1.20": True, "127.0.0.1": True})
    monkeypatch.setattr(Network, "is_self_client", classmethod(lambda cls, ip: ip in ("192.168.1.20", "127.0.0.1")))


def _app():
    app = FastAPI()

    @app.get("/")
    async def console():
        return {"console": True}

    @app.get("/layout/x.html")
    async def layout(request: Request):
        return {"layout": True}

    @app.post("/api/v1/scoreboards/reset")
    async def write():
        return {"reset": True}

    return app


def client_from(ip):
    inner = OriginGuard(_app())

    async def as_ip(scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope = {**scope, "client": (ip, 50000)}
        await inner(scope, receive, send)

    return TestClient(as_ip, base_url=f"http://{HOST}", follow_redirects=False)


def test_the_prsh_computer_never_needs_the_pin():
    c = client_from("127.0.0.1")
    assert c.get("/").status_code == 200
    assert c.post("/api/v1/scoreboards/reset").status_code == 200
    assert client_from("192.168.1.20").get("/").status_code == 200


def test_another_device_gets_the_pin_page_and_no_api():
    c = client_from("192.168.1.40")
    page = c.get("/", headers={"accept": "text/html"})
    assert page.status_code == 401 and "Enter the PRSH PIN" in page.text
    assert c.post("/api/v1/scoreboards/reset").status_code == 401


def test_the_right_pin_sets_a_cookie_that_lets_the_device_in():
    c = client_from("192.168.1.40")
    r = c.post(f"{UNLOCK_PATH}?next=/", data={"pin": "123456"}, headers={"Origin": f"http://{HOST}"})
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert c.cookies.get(COOKIE) == "k" * 32
    assert c.post("/api/v1/scoreboards/reset").status_code == 200


def test_a_wrong_pin_is_refused_and_guessing_locks_out():
    c = client_from("192.168.1.40")
    h = {"Origin": f"http://{HOST}"}
    for _ in range(5):
        assert 'class="err"' in c.post(f"{UNLOCK_PATH}?next=/", data={"pin": "000000"}, headers=h).text
    locked = c.post(f"{UNLOCK_PATH}?next=/", data={"pin": "123456"}, headers=h)
    assert locked.status_code == 401 and "Too many tries" in locked.text


def test_the_unlock_never_redirects_off_site():
    c = client_from("192.168.1.40")
    r = c.post(f"{UNLOCK_PATH}?next=//evil.example/", data={"pin": "123456"}, headers={"Origin": f"http://{HOST}"})
    assert r.headers["location"] == "/"


def test_obs_gets_in_with_the_key_in_its_url_and_keeps_a_cookie():
    c = client_from("192.168.1.40")
    r = c.get(f"/layout/x.html?scoreboard=1&key={'k' * 32}")
    assert r.status_code == 200
    assert COOKIE in r.headers.get("set-cookie", "")
    # The cookie is what the page's own fetches and socket ride on.
    assert c.post("/api/v1/scoreboards/reset").status_code == 200
    # Without it, a wrong key is no key.
    assert client_from("192.168.1.40").get("/layout/x.html?key=wrong").status_code == 401


def test_a_pin_that_is_off_changes_nothing(monkeypatch):
    monkeypatch.setattr(LanAccess, "enabled", False)
    assert client_from("192.168.1.40").post("/api/v1/scoreboards/reset").status_code == 200


# ── the key travels with OBS sources on another computer ─────────────────────

@pytest.fixture
def machines(monkeypatch):
    monkeypatch.setattr(net, "_route_source", lambda ip: ip if ip == "192.168.1.20" else "192.168.1.20")
    monkeypatch.setattr(sa, "lan_addresses", lambda peer=None: ["192.168.1.20"])


def test_a_remote_obs_source_gains_the_key_and_keeps_its_address(machines):
    url = "http://192.168.1.20:5260/layout/x.html?scoreboard=1"
    r = sa.repair([url], "192.168.1.40", "127.0.0.1", 5260, True, key="K")
    assert r["fixed"] == {url: "http://192.168.1.20:5260/layout/x.html?scoreboard=1&key=K"}


def test_a_regenerated_pin_replaces_the_old_key(machines):
    url = "http://192.168.1.20:5260/layout/x.html?key=OLD&size=l"
    r = sa.repair([url], "192.168.1.40", "127.0.0.1", 5260, True, key="NEW")
    assert r["fixed"][url] == "http://192.168.1.20:5260/layout/x.html?size=l&key=NEW"


def test_a_local_obs_needs_no_key(machines):
    url = "http://127.0.0.1:5260/layout/x.html"
    assert sa.repair([url], "127.0.0.1", "127.0.0.1", 5260, True, key="K")["fixed"] == {}


def test_a_device_at_the_pin_page_still_counts_as_reaching_prsh(monkeypatch):
    # The firewall question: it got through, whether or not it knows the PIN.
    monkeypatch.setattr(Network, "last_remote", None)
    client_from("192.168.1.40").get("/", headers={"accept": "text/html"})
    assert Network.last_remote[0] == "192.168.1.40"

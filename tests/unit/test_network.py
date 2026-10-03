"""The Network card's readout — the setting vs the live bind, and LAN addresses."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.api import router_v1
from server.network import Network, lan_addresses
from server.settings import Settings


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_v1)
    yield TestClient(app)
    Network.bound_host = None
    Network.port = None


def test_unknown_bind_reports_null_not_a_pending_restart(client):
    Network.bound_host = None
    body = client.get("/api/v1/network").json()
    assert body["lan_bound"] is None


def test_setting_ahead_of_the_bind_is_visible(client):
    Settings.settings.setdefault("server", {})["allow_lan"] = True
    Network.set_bound("127.0.0.1", 5260)
    body = client.get("/api/v1/network").json()
    assert body["allow_lan"] is True
    assert body["lan_bound"] is False
    assert body["port"] == 5260


def test_lan_bind(client):
    Network.set_bound("0.0.0.0", 5299)
    body = client.get("/api/v1/network").json()
    assert body["lan_bound"] is True
    assert body["port"] == 5299


def test_addresses_never_offer_loopback():
    for ip in lan_addresses():
        assert not ip.startswith("127.")
        assert ip != "0.0.0.0"


class _FakeSock:
    def __init__(self, ip): self.ip = ip
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def connect(self, addr): pass
    def getsockname(self): return (self.ip, 0)


def _hostname_resolves_to(monkeypatch, *ips):
    import server.network as net
    monkeypatch.setattr(net.socket, "getaddrinfo",
                        lambda *a, **k: [(2, 2, 17, "", (ip, 0)) for ip in ips])


def test_a_machine_on_two_interfaces_offers_one_address(monkeypatch):
    # Wi-Fi and Ethernet on the same subnet: the hostname resolves to both,
    # and the card must still show one URL — the routed one.
    import server.network as net
    monkeypatch.setattr(net.socket, "socket", lambda *a, **k: _FakeSock("192.168.1.75"))
    _hostname_resolves_to(monkeypatch, "127.0.0.1", "192.168.1.78", "192.168.1.75")
    assert lan_addresses() == ["192.168.1.75"]


def test_hostname_lookup_is_only_the_fallback(monkeypatch):
    import server.network as net

    def no_route(*a, **k):
        raise OSError("no route")
    monkeypatch.setattr(net.socket, "socket", no_route)
    _hostname_resolves_to(monkeypatch, "127.0.0.1", "10.0.0.4", "10.0.0.9")
    assert lan_addresses() == ["10.0.0.4"]


def _routes(monkeypatch, table):
    """Route each probe/peer destination to a source address (None = no route)."""
    import server.network as net
    monkeypatch.setattr(net, "_route_source", lambda dest: table.get(dest))


def test_a_vpn_capturing_one_range_does_not_win(monkeypatch):
    # A work VPN claims 10/8 and Tailscale answers elsewhere; the Wi-Fi is
    # still what the 192.168 probe reaches, and it is the one a phone can use.
    _routes(monkeypatch, {"192.168.255.255": "192.168.1.20", "10.255.255.255": "100.101.5.6"})
    _hostname_resolves_to(monkeypatch)
    assert lan_addresses() == ["192.168.1.20"]


def test_a_non_private_route_is_a_last_resort(monkeypatch):
    _routes(monkeypatch, {"10.255.255.255": "100.101.5.6"})
    _hostname_resolves_to(monkeypatch, "100.101.5.6")
    assert lan_addresses() == ["100.101.5.6"]


def test_a_private_hostname_address_beats_a_vpn_route(monkeypatch):
    _routes(monkeypatch, {"10.255.255.255": "100.101.5.6"})
    _hostname_resolves_to(monkeypatch, "100.101.5.6", "192.168.1.20")
    assert lan_addresses() == ["192.168.1.20"]


def test_a_peer_gets_the_interface_that_reaches_it(monkeypatch):
    # OBS sits on the VPN: the VPN address is the RIGHT answer for it, even
    # though the Network card (no peer) would offer the Wi-Fi.
    _routes(monkeypatch, {"100.70.0.9": "100.101.5.6", "192.168.255.255": "192.168.1.20"})
    _hostname_resolves_to(monkeypatch)
    assert lan_addresses("100.70.0.9") == ["100.101.5.6"]
    assert lan_addresses() == ["192.168.1.20"]


def test_link_local_is_never_offered(monkeypatch):
    # A self-assigned 169.254 address means DHCP failed; nothing can reach it.
    _routes(monkeypatch, {})
    _hostname_resolves_to(monkeypatch, "169.254.3.4")
    assert lan_addresses() == []

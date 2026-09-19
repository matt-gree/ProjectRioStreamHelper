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

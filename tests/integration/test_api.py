"""API surface via FastAPI TestClient (in-process, no running server).

socketio.emit is mocked and all disk paths are redirected to tmp (conftest), so
these exercise the real routers without a network or touching user_data.
"""
import platform

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.api import router_v1
from server.settings import Settings


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_v1)
    return TestClient(app)


# --- /state ---

def test_put_then_get_state_key(client):
    client.put("/api/v1/state", params={"key": "score.1.batter", "value": "Mario"})
    r = client.get("/api/v1/state", params={"key": "score.1.batter"})
    assert r.status_code == 200
    assert r.json() == "Mario"


def test_get_full_state_includes_set_key(client):
    client.put("/api/v1/state", params={"key": "score.1.inning", "value": "5"})
    full = client.get("/api/v1/state").json()
    assert full["score"]["1"]["inning"] == "5"


def test_put_state_emits_set_frame(client, mock_socket):
    client.put("/api/v1/state", params={"key": "a.b", "value": "v"})
    events = [c.args[0] for c in mock_socket.await_args_list]
    assert "v1.state.set" in events


# --- /settings (secret redaction) ---
# SECRET_KEYS is currently empty, so these patch in a fake secret key to keep
# the API-layer redaction paths covered. The per-key GET reads the copy
# imported into server.api.v1.settings; the full GET reads server.settings.

@pytest.fixture
def fake_secret(monkeypatch):
    keys = frozenset({"myservice.api_key"})
    monkeypatch.setattr("server.settings.SECRET_KEYS", keys)
    monkeypatch.setattr("server.api.v1.settings.SECRET_KEYS", keys)


def test_settings_secret_get_returns_bool_not_value(client, set_setting, fake_secret):
    set_setting("myservice.api_key", "supersecret")
    r = client.get("/api/v1/settings", params={"key": "myservice.api_key"})
    # Secret keys never leave the server as raw values — just whether configured.
    assert r.json() is True


def test_settings_full_get_redacts_secret(client, set_setting, fake_secret):
    set_setting("myservice.api_key", "supersecret")
    full = client.get("/api/v1/settings").json()
    assert full["myservice"]["api_key"] == "***"


def test_settings_nonsecret_round_trips(client):
    client.put("/api/v1/settings", params={"key": "lang", "value": "fr-FR"})
    assert client.get("/api/v1/settings", params={"key": "lang"}).json() == "fr-FR"
    assert Settings.Get("lang") == "fr-FR"


# --- /layouts (variant matrix against the real public/layout tree) ---

def test_layouts_variant_matrix(client):
    layouts = client.get("/api/v1/layouts").json()
    by_type = {}
    for entry in layouts:
        by_type.setdefault(entry["type"], []).append(entry)

    # Scoreboard expands into the size variants (xs/xl retired with the SVG
    # conversion; the mount maps unknown/legacy sizes to "l").
    assert len(by_type["scoreboard"]) == 3
    assert {e["sizeVariant"] for e in by_type["scoreboard"]} == {"s", "m", "l"}
    assert all("?size=" in e["url"] for e in by_type["scoreboard"])

    # Team-variant layouts expand into ?team=1 / ?team=2. The controller
    # layout is macOS-only (gc-overlay gating): present and expanded on
    # Darwin, omitted from the catalog everywhere else — CI runs Linux.
    team_types = ["stats", "roster", "teamlogo"]
    if platform.system() == "Darwin":
        team_types.append("controller")
    else:
        assert "controller" not in by_type
    for t in team_types:
        assert len(by_type[t]) == 2, t
        assert {e["team"] for e in by_type[t]} == {1, 2}
        assert all("?team=" in e["url"] for e in by_type[t])


def test_layouts_scoreboard_exposes_supported_settings(client):
    layouts = client.get("/api/v1/layouts").json()
    sb = next(e for e in layouts if e["type"] == "scoreboard")
    # scoreboard.html declares <meta name="overlay-settings"> → whitelist present.
    assert "supportedSettings" in sb
    assert isinstance(sb["supportedSettings"], list) and sb["supportedSettings"]


def test_layouts_bracket_has_dimensions(client):
    layouts = client.get("/api/v1/layouts").json()
    brackets = [e for e in layouts if e["type"] == "bracket"]
    assert brackets  # index/winners_only/losers_only/player_schedule
    assert all("width" in e and "height" in e for e in brackets)


# --- /rio/swap ---

def test_rio_swap_toggles_sides(client):
    from server.rio.provider import RioGameDataProvider
    assert RioGameDataProvider._sides_swapped is False
    r = client.post("/api/v1/rio/swap")
    assert r.status_code == 200
    assert r.json()["sides_swapped"] is True
    assert RioGameDataProvider._sides_swapped is True


# --- /logs/tail (path-traversal guard) ---

def test_logs_tail_rejects_traversal(client):
    assert client.get("/api/v1/logs/tail", params={"name": "../etc/passwd"}).status_code == 404


def test_logs_tail_missing_file_404(client):
    assert client.get("/api/v1/logs/tail", params={"name": "nope.txt"}).status_code == 404


def test_logs_tail_reads_valid_file(client, monkeypatch, tmp_path):
    # Redirect the logs dir so we don't write into the repo's ./logs.
    from server.api.v1 import logs as logs_mod
    monkeypatch.setattr(logs_mod, "_logs_dir", lambda: tmp_path)
    (tmp_path / "app.log").write_text("line one\nline two\n")
    r = client.get("/api/v1/logs/tail", params={"name": "app.log"})
    assert r.status_code == 200
    assert "line two" in r.json()["text"]

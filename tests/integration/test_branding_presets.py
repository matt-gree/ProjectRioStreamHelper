"""A design PRESET carries its logo: captured on save, restored on apply.

Applying a preset REPLACES what it covers, so a preset saved with no logo takes the
live one down — otherwise switching from one tournament's preset to another still
shows the first tournament's logo.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import server.api.v1.branding as branding
from server.api import router_v1
from server.settings import Settings

PNG_A = b"\x89PNG\r\n\x1a\nAAAA"
PNG_B = b"\x89PNG\r\n\x1a\nBBBB"


@pytest.fixture
def client(tmp_path, monkeypatch):
    root = tmp_path / "branding"
    monkeypatch.setattr(branding, "_branding_dir", root)
    monkeypatch.setattr(branding, "_logo_path", root / "tournament_logo.png")
    monkeypatch.setattr(branding, "_presets_dir", root / "presets")
    Settings.settings = {"overlays": {"global": {}}}
    app = FastAPI()
    app.include_router(router_v1)
    return TestClient(app)


def upload(client, data):
    return client.post("/api/v1/branding/logo", files={"file": ("logo.png", data, "image/png")})


def live_logo():
    p = branding._logo_path
    return p.read_bytes() if p.is_file() else None


def test_capture_then_apply_round_trips_the_logo(client):
    upload(client, PNG_A)
    assert client.post("/api/v1/branding/presets/slice-26/logo/capture").json()["logo"] is True
    upload(client, PNG_B)
    assert live_logo() == PNG_B
    client.post("/api/v1/branding/presets/slice-26/logo/apply")
    assert live_logo() == PNG_A


def test_a_preset_saved_without_a_logo_removes_the_live_one(client):
    assert client.post("/api/v1/branding/presets/bare/logo/capture").json()["logo"] is False
    upload(client, PNG_A)
    r = client.post("/api/v1/branding/presets/bare/logo/apply").json()
    assert r["exists"] is False and live_logo() is None


def test_recapturing_with_no_logo_forgets_the_old_one(client):
    upload(client, PNG_A)
    client.post("/api/v1/branding/presets/x/logo/capture")
    client.delete("/api/v1/branding/logo")
    assert client.post("/api/v1/branding/presets/x/logo/capture").json()["logo"] is False


def test_every_logo_change_bumps_the_revision_overlays_cache_bust_on(client):
    upload(client, PNG_A)
    first = Settings.Get("overlays.global.logoRev")
    client.post("/api/v1/branding/presets/y/logo/capture")
    assert Settings.Get("overlays.global.logoRev") == first  # capture changes nothing on air
    upload(client, PNG_B)
    client.post("/api/v1/branding/presets/y/logo/apply")
    assert Settings.Get("overlays.global.logoRev") == first + 2


def test_rejects_an_id_that_could_escape_the_presets_folder(client):
    assert client.post("/api/v1/branding/presets/..%2Fetc/logo/capture").status_code in (400, 404)
    assert client.post("/api/v1/branding/presets/UPPER/logo/capture").status_code == 400


def test_import_stores_a_logo_for_a_preset(client):
    r = client.put("/api/v1/branding/presets/imported/logo", files={"file": ("l.png", PNG_B, "image/png")})
    assert r.json()["logo"] is True
    client.post("/api/v1/branding/presets/imported/logo/apply")
    assert live_logo() == PNG_B

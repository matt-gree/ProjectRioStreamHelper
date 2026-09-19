"""The header that decides whether a producer's edit reaches OBS at all.

Nothing here throws when it is wrong. A missing `Cache-Control` just means the
browser picks its own freshness lifetime and stops asking, so the symptom is an
overlay that renders the version of a file it saw yesterday — in OBS only, while
the app and a pasted link both show the new one.
"""
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from server.http_cache import REVALIDATE, RevalidatingStaticFiles

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def app_module(tmp_path, monkeypatch):
    """The real app. Imported with user_data redirected: the module creates
    `branding/` under it at import time."""
    monkeypatch.setenv("PRSH_USER_DATA_DIR", str(tmp_path / "user_data"))
    import server.server as srv
    return srv


def test_every_tree_a_producer_edits_is_mounted_revalidating(app_module):
    """Asked of the app itself rather than of a list beside it — a list is what
    let the MSB route below ship without the header while its test passed."""
    from starlette.routing import Mount

    mounts = {r.path: r.app for r in app_module.app.routes if isinstance(r, Mount)}
    for path in ("/layout", "/branding", "/game_assets", "/rio-visualizer"):
        if path == "/rio-visualizer" and path not in mounts:
            continue  # submodule not checked out
        assert isinstance(mounts[path], RevalidatingStaticFiles), path


def test_vite_output_is_left_alone(app_module):
    """`/assets` is content-hashed, so the URL changes when the content does and
    revalidating it is pure cost. Only mounted once the frontend is built."""
    from starlette.routing import Mount

    mounts = {r.path: r.app for r in app_module.app.routes if isinstance(r, Mount)}
    if "/assets" in mounts:
        assert not isinstance(mounts["/assets"], RevalidatingStaticFiles)


@pytest.mark.asyncio
async def test_the_msb_pack_is_revalidated(app_module, tmp_path, monkeypatch):
    """The pack is served by a ROUTE, registered ahead of the /game_assets mount
    it shadows, so the mount's header never reached it — character icons and team
    logos, the files a producer most often replaces in place, were heuristically
    cached by OBS."""
    pack = tmp_path / "msb"
    (pack / "teamLogos").mkdir(parents=True)
    (pack / "teamLogos" / "Mario.png").write_bytes(b"png")

    async def pack_path():
        return pack

    monkeypatch.setattr(app_module, "get_msb_assets_path", pack_path)
    resp = await app_module.msb_asset("teamLogos/Mario.png")
    assert resp.headers["cache-control"] == REVALIDATE


def test_the_static_mount_sends_the_header_on_a_hit_and_on_a_304():
    """Both, because the 304 is the response a warm cache actually receives.

    Starlette builds `NotModifiedResponse` from the headers it has at that
    moment and forwards `cache-control` only if it is already among them — which
    is why this header is applied after the parent has decided, not before.
    """
    app = Starlette()
    app.mount("/layout", RevalidatingStaticFiles(directory=str(REPO / "public" / "layout")))
    client = TestClient(app)

    hit = client.get("/layout/lib/stats-card-mount.js")
    assert hit.status_code == 200
    assert hit.headers["cache-control"] == REVALIDATE

    fresh = client.get(
        "/layout/lib/stats-card-mount.js",
        headers={"if-none-match": hit.headers["etag"]},
    )
    assert fresh.status_code == 304
    assert fresh.headers["cache-control"] == REVALIDATE

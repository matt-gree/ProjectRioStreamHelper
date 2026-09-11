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

from server.http_cache import (
    REVALIDATE,
    REVALIDATE_PREFIXES,
    RevalidatingStaticFiles,
    must_revalidate,
)

REPO = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "path",
    [
        "/design/default/statscard.svg",       # theme SVGs — fetched as a subresource
        "/layout/scoreboard1/statsbar.html",   # overlay shells
        "/layout/lib/stats-card-mount.js",     # ...and their mounts, which have no build step
        "/branding/logo.png",                  # replaced in place, same filename
        "/game_assets/msb/teamLogos/Mario.png",
        "/rio-visualizer/renderer.js",
    ],
)
def test_a_tree_a_producer_edits_is_revalidated(path: str):
    assert must_revalidate(path)


@pytest.mark.parametrize("path", ["/assets/index-a1b2c3.js", "/api/v1/state", "/", "/favicon.png"])
def test_everything_else_is_left_alone(path: str):
    """`/assets` is the interesting one: Vite content-hashes it, so the URL
    changes when the content does and revalidating it is pure cost."""
    assert not must_revalidate(path)


def test_the_prefixes_are_prefixes():
    """A bare `/design` or a `/designs-of-mine` must not match — the trailing
    slash is what makes `startswith` safe to use here."""
    for prefix in REVALIDATE_PREFIXES:
        assert prefix.startswith("/") and prefix.endswith("/")
        assert not must_revalidate(prefix.rstrip("/") + "-elsewhere/x")


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

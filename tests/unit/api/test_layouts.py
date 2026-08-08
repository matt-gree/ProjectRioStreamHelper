"""Layout type derivation and HTML metadata parsing.

These drive the ``?size=`` / ``?team=`` variant expansion and the per-layout
settings whitelist that the Layouts tab reads — external contracts for OBS.
"""
import re

import orjson
import pytest

from server.api.v1.layouts import (
    _container_layouts, _derive_type, _parse_html_meta, layout_url, list_layouts,
)
from server.settings import Settings


# --- _derive_type ---

@pytest.mark.parametrize("stem,group,expected", [
    ("index", "bracket", "bracket"),       # bracket folder → always bracket
    ("winners_only", "bracket", "bracket"),
    ("losers_only", "bracket", "bracket"),
    ("scoreboard", "scoreboard1", "scoreboard"),
    ("stats", "scoreboard1", "stats"),
    ("roster", "scoreboard1", "roster"),
    ("teamlogo", "scoreboard1", "teamlogo"),
    ("ticker", "rotator", "ticker"),
    ("teamlogo2", "scoreboard1", "teamlogo"),  # trailing digit stripped
    ("controller", "controller", "controller"),
])
def test_derive_type(stem, group, expected):
    assert _derive_type(stem, group) == expected


def test_derive_type_all_digits_stem_falls_back_to_stem():
    # Stripping digits would empty the string; fall back to the original stem.
    assert _derive_type("123", "x") == "123"


# --- _parse_html_meta ---

def _write(tmp_path, body):
    p = tmp_path / "layout.html"
    p.write_text(body, encoding="utf-8")
    return p


def test_parse_html_meta_extracts_dims_and_settings(tmp_path):
    html = """
    <html><head>
    <meta name="overlay-settings" content="accentColor, showElo ,">
    <style>body { width: 600px; height: 200px; }</style>
    </head><body></body></html>
    """
    p = _write(tmp_path, html)
    w, h, supported = _parse_html_meta(p)
    assert (w, h) == (600, 200)
    # Whitespace trimmed, empty trailing token dropped.
    assert supported == ["accentColor", "showElo"]


def test_parse_html_meta_missing_meta_returns_none_supported(tmp_path):
    p = _write(tmp_path, "<style>body { width: 800px; height: 400px; }</style>")
    w, h, supported = _parse_html_meta(p)
    assert (w, h) == (800, 400)
    assert supported is None


def test_parse_html_meta_fluid_body_returns_none_dims(tmp_path):
    p = _write(tmp_path, "<style>body { width: 100%; height: 100%; }</style>")
    w, h, _ = _parse_html_meta(p)
    assert w is None and h is None


def test_parse_html_meta_unreadable_path_returns_all_none(tmp_path):
    missing = tmp_path / "does_not_exist.html"
    assert _parse_html_meta(missing) == (None, None, None)


def test_parse_html_meta_case_insensitive_meta(tmp_path):
    html = '<META NAME="overlay-settings" CONTENT="cardBg">' \
           '<style>body { width: 400px; height: 50px; }</style>'
    p = _write(tmp_path, html)
    _, _, supported = _parse_html_meta(p)
    assert supported == ["cardBg"]


# --- container catalog rows ---

# The definitions a fresh install ships with (server/settings.py); pinned in
# full by tests/unit/test_settings_containers.py.
SEEDED_CONTAINERS = {
    "callout-stage", "stats-feed", "split-screen",
    "roster-stats-1", "roster-stats-2",
}

async def test_container_rows_come_from_definitions_not_files(isolate_user_data):
    """A container is config, not a file.

    One generic shell renders every one of them, so the catalog cannot be built
    by walking `shared/`: it would offer one row for the shell and none for the
    containers. Rows come from `production.container_defs` instead, which is
    also the only place a container's name and native size live.
    """
    await Settings.Load()
    rows = _container_layouts("http://x")

    by_id = {r["container"]: r for r in rows}
    assert set(by_id) == SEEDED_CONTAINERS

    stage = by_id["callout-stage"]
    assert stage["group"] == "shared"
    assert stage["type"] == "container"
    assert stage["name"] == "Callout Stage"
    assert stage["url"] == "http://x/layout/shared/container.html?container=callout-stage"
    # The size OBS gets is the definition's, and it is the member roster that
    # decides it — not anything parsed out of the shell's CSS.
    assert (stage["width"], stage["height"]) == (1920, 1080)
    assert sorted(stage["members"]) == ["postgamecallout", "postgamevs"]


async def test_a_producer_built_container_gets_a_row(isolate_user_data):
    await Settings.Load()
    Settings.settings["production"]["container_defs"]["lower-bar"] = {
        "name": "Lower Bar", "width": 452, "height": 118, "members": ["stats"],
    }
    rows = {r["container"]: r for r in _container_layouts("http://x")}
    assert rows["lower-bar"]["name"] == "Lower Bar"
    assert rows["lower-bar"]["url"].endswith("?container=lower-bar")


async def test_a_malformed_definition_is_skipped_not_fatal(isolate_user_data):
    """Settings are user-editable JSON; one bad entry must not empty the catalog."""
    await Settings.Load()
    Settings.settings["production"]["container_defs"]["broken"] = "not a dict"
    rows = _container_layouts("http://x")
    assert "broken" not in {r["container"] for r in rows}
    assert len(rows) == len(SEEDED_CONTAINERS)


async def test_the_catalog_does_not_also_list_the_shared_folder(isolate_user_data):
    """The pre-2.0 named shells stay on disk so existing browser sources keep
    rendering, but offering them beside the definitions would list the same
    container twice."""
    await Settings.Load()

    class _Req:
        headers = {"host": "x"}

    payload = orjson.loads((await list_layouts(_Req())).body)
    shared = [row for row in payload if row["group"] == "shared"]
    assert {row["container"] for row in shared} == SEEDED_CONTAINERS
    # No row for the shell itself, and none for the legacy files.
    assert all(row["url"].endswith(f"?container={row['container']}") for row in shared)


# --- layout_url ---------------------------------------------------------
#
# A catalog URL is consumed twice: OBS loads it, and the element registry
# matches it. Only the first one forgives a native separator.

def test_layout_url_uses_forward_slashes_on_a_windows_path():
    """`str(Path)` renders with the NATIVE separator, so this had to be pinned
    with a PureWindowsPath — on a POSIX runner the bug is invisible and the
    assertion passes against the broken code."""
    from pathlib import PureWindowsPath
    url = layout_url("http://host:5260", PureWindowsPath("scoreboard1/roster.html"))
    assert url == "http://host:5260/layout/scoreboard1/roster.html"
    assert "\\" not in url


def test_layout_url_is_unchanged_for_posix_paths():
    from pathlib import PurePosixPath
    assert layout_url("http://h", PurePosixPath("rotator/ticker.html")) \
        == "http://h/layout/rotator/ticker.html"


@pytest.mark.parametrize("rel,pattern", [
    # The registry entries with no bare-filename fallback: these are the ones
    # that silently became "generic layout" rows when the URL carried a "\".
    ("scoreboard1/roster.html", r"/layout/scoreboard\d*/roster\.html"),
    ("schedule/schedule.html", r"/layout/schedule/"),
    ("bracket/index.html", r"/layout/bracket/(index|winners_only|losers_only)"),
    ("rotator/ticker.html", r"/layout/rotator/ticker"),
])
def test_windows_catalog_urls_still_match_the_element_registry(rel, pattern):
    from pathlib import PureWindowsPath
    url = layout_url("http://host:5260", PureWindowsPath(rel))
    assert re.search(pattern, url), f"{url!r} no longer matches {pattern!r}"

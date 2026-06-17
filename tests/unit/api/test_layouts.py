"""Layout type derivation and HTML metadata parsing.

These drive the ``?size=`` / ``?team=`` variant expansion and the per-layout
settings whitelist that the Layouts tab reads — external contracts for OBS.
"""
import pytest

from server.api.v1.layouts import _derive_type, _parse_html_meta


# --- _derive_type ---

@pytest.mark.parametrize("stem,group,expected", [
    ("gameplay", "scenes", "scene"),       # scenes folder → always scene
    ("rivalry", "scenes", "scene"),
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

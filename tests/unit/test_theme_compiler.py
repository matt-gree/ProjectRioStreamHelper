"""Theme compiler — the designer-export → conforming-theme pipeline.

Pins the layer-naming grammar, each normalization transform, the lint report,
and the two invariants that make the compiler safe to run on every install:
conforming files pass through byte-identical, and a compiler failure never
produces broken output (parse errors return the input untouched).

The round-trip test uses tests/data/design/matchup_figma_export.svg — the
default matchup theme with every data-* marker folded back into grammar layer
ids (underscore-mangled the way design tools export them), preserveAspectRatio
dropped, a fixed root size added, and a var() painted as a presentation
attribute. Compiling it must recover the full slot inventory of the original.
"""
import io
import zipfile
from pathlib import Path

import pytest

from server.theme_compiler import compile_svg, parse_grammar_id

REPO = Path(__file__).resolve().parents[2]
DEFAULT_MATCHUP = (REPO / "public" / "design" / "default" / "matchup.svg").read_text()
FIGMA_EXPORT = (REPO / "tests" / "data" / "design" / "matchup_figma_export.svg").read_text()


def _slots(svg_text: str) -> set[str]:
    import re
    return set(re.findall(r'data-slot="([^"]+)"', svg_text))


def _messages(report, level=None) -> str:
    return " | ".join(f.message for f in report.findings if level is None or f.level == level)


# ── grammar ──────────────────────────────────────────────────────────────

def test_grammar_slot_with_modifier():
    marker, name, attrs, problems = parse_grammar_id("slot=side1-name maxw=420")
    assert (marker, name) == ("slot", "side1-name")
    assert attrs == {"data-maxw": "420"}
    assert problems == []


def test_grammar_underscore_and_colon_separators():
    # Figma turns spaces into underscores; ':' works where '=' gets mangled
    assert parse_grammar_id("slot=title_maxw=520")[:2] == ("slot", "title")
    assert parse_grammar_id("slot:title maxw:520")[2] == {"data-maxw": "520"}


def test_grammar_case_normalized_and_tpl_band():
    assert parse_grammar_id("Slot=Side1-Name")[:2] == ("slot", "side1-name")
    marker, _, attrs, _ = parse_grammar_id("tpl=match w=620")
    assert (marker, attrs) == ("tpl", {"data-w": "620"})
    marker, _, attrs, _ = parse_grammar_id("band x=210 w=1500 h=170 align=center")
    assert marker == "band"
    assert attrs == {"data-x": "210", "data-w": "1500", "data-h": "170", "data-align": "center"}


def test_grammar_rejects_plain_ids_and_bare_band():
    assert parse_grammar_id("Rectangle 12") is None
    assert parse_grammar_id("side1-name") is None
    assert parse_grammar_id("band") is None  # a decorative layer named "band"


def test_grammar_reports_problems():
    _, name, _, problems = parse_grammar_id("slot=bad!name")  # '!' is not a valid name char
    assert problems and "invalid" in problems[0]
    _, _, _, problems = parse_grammar_id("slot=title glow=4")
    assert any("unknown modifier" in p for p in problems)


# ── transforms ───────────────────────────────────────────────────────────

def _mini(body: str, root_attrs: str = 'viewBox="0 0 1920 1080"') -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" {root_attrs}>{body}</svg>'


def test_translation_and_root_normalization():
    out, report = compile_svg(
        _mini('<text id="slot=side1-name_maxw=420">x</text>',
              'viewBox="0 0 1920 1080" width="1920" height="1080"'),
        "matchup",
    )
    assert 'data-slot="side1-name"' in out and 'data-maxw="420"' in out
    assert 'width="1920"' not in out
    assert 'preserveAspectRatio="xMidYMax meet"' in out
    assert report.changed


def test_existing_data_attrs_win_over_ids():
    out, _ = compile_svg(
        _mini('<text data-slot="subtitle" id="slot=side1-name">x</text>'), "matchup",
    )
    assert 'data-slot="subtitle"' in out and 'data-slot="side1-name"' not in out


def test_tpl_groups_move_into_defs():
    out, report = compile_svg(
        _mini('<g id="tpl=match_w=620"><text>t</text></g>'), "lowerthird",
    )
    defs_at = out.find("<defs")
    tpl_at = out.find('data-tpl="match"')
    assert defs_at != -1 and tpl_at > defs_at
    assert 'data-w="620"' in out
    assert "template group" in _messages(report)


def test_anim_modifier_translates():
    out, _ = compile_svg(
        _mini('<g id="slot=row-live anim=expand-right"/>', 'viewBox="0 0 600 200"'),
        "scoreboard-m",
    )
    assert 'data-slot="row-live"' in out and 'data-anim="expand-right"' in out


def test_layout_marker_lifts_to_root_and_is_dropped():
    out, report = compile_svg(
        _mini('<rect id="layout=absolute" x="0" y="0" width="1" height="1"/>'
              '<text id="slot=side1-name">x</text>',
              'viewBox="0 0 600 200"'),
        "scoreboard-m",
    )
    assert 'data-layout="absolute"' in out
    assert 'id="layout=absolute"' not in out  # marker layer removed
    assert 'data-slot="side1-name"' in out     # normal translation still runs
    assert "data-layout" in _messages(report)


def test_layout_marker_tolerates_figma_underscore_mangle():
    out, _ = compile_svg(
        _mini('<rect id="layout_stack"/>', 'viewBox="0 0 600 200"'), "scoreboard-m",
    )
    assert 'data-layout="stack"' in out


def test_var_paint_moves_to_style():
    out, report = compile_svg(
        _mini('<rect fill="var(--accent)" stroke="#fff"/>'), "matchup",
    )
    assert 'fill="var(--accent)"' not in out
    assert "fill:var(--accent)" in out
    assert 'stroke="#fff"' in out  # non-var paints untouched
    assert "silently do nothing" in _messages(report)


def test_comment_double_dash_defused():
    svg = _mini("<g/>").replace("<g/>", "<!-- side1 -- the left player --><g/>")
    out, report = compile_svg(svg, "matchup")
    assert "fixed '--'" in _messages(report)
    assert not any(f.level == "error" for f in report.findings)


def test_parse_error_returns_input_untouched():
    bad = "<svg><unclosed></svg>"
    out, report = compile_svg(bad, "matchup")
    assert out == bad
    assert any(f.level == "error" for f in report.findings)


def test_palette_app_sets_design_vars():
    out, _ = compile_svg(_mini("<g/>"), "matchup", palette="app")
    assert 'data-design-vars="app"' in out


# ── lint ─────────────────────────────────────────────────────────────────

def test_missing_required_slots_warned():
    _, report = compile_svg(_mini('<text data-slot="subtitle">x</text>'), "matchup")
    warns = _messages(report, "warn")
    assert "missing required slot" in warns and "side1-name" in warns


def test_unknown_slot_gets_suggestion():
    _, report = compile_svg(_mini('<text id="slot=side1-nmae">x</text>'), "matchup")
    assert "did you mean 'side1-name'?" in _messages(report, "warn")


def test_outlined_text_kind_check():
    _, report = compile_svg(_mini('<path id="slot=side1-name" d="M0 0"/>'), "matchup")
    assert "was the text outlined on export?" in _messages(report, "warn")


def test_canvas_mismatch_warned():
    _, report = compile_svg(
        _mini("<g/>", 'viewBox="0 0 800 600"'), "matchup",
    )
    assert "1920x1080" in _messages(report, "warn")


def test_callout_takes_no_slots():
    _, report = compile_svg(
        _mini('<text id="slot=side1-name">x</text>', 'viewBox="0 0 1920 1080"'), "callout",
    )
    assert "backdrop" in _messages(report, "warn")


def test_unknown_element_lints_nothing_but_translates():
    out, report = compile_svg(_mini('<text id="slot=anything">x</text>'), "mystery")
    assert 'data-slot="anything"' in out
    assert report.total is None
    assert "no contract" in _messages(report, "info")


# ── the two load-bearing invariants ──────────────────────────────────────

def test_conforming_default_matchup_is_a_byte_identical_noop():
    out, report = compile_svg(DEFAULT_MATCHUP, "matchup", filename="matchup.svg")
    assert out == DEFAULT_MATCHUP
    assert report.changed is False
    # default themes a subset of the full inventory (the away/home + seed slots
    # are for intro themes) — the invariant is zero warnings, not full coverage
    assert 0 < report.bound <= report.total
    assert not [f for f in report.findings if f.level in ("warn", "error")]


def test_figma_export_round_trip_recovers_the_theme():
    out, report = compile_svg(FIGMA_EXPORT, "matchup", filename="matchup.svg")
    assert report.changed
    assert not any(f.level == "error" for f in report.findings)
    # every slot the hand-authored original declared is recovered
    assert _slots(out) >= _slots(DEFAULT_MATCHUP)
    # auto-fit hints survived the id round-trip
    assert out.count("data-maxw=") == DEFAULT_MATCHUP.count("data-maxw=")
    # export quirks normalized
    assert 'width="1920"' not in out.split(">", 1)[0]
    assert 'preserveAspectRatio="xMidYMax meet"' in out
    assert 'fill="var(--accent)"' not in out


# ── install-path integration ─────────────────────────────────────────────

def test_install_zip_compiles_and_reports(monkeypatch, tmp_path):
    monkeypatch.setenv("PRSH_USER_DATA_DIR", str(tmp_path / "ud"))
    from server import design_packages

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("mytheme/package.json", '{"id": "mytheme", "name": "My Theme"}')
        zf.writestr("mytheme/matchup.svg", FIGMA_EXPORT)
    info = design_packages.install_zip(buf.getvalue())

    assert info["id"] == "mytheme"
    (entry,) = [r for r in info["report"] if r["file"] == "matchup.svg"]
    assert entry["changed"] is True
    assert entry["bound"] and entry["total"]
    installed = (tmp_path / "ud" / "design_packages" / "mytheme" / "matchup.svg").read_text()
    assert 'data-slot="side1-name"' in installed

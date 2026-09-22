"""The Figma round trip: shipped theme -> template -> compiled theme.

The template generator (server/figma_template.py) and the theme compiler
(server/theme_compiler.py) are inverses, and the whole designer workflow rests
on that. Nothing in either module's own tests can see a break in the seam
BETWEEN them: the generator can happily emit a layer name the compiler parses
into a different slot, and both files stay individually correct while the
designer's export silently loses a binding.

So these tests run the loop on every shipped theme, which is also what makes
them a live audit of the theme files themselves — the `box-away-R` slot that
no grammar id could express was found this way, not by reading either module.
"""
import collections
import re
from pathlib import Path

import pytest

from server.figma_template import (
    SEAM_SENTINELS,
    build_template,
    default_tokens,
    load_tokens,
    resolve_value,
    simplify_font,
)
from server.theme_compiler import compile_svg, parse_grammar_id

PACKAGES = Path("public/design")
SHIPPED = sorted(PACKAGES.glob("*/*.svg"))


def slot_counts(svg: str) -> collections.Counter:
    """Slot names as a MULTISET — several elements bind one name on many nodes
    (the lower third: 33 nodes across 20 names), and a set comparison would call
    it clean with every duplicate but one dropped."""
    return collections.Counter(re.findall(r'data-slot="([^"]+)"', svg))


@pytest.fixture(scope="module")
def tokens():
    return default_tokens()


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_round_trip_preserves_every_slot_node(src, tokens):
    """A designer's edit must not be able to lose a binding in transit."""
    shipped = src.read_text()
    template, treport = build_template(shipped, src.stem, tokens)
    assert not [f for f in treport.findings if f.level == "error"], treport.findings

    back, creport = compile_svg(template, src.stem)
    assert not [f for f in creport.findings if f.level == "error"], creport.findings
    assert slot_counts(back) == slot_counts(shipped)


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_every_shipped_slot_name_is_expressible_as_a_layer_name(src):
    """Figma keeps layer NAMES, not attributes, so a slot the grammar cannot
    spell cannot survive a design tool at all — and fails silently, because the
    compiler lowercases the name rather than rejecting it and the mount just
    finds nothing to fill. `box-away-R`/`box-home-R` were exactly this."""
    for name in set(re.findall(r'data-slot="([^"]+)"', src.read_text())):
        parsed = parse_grammar_id(f"slot={name}")
        assert parsed is not None, f"{name!r} is not a grammar id at all"
        marker, parsed_name, _, problems = parsed
        assert not problems, f"{name!r}: {problems}"
        assert parsed_name == name, (
            f"slot {name!r} round-trips through the layer-name grammar as "
            f"{parsed_name!r} — rename it to lowercase-with-dashes"
        )


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_template_carries_no_stylesheet_or_unresolved_var(src, tokens):
    """The two things Figma silently ignores. A template that still contains
    either is one the designer opens with black text and no fills."""
    template, _ = build_template(src.read_text(), src.stem, tokens)
    # Comments are stripped before the check: several themes *document* the
    # var() rule in an authored note, and that prose is not markup Figma reads.
    markup = re.sub(r"<!--.*?-->", "", template, flags=re.S)
    assert "<style" not in markup, "stylesheet CSS survives — Figma will not apply it"
    assert "var(" not in markup, "unresolved var() survives — Figma resolves no custom properties"


def test_seam_colours_survive_as_sentinels(tokens):
    """side1 and accent both resolve to Rio red live, so a template that baked
    side1 to its true value would compile back as accent — the two would swap on
    every round trip and a producer's accent change would repaint a player."""
    assert SEAM_SENTINELS["side1"] != tokens["--accent"]
    assert resolve_value("var(--side1)", tokens) == SEAM_SENTINELS["side1"]
    assert resolve_value("var(--accent)", tokens) == SEAM_SENTINELS["accent"]
    # a non-seam token resolves to its real value, through one level of alias
    assert resolve_value("var(--band)", tokens).lower() == "#0b0b12"


def test_var_fallback_is_used_when_the_token_is_unknown(tokens):
    assert resolve_value("var(--not-a-token, #ff00ff)", tokens) == "#ff00ff"


def test_font_stack_reduces_to_one_family():
    """Figma binds a text node to ONE font; handed a stack it substitutes."""
    assert simplify_font("'Rajdhani', 'Arial Narrow', sans-serif") == "Rajdhani"
    assert simplify_font("var-free, monospace") == "var-free"


def test_load_tokens_resolves_nested_aliases():
    tokens = load_tokens(":root{--a:#123456;--b:var(--a);--c:var(--b)}")
    assert tokens["--c"] == "#123456"


# --- modifiers, hidden state, meld guides ----------------------------------

# slot/part/tpl/band/layout are MARKERS — they ride as the layer name itself,
# and the compiler deliberately normalizes a band's value away. Everything else
# is a modifier, which has to ride as a token inside that name.
MARKER_ATTRS = {"data-slot", "data-part", "data-tpl", "data-band", "data-layout"}
_TAG_RE = re.compile(r"<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+\s*=\s*\"[^\"]*\")*)\s*/?>", re.S)
_ATTR_RE = re.compile(r"(data-[\w-]+)\s*=\s*\"([^\"]*)\"")


def strip_comments(svg: str) -> str:
    """Both files carry a long authored header, and the template's DOCUMENTS the
    grammar — so a bare `"scaffold" not in svg` reads the prose, not the markup."""
    return re.sub(r"<!--.*?-->", "", svg, flags=re.S)


def modifier_attrs(svg: str) -> collections.Counter:
    """Modifier name=value as a MULTISET, for the same reason slot_counts is one:
    many nodes carry the same modifier and a set would call it clean with every
    duplicate but one dropped."""
    return collections.Counter(
        (a, v) for a, v in _ATTR_RE.findall(svg) if a not in MARKER_ATTRS
    )


def marked_layers(svg: str):
    """(tag, {attr: value}) for every node carrying a marker — i.e. every node
    whose id the template rewrites into a layer name. An UNMARKED node keeps its
    data-* attributes through our two modules but has no name to carry them
    through Figma; that is a real risk, but not the one these tests describe."""
    for tag, attrs in _TAG_RE.findall(strip_comments(svg)):
        found = dict(_ATTR_RE.findall(attrs))
        if MARKER_ATTRS & set(found):
            yield tag, found


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_round_trip_preserves_every_modifier(src, tokens):
    """A slot that survives with its MODIFIER dropped is the silent half of the
    failure test_round_trip_preserves_every_slot_node catches: the node is still
    there, the binding it carried is not. `data-cardh`/`data-compact-h` were
    exactly this — the mount grew Scoreboard S's card to enclose the game-mode
    band, `_MODIFIERS` could spell neither attribute, and the round trip quietly
    returned a card that never grows. The stat card's four edge offsets and the
    lower third's caption-less logo box were the same bug in three more files."""
    shipped = src.read_text()
    template, _ = build_template(shipped, src.stem, tokens)
    back, _ = compile_svg(template, src.stem)
    missing = modifier_attrs(shipped) - modifier_attrs(back)
    assert not missing, f"modifier(s) lost in the round trip: {sorted(missing)}"


# Attributes the COMPILER writes from the package manifest rather than from a
# layer name. `data-design-vars` is set from `"palette": "app"` and lives on the
# root <svg>, which is the document in a design tool and not a layer at all — so
# there is nothing for it to ride on and nothing for the grammar to spell. It
# survives the round trip as a root attribute, which is what
# test_round_trip_preserves_every_modifier already checks; demanding a layer-name
# spelling for it would be demanding the wrong thing.
#
# It only surfaced here once a TOKEN SKIN declared `data-layout` as well: the
# root then carries a marker, so the rule below starts reading its other
# attributes. `default/scoreboard-s.svg` is the melding board with a fixed
# palette, `classic/scoreboard-s.svg` is the one with both.
MANIFEST_ATTRS = {"data-design-vars"}


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_every_modifier_on_a_marked_layer_is_expressible_as_a_layer_name(src):
    """The `box-away-R` test one axis over. Figma keeps names, not attributes, so
    a modifier the grammar cannot spell cannot survive a design tool — and fails
    silently, because nothing rejects it and the mount just reads no attribute."""
    from server.figma_template import _ATTR_TO_GRAMMAR

    for tag, attrs in marked_layers(src.read_text()):
        for attr in attrs:
            if attr in MARKER_ATTRS or attr in MANIFEST_ATTRS:
                continue
            assert attr in _ATTR_TO_GRAMMAR, (
                f"<{tag}> carries {attr}, which has no layer-name spelling — "
                "add it to theme_compiler._MODIFIERS"
            )


def test_a_modifier_whose_value_is_a_list_rides_on_commas():
    """A layer name is split on spaces, so `full=32 28 176 176` would parse as
    one modifier and three junk tokens. The designer sees commas; the mount,
    which splits on whitespace, gets its spaces back."""
    _, _, attrs, problems = parse_grammar_id("slot=logo full=32,28,176,176")
    assert not problems
    assert attrs["data-full"] == "32 28 176 176"


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_hidden_layers_are_revealed_for_editing_and_restored_on_compile(src, tokens):
    """A designer cannot style what the design tool draws as nothing, so the
    template shows these at full strength — but a reveal that compiled back would
    put a FINAL badge on every live game."""
    shipped = src.read_text()
    hidden = {
        attrs["data-slot"]
        for _, attrs in marked_layers(shipped)
        if attrs.get("data-slot") and _hidden_in(shipped, attrs["data-slot"])
    }
    if not hidden:
        pytest.skip("no slot authored invisible")

    template, _ = build_template(shipped, src.stem, tokens)
    for name in hidden:
        assert re.search(rf'id="slot={re.escape(name)}(?: [^"]*?)? hidden"', template), (
            f"{name!r} lost its `hidden` flag — it would ship permanently visible"
        )

    back, _ = compile_svg(template, src.stem)
    for name in hidden:
        assert _hidden_in(back, name), (
            f"{name!r} came back visible — the authored hidden state was lost"
        )


def _hidden_in(svg: str, slot: str) -> bool:
    """Is the node bound to `slot` authored at opacity 0? (Attribute order is not
    stable across the round trip, so look on both sides of the marker.)"""
    for m in re.finditer(rf'<[^>]*data-slot="{re.escape(slot)}"[^>]*>', strip_comments(svg)):
        if re.search(r'(?<!-)\bopacity="0"', m.group(0)):
            return True
    return False


def test_meld_stages_are_drawn_from_the_melding_attributes(tokens):
    """The guides exist so a static file can show a card that resizes; deriving
    them from the meld attributes is what stops them claiming an extent the mount
    would never actually grow to."""
    src = PACKAGES / "default" / "scoreboard-s.svg"
    template, report = build_template(src.read_text(), "scoreboard-s", tokens)
    # resting 232x128, the two expand-right segments (300, 380), the mode band (156)
    for label, w, h in [
        ("resting", 232, 128), ("row-inning", 300, 128),
        ("row-live", 380, 128), ("row-mode", 380, 156),
    ]:
        assert re.search(
            rf'id="scaffold=stage-{label}"[^>]*width="{w}"[^>]*height="{h}"', template
        ), f"stage {label} is not drawn at {w}x{h}"
    assert any("meld-stage guide" in f.message for f in report.findings)

    # ...and they are editing-only: nothing about them reaches the shipped theme.
    back = strip_comments(compile_svg(template, "scoreboard-s")[0])
    assert "scaffold" not in back and "stage-" not in back


def test_a_theme_that_does_not_meld_gets_no_stage_guides(tokens):
    """scoreboard-l is a stack theme: the mount reflows it, there is no compact
    extent to draw, and a guide would be inventing one."""
    src = PACKAGES / "default" / "scoreboard-l.svg"
    template, _ = build_template(src.read_text(), "scoreboard-l", tokens)
    assert "scaffold=stage-" not in strip_comments(template)


# --- stack-row preview placement -------------------------------------------

def row_transforms(svg: str) -> dict:
    out = {}
    for tag in re.findall(r"<g[^>]*>", strip_comments(svg)):
        slot = re.search(r'data-slot="(row-[^"]+)"', tag) or re.search(r'id="slot=(row-[^" ]+)', tag)
        if slot:
            t = re.search(r'transform="([^"]*)"', tag)
            out[slot.group(1)] = t.group(1) if t else None
    return out


@pytest.mark.parametrize("element,expected", [
    # card-bg y + the running sum of data-h. row-live and row-final are
    # ALTERNATES (a live game or a completed one), so they share one offset and
    # the taller of the two sets what comes after.
    # No row-final: the default Large board's completed-game meta moved into the
    # linescore's right-hand pane, so row-live has the offset to itself.
    ("scoreboard-l", {"row-top": 8, "row-live": 90,
                      "row-roster": 210, "row-box": 298}),
])
def test_stack_rows_are_previewed_where_the_mount_stacks_them(element, expected, tokens):
    """Authored at a local origin of 0, every row of a stack theme draws on top
    of every other one — the designer opens the file and the card they are meant
    to be designing is not in it."""
    src = PACKAGES / "default" / f"{element}.svg"
    template, report = build_template(src.read_text(), element, tokens)
    assert row_transforms(template) == {
        name: (None if y == 0 else f"translate(0,{y:g})") for name, y in expected.items()
    }
    for name, y in expected.items():
        assert f"at={y:g}" in template, f"{name} did not record where it was placed"
    assert not [f for f in report.findings if f.level == "warn"], report.findings


@pytest.mark.parametrize("src", SHIPPED, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_the_preview_placement_is_undone_on_compile(src, tokens):
    """`at=K` is template-only. A shipped theme that kept it would stack every
    row twice — once by the baked transform, once by the mount."""
    shipped = src.read_text()
    template, _ = build_template(shipped, src.stem, tokens)
    back, _ = compile_svg(template, src.stem)
    assert "data-at" not in back
    assert row_transforms(back) == row_transforms(shipped)


def test_a_design_tool_that_bakes_the_offset_is_corrected_on_an_inner_wrapper(tokens):
    """Figma may return the placement as a group transform or flattened into the
    contents. The correction cannot go back on the ROW group either way: the
    mount rewrites that transform on every relayout, so a fix parked there
    survives until the first one and the row then jumps a band down on air."""
    src = PACKAGES / "default" / "scoreboard-l.svg"
    template, _ = build_template(src.read_text(), "scoreboard-l", tokens)
    flattened = re.sub(r'<g transform="translate\(0,[\d.]+\)" (id="slot=row-)', r"<g \1", template)

    back, report = compile_svg(flattened, "scoreboard-l")
    assert row_transforms(back) == {
        "row-top": None, "row-live": None, "row-roster": None, "row-box": None,
    }
    assert re.search(
        r'data-slot="row-live"[^>]*>\s*<g transform="translate\(0,-90\)"', back
    ), "row-live's baked offset was not taken back off its contents"
    assert any("baked into their contents" in f.message for f in report.findings), (
        "a silent correction is the one thing worse than the bug"
    )


def test_a_nudge_the_designer_made_on_top_of_the_placement_survives(tokens):
    """Only the template's own K comes out. What the designer moved is theirs."""
    src = PACKAGES / "default" / "scoreboard-l.svg"
    template, _ = build_template(src.read_text(), "scoreboard-l", tokens)
    nudged = template.replace(
        '<g transform="translate(0,90)" id="slot=row-live',
        '<g transform="translate(4,102)" id="slot=row-live',
    )
    back, _ = compile_svg(nudged, "scoreboard-l")
    assert re.search(r'data-slot="row-live"[^>]*>\s*<g transform="translate\(4,12\)"', back)


def test_an_absolute_theme_is_never_re_placed(tokens):
    """Absolute themes are WYSIWYG — the mount honours the authored transforms,
    so moving a row would move it on air."""
    src = PACKAGES / "default" / "scoreboard-s.svg"
    template, _ = build_template(src.read_text(), "scoreboard-s", tokens)
    assert "at=" not in strip_comments(template)

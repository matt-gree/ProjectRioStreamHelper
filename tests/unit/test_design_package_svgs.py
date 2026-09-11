"""Invariants every built-in design package's theme SVG has to hold.

These pin two failure modes that produce a *plausible-looking* overlay rather
than an error, so neither shows up in a smoke test:

1. A tag inside a ``<style>`` block. The mounts inject theme SVGs with
   ``innerHTML``, and inside SVG a ``<style>`` element is NOT raw text — the
   HTML parser tokenises tags in it. One angle bracket, even inside a CSS
   comment, silently truncates every rule below it. The lower third's mushroom
   field lost its whole reduced-motion and defs-suppression block to this.

2. A hand-drawn Project Rio mark. The mark is real artwork with a specific
   pixel grid (the baseball stitching reads as noise if anyone "tidies" it), so
   packages inline it verbatim from the shipped asset rather than approximating
   it. The default lower third carried an approximation until 2026-07-31.
"""

import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
DESIGN = REPO / "public" / "design"
RIO_MARK = REPO / "public" / "game_assets" / "ProjectRio.svg"

PACKAGE_SVGS = sorted(DESIGN.glob("*/*.svg"))


def _rects(svg_text: str) -> list[str]:
    """Pixel rects, normalised so indentation and tag style don't count."""
    return [
        re.sub(r"\s+", " ", r).replace("></rect>", "/>").strip()
        for r in re.findall(r"<rect[^>]*(?:></rect>|/>)", svg_text)
    ]


def test_design_packages_are_present():
    # A glob that silently matches nothing would make every test below vacuous.
    assert PACKAGE_SVGS, "no theme SVGs found under public/design/*/"


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_style_blocks_carry_no_tags(svg: Path):
    for body in re.findall(r"<style[^>]*>(.*?)</style>", svg.read_text(), re.DOTALL):
        stray = [c for c in body if c in "<>"]
        assert not stray, (
            f"{svg.parent.name}/{svg.name}: angle bracket inside a <style> block. "
            "The HTML parser tokenises tags there even in comments, so every "
            "rule after it is dropped. Write it without brackets."
        )


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_rio_mark_is_only_drawn_on_its_own_pixel_grid(svg: Path):
    """The mark is a 16x16 grid painted with ``shape-rendering="crispEdges"``.

    At any size that is not a whole multiple of 16, the renderer snaps its rows
    to uneven widths and the baseball stitching reads as noise — worst at the
    logo size, where it looks like a corrupted asset rather than a design
    choice. Square, too: the grid is square, so a non-square box shears it.
    """
    for use in re.findall(r"<use\b[^>]*href=\"#rio-mark\"[^>]*/>", svg.read_text()):
        w = re.search(r'\bwidth="(\d+(?:\.\d+)?)"', use)
        h = re.search(r'\bheight="(\d+(?:\.\d+)?)"', use)
        if not w or not h:
            continue  # sized by CSS or inherited — not ours to police here
        wv, hv = float(w.group(1)), float(h.group(1))
        assert wv == hv, f"{svg.parent.name}/{svg.name}: #rio-mark drawn {wv}x{hv}, not square"
        assert wv % 16 == 0, (
            f"{svg.parent.name}/{svg.name}: #rio-mark drawn at {wv:g}px, which is not a "
            f"multiple of 16 ({wv / 16:.3f} grid pixels). Round to {round(wv / 16) * 16:g}."
        )


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_theme_svgs_are_well_formed_xml(svg: Path):
    """A theme is an SVG document, and it has to parse as one.

    The mounts inject these with ``innerHTML``, and the HTML parser is
    forgiving in exactly the ways that hide the mistake: an unclosed tag gets
    adopted somewhere plausible, and a ``--`` inside a comment (which XML
    forbids, and which is easy to write as soon as a comment mentions a CSS
    custom property by name) parses fine in a browser. It is every OTHER tool
    that then breaks — an editor, a linter, a converter, this suite's own
    parsing. Cheap to hold the line here.
    """
    try:
        ET.parse(svg)
    except ET.ParseError as e:
        pytest.fail(f"{svg.parent.name}/{svg.name}: not well-formed XML — {e}")


# The mark's first pixel row. Distinctive enough to spot a pasted copy, short
# enough not to care about attribute order elsewhere in the file.
MARK_SIGNATURE = '<rect x="5" y="0" width="6" height="1" fill="#000000"'


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_the_mark_is_inlined_as_a_symbol_not_as_a_scaled_group(svg: Path):
    """A package that draws the Rio mark declares it once and ``<use>``s it.

    Pasting the pixel data into a ``<g transform="scale(k)">`` is the failure
    this pins, and it is not a style objection: a scale factor is a free
    number, so it lands off the mark's 16px grid without anyone noticing (both
    matchup themes shipped at ``scale(6.875)`` — 110px — until 2026-08-01, and
    the stitching frayed). Sized through ``<use width= height=>`` instead, the
    grid rule above catches it, and the verbatim check below has one copy to
    compare rather than one per drawing site.
    """
    text = svg.read_text()
    if MARK_SIGNATURE not in text:
        return  # this theme doesn't draw the mark
    assert '<symbol id="rio-mark"' in text, (
        f"{svg.parent.name}/{svg.name}: the Rio mark's pixel data is inlined "
        "outside a <symbol id=\"rio-mark\">. Declare it once in <defs> and draw "
        "it with <use href=\"#rio-mark\" width= height=>, on the 16px grid."
    )


SVG_NS = "{http://www.w3.org/2000/svg}"

# The atmosphere layers a mount clones and clips per plate — the name plate's
# and, under it, the drawer's.
CLONED_FIELDS = ("field", "sub-field")


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_field_sprites_declare_the_bounds_their_mount_prunes_on(svg: Path):
    """A canvas-wide atmosphere layer says where each of its marks can reach.

    ``data-slot="field"`` / ``"sub-field"`` is the Commentary contract: one
    field authored across the whole canvas, of which each plate clips its own
    slice. The mount prunes the sprites a plate can't show, because a clip hides
    a mark but keeps its animation ticking and this app renders alongside the
    game — four plates' worth of un-pruned field is four times the cost of
    what's on screen.

    It prunes on authored ``data-l``/``data-r`` (the exact horizontal extremes
    of a sprite's sway). A sprite without them is KEPT, so forgetting them is
    invisible except on a frame-time graph. Hence this.
    """
    root = ET.parse(svg).getroot()
    for group in root.iter(f"{SVG_NS}g"):
        slot = group.get("data-slot")
        if slot not in CLONED_FIELDS:
            continue
        sprites = list(group)
        assert sprites, f'{svg.parent.name}/{svg.name}: data-slot="{slot}" holds no sprites'
        for sprite in sprites:
            assert sprite.get("data-l") and sprite.get("data-r"), (
                f"{svg.parent.name}/{svg.name}: a {slot} sprite declares no "
                f"data-l/data-r, so every plate pays to animate it whether or not "
                f"it can show it — {ET.tostring(sprite)[:120]!r}"
            )


# What a drawer's sprites and its badge get pointed at. Mirrors SUB_GLYPHS /
# FALLBACK_GLYPH in public/layout/lib/sub-glyph.js.
GLYPH_IDS = ("sub-glyph-x", "sub-glyph-youtube", "rio-mark")

SUB_PLATE_ELEMENTS = [p for p in PACKAGE_SVGS if p.name in ("commentary.svg", "playerplates.svg")]


@pytest.mark.parametrize("svg", SUB_PLATE_ELEMENTS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_a_drawer_that_wears_a_badge_can_draw_every_mark_it_offers(svg: Path):
    """The drawer's badge is bound by id, and the mount checks the id exists.

    That check is what lets a partial package degrade to plain text instead of
    a broken reference — but it also means a package that declares SOME of the
    marks silently shows nothing for the rest, and "nothing" is exactly what a
    field with no mark looks like. So a package that opts into the badge at all
    opts into all of it.

    A package with no ``data-part="sub-icon"`` is opting out entirely, which is
    fine and is what the token-skin tier does.
    """
    text = svg.read_text()
    if 'data-part="sub-icon"' not in text:
        return
    missing = [g for g in GLYPH_IDS if f'id="{g}"' not in text]
    assert not missing, (
        f"{svg.parent.name}/{svg.name}: draws a sub-plate badge but declares no "
        f"{', '.join(missing)}. A subField that maps to a missing symbol shows no "
        "badge at all, which is indistinguishable from a field that wears none."
    )


@pytest.mark.parametrize("svg", SUB_PLATE_ELEMENTS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_drawer_sprites_are_rebindable(svg: Path):
    """The drawer's field is authored as the house mark and REWRITTEN per slot.

    An X drawer drifts X marks — that is the whole reason the drawer has its own
    field rather than sharing the plate's. The mount finds the sprites by
    ``data-part="sub-glyph"``, so a sprite without it keeps drifting mushrooms
    while the badge two inches away says YouTube.
    """
    text = svg.read_text()
    if 'data-part="sub-icon"' not in text:
        return
    root = ET.parse(svg).getroot()
    uses = [
        u for g in root.iter(f"{SVG_NS}g") if g.get("data-slot") in ("sub-field",)
        for u in g.iter(f"{SVG_NS}use")
    ] or [
        # Player Plates authors its drawer fields in place (fixed geometry), so
        # they aren't a data-slot group; find them through the clip instead.
        u for g in root.iter(f"{SVG_NS}g") if g.get("data-part") == "sub-field"
        for u in g.iter(f"{SVG_NS}use")
    ]
    assert uses, f"{svg.parent.name}/{svg.name}: the drawer carries no field to rebind"
    for u in uses:
        assert u.get("data-part") == "sub-glyph", (
            f"{svg.parent.name}/{svg.name}: a drawer sprite is not marked "
            'data-part="sub-glyph", so the mount will leave it as the house mark '
            "while the badge beside it says something else."
        )


# The band elements: 1920 wide by the height of the card, so the producer places
# them vertically in OBS. Their mounts bottom-anchor the theme's box inside the
# source and crop the overflow, which is what keeps a full-canvas theme working.
BAND_ELEMENTS = ("commentary", "playerplates")

LAYOUTS = REPO / "public" / "layout"
ELEMENTS_JS = REPO / "src" / "routes" / "production" / "elements.js"


@pytest.mark.parametrize("element", BAND_ELEMENTS)
def test_band_element_size_agrees_across_every_runtime_that_states_it(element: str):
    """One box, stated in three places that never read each other.

    ``body { width/height }`` in the layout shell is what the layouts API
    reports and what OBS sizes a new browser source to; the console registry
    (``elements.js``) is what ``addBrowserSource`` passes; and the theme contract
    is what the design-package compiler lints a theme's canvas against. Nothing
    imports anything, so a size change lands in one of them and the other two
    keep quoting the old number — which is how Commentary once shipped a
    1280x200 source for a 1920-wide strip.
    """
    html = (LAYOUTS / element / f"{element}.html").read_text()
    body = re.search(r"body \{ width: (\d+)px; height: (\d+)px; \}", html)
    assert body, f"{element}.html: no `body {{ width: …px; height: …px; }}` to read"
    size = (int(body.group(1)), int(body.group(2)))

    from server.theme_contracts import CONTRACTS

    assert CONTRACTS[element].canvas == size, (
        f"{element}: theme_contracts says {CONTRACTS[element].canvas}, the layout's "
        f"body says {size}. Themes would be linted against the wrong canvas."
    )

    entry = re.search(
        rf"id: '{element}',(.*?)\n    \}},", ELEMENTS_JS.read_text(), re.DOTALL
    )
    assert entry, f"{element} is not registered in elements.js"
    w = re.search(r"\n        width: (\d+),", entry.group(1))
    h = re.search(r"\n        height: (\d+),", entry.group(1))
    assert w and h, f"{element}: elements.js declares no width/height"
    assert (int(w.group(1)), int(h.group(1))) == size, (
        f"{element}: elements.js registers {(int(w.group(1)), int(h.group(1)))}, the "
        f"layout's body says {size}. OBS sources would be created the wrong size."
    )


@pytest.mark.parametrize(
    "svg",
    [p for p in PACKAGE_SVGS if p.stem in BAND_ELEMENTS],
    ids=lambda p: f"{p.parent.name}/{p.name}",
)
def test_band_themes_declare_a_canvas_their_mount_can_place(svg: Path):
    """A band theme is either the card's own box or the old full canvas.

    Those are the two the mount handles: bottom-anchored, cropped. Anything else
    — a half-height canvas, a 16:9 crop someone exported by accident — is not
    caught by the eye, because the mount will happily pin it to the bottom and
    the result just looks mysteriously offset.
    """
    from server.theme_contracts import CONTRACTS

    contract = CONTRACTS[svg.stem]
    vb = ET.parse(svg).getroot().get("viewBox")
    assert vb, f"{svg.parent.name}/{svg.name}: no viewBox"
    _, _, w, h = (round(float(v)) for v in vb.replace(",", " ").split())
    allowed = (contract.canvas, *contract.alt_canvases)
    assert (w, h) in allowed, (
        f"{svg.parent.name}/{svg.name}: canvas {w}x{h} is none of "
        f"{', '.join(f'{a}x{b}' for a, b in allowed)}."
    )


LOWERTHIRDS = [p for p in PACKAGE_SVGS if p.name == "lowerthird.svg"]


@pytest.mark.parametrize("svg", LOWERTHIRDS, ids=lambda p: p.parent.name)
def test_logo_does_not_hold_space_for_a_caption_it_has_not_got(svg: Path):
    """A caption-less logo is centred in the band, not left floating above the
    gap its caption would have filled.

    The mount reads ``data-full="x y w h"`` off the logo's geometry node and
    swaps to it when the slot carries no title. BOTH halves have to declare it —
    the branding ``<image>`` and the theme's own default art — or the behaviour
    depends on whether the user happens to have uploaded a logo.

    The default art may be any single node the mount can resize (``<use>`` of an
    inlined symbol, a nested ``<svg>`` wrapping a composite); what matters is
    that exactly one of them carries the box.
    """
    text = svg.read_text()
    # One template's worth: from its opening tag to wherever the next template
    # starts. A lazy `.*?</g></g>` reaches past the end and swallows the match
    # template's sprites, which is how this test first "failed".
    tpl = re.search(r'<g data-tpl="logo"(.*?)(?=<g data-tpl=)', text, re.DOTALL)
    if not tpl:
        return  # a package need not offer a logo slot at all
    body = tpl.group(1)
    if 'data-slot="title"' not in body:
        return  # no caption under the logo, so no space to reclaim

    img = re.search(r"<image\b[^>]*data-slot=\"logo\"[^>]*>", body)
    assert img and "data-full=" in img.group(0), (
        f"{svg.parent.name}: the branding <image> declares no data-full, so a "
        "caption-less uploaded logo keeps the caption's space."
    )

    default_art = re.search(r'<g data-slot="logo-default">(.*?)</g>', body, re.DOTALL)
    assert default_art and "data-full=" in default_art.group(1), (
        f"{svg.parent.name}: logo-default declares no data-full on any node, so "
        "the caption-less box applies only when a logo has been uploaded."
    )


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_inlined_rio_mark_matches_the_shipped_asset(svg: Path):
    text = svg.read_text()
    block = re.search(r'<symbol id="rio-mark"[^>]*>(.*?)</symbol>', text, re.DOTALL)
    if not block:
        return  # a package is free not to use the mark
    assert _rects(block.group(1)) == _rects(RIO_MARK.read_text()), (
        f"{svg.parent.name}/{svg.name}: the inlined #rio-mark has drifted from "
        f"{RIO_MARK.relative_to(REPO)}. Re-inline the asset rather than editing "
        "the copy — it is the Project Rio logo, not decoration."
    )


# The shells that host a theme SVG have to define the token layer it paints
# with. Listed by hand rather than derived, because "which layouts can host a
# design-package element" is a runtime question (a container's roster is
# producer config) and the answer for the container shell is "any of them".
TOKEN_HOSTS = [
    REPO / "public" / "layout" / "shared" / "container.html",
    REPO / "public" / "layout" / "scoreboard1" / "statsbar.html",
    # These four host no theme SVG at all — they are here for the FACES. The
    # token layer's @import is the only place Rajdhani and Chivo Mono are
    # fetched, and `applyTypeRoles` skips fetching them precisely because every
    # shell links this file. Drop the link and the role var still resolves, so
    # the page renders — in the fallback stack, silently, one element out of
    # step with the rest of the show.
    REPO / "public" / "layout" / "scoreboard1" / "playername.html",
    REPO / "public" / "layout" / "eventheader" / "eventheader.html",
    REPO / "public" / "layout" / "postgame" / "spotlight.html",
    REPO / "public" / "layout" / "postgame" / "summary.html",
]


@pytest.mark.parametrize("shell", TOKEN_HOSTS, ids=lambda p: p.name)
def test_theme_hosting_shells_link_the_token_layer(shell: Path):
    """A theme SVG paints with ``var(--band)`` / ``var(--ink)`` / ``var(--accent)``.

    An unresolved custom property in a presentation style computes to the
    property's *initial* value — black fill, black stroke — so a shell that
    forgets ``rio-theme/tokens.css`` renders the card as a black rectangle with
    black text on it. Nothing throws, nothing logs, and the slots are all bound
    correctly; it just isn't there. The container shell shipped exactly that on
    2026-08-03, and it is the shell that stands in for EVERY container, so it
    can host any themed member a producer puts on a roster.

    The built-in `statscard` also carries a literal fallback on every var() —
    belt as well as braces — but a package author's file may not, and the fix
    belongs in the shell either way.
    """
    assert shell.exists(), f"{shell.relative_to(REPO)} is gone — update TOKEN_HOSTS"
    assert "rio-theme/tokens.css" in shell.read_text(), (
        f"{shell.relative_to(REPO)} hosts design-package SVGs but does not link "
        "/layout/lib/rio-theme/tokens.css. Every var() in those files will "
        "compute to black, silently."
    )


SCOREBOARD_SVGS = [p for p in PACKAGE_SVGS if p.name.startswith("scoreboard-")]


def test_scoreboard_sizes_are_transcribed():
    # Guard against the filter below going quiet if the files are ever renamed.
    assert SCOREBOARD_SVGS, "no scoreboard theme SVGs found"


@pytest.mark.parametrize("svg", SCOREBOARD_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_a_scoreboard_with_a_date_slot_also_has_the_slot_that_names_the_game(svg: Path):
    """``meta-date`` is the OPTIONAL half of the completed-game meta.

    The mount writes both slots with ``optional``, so a theme may omit either
    and the engine will not complain — and omitting both is a real choice
    Scoreboard S makes, having no completed-game meta at all.

    The combination that is never a choice is a date with no ``meta-main``: the
    board would draw a bare date and silently lose the stadium and the innings,
    which are the two facts that say WHICH game just ended. A date alone is the
    one thing on that pane nobody reads a scoreboard for.
    """
    text = svg.read_text(encoding="utf-8")
    if 'data-slot="meta-date"' not in text:
        return
    assert 'data-slot="meta-main"' in text, (
        f"{svg.parent.name}/{svg.name} declares meta-date without meta-main, so a "
        "completed game draws a date with no stadium or innings beside it"
    )


@pytest.mark.parametrize("svg", SCOREBOARD_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_a_live_stat_slot_is_declared_as_a_label_and_a_value(svg: Path):
    """The live row's stat cells are PAIRS, and half a pair renders as noise.

    ``s{T}-stat-{i}-label`` / ``-value`` are what the mount fills from
    ``RioData.getStatsLine`` — the same four headline stats the Stat Bar and
    Stat Card draw, for whoever side T has on the field. Both halves are
    optional, so a theme may leave the stats out entirely and the mount simply
    writes nothing.

    What it may not do is declare one half. A value with no label is four bare
    numbers a viewer cannot read; a label with no value is a column heading over
    empty space. Neither errors, and both look deliberate — the failure is a
    theme that ships looking finished.
    """
    text = svg.read_text(encoding="utf-8")
    for prefix in ("s1", "s2"):
        for i in range(4):
            has = {
                part: f'data-slot="{prefix}-stat-{i}-{part}"' in text
                for part in ("label", "value")
            }
            assert has["label"] == has["value"], (
                f"{svg.parent.name}/{svg.name}: {prefix}-stat-{i} declares "
                f"{'a value with no label' if has['value'] else 'a label with no value'}"
            )


# ─────────────────────────────────────────────────────────────────────────────
# TYPE ROLES
#
# `rio-theme/tokens.css` defines three type roles, and a producer can now point
# each at a font of their own (`overlays.global.displayFont` / `bodyFont` /
# `monoFont`). That makes the roles a CONTRACT rather than a convention: a node
# that reaches for a literal face, or for the wrong role, is a node the
# producer's Typography section silently cannot reach.
#
# Class names carry the role so a reviewer can read a theme's type off its
# markup. The suffix is the role:
#
#     -ink   primary text          --font-display
#     -lab   small caps labels     --font-display
#     -dim   secondary / meta      --font-body
#     -cap   a SENTENCE            --font-body
#     -num   a tabular VALUE       --font-mono   (+ tabular figures)
#
# `-cap` and `-num` are the pair worth understanding, because the cards carry
# both and the difference is not "does it contain digits". A VALUE is a number
# in a fixed cell; a SENTENCE is prose that happens to contain numbers, and the
# arithmetic runs the other way on it. Measured at weight 700, Chivo Mono's
# digit is 0.600em against Inter's 0.6465em WITH tabular figures (which a value
# has to set either way, so Inter never gets to spend its narrow `1`), and its
# `%` is 0.600 against Inter's 1.0156 — so the numeral face is NARROWER on
# every value these themes draw except a decimal, where one 0.33em period is
# the whole of its loss. On a sentence that inverts, because a sentence is
# mostly letters: the Scorecard's pitcher line is 305 units in body and 403 in
# mono at 16px in a 352 box, so mono auto-fit it to 14px for years.
# ─────────────────────────────────────────────────────────────────────────────

ROLE_FOR_SUFFIX = {
    "ink": "--font-display",
    "lab": "--font-display",
    "dim": "--font-body",
    "cap": "--font-body",
    "num": "--font-mono",
}
TYPE_ROLES = ("--font-display", "--font-body", "--font-mono")


def _uncommented(svg_text: str) -> str:
    """Markup with XML comments removed.

    Every theme documents its own slot contract in a comment, and those name
    the tags they describe (`side1-name <text>`), so a scan for text nodes that
    does not strip comments finds the documentation.
    """
    return re.sub(r"<!--.*?-->", "", svg_text, flags=re.S)


def _type_classes(svg_text: str) -> dict[str, str]:
    """`{class name: declaration body}` for every rule that sets a font."""
    out = {}
    for block in re.findall(r"<style[^>]*>(.*?)</style>", svg_text, re.S):
        for rule in re.finditer(r"\.([\w-]+)\s*\{([^}]*)\}", block):
            if "font-family" in rule.group(2):
                out[rule.group(1)] = rule.group(2)
    return out


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_a_type_class_binds_the_role_its_name_promises(svg: Path):
    for name, body in _type_classes(svg.read_text()).items():
        suffix = name.rsplit("-", 1)[-1]
        want = ROLE_FOR_SUFFIX.get(suffix)
        if want is None:
            continue  # outside the role vocabulary; nothing promised
        assert want in body, (
            f"{svg.parent.name}/{svg.name}: .{name} ends in -{suffix}, which "
            f"promises {want}, but binds: {body.strip()}\n"
            f"Either bind the role or rename the class — a name that lies about "
            f"its role is how the Stat Card ended up drawing its numbers in the "
            f"body face while the Stat Bar drew the same numbers in the numeral "
            f"face."
        )


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_every_text_node_paints_from_a_role(svg: Path):
    """No literal face, and no orphaned `--font-family`.

    A literal (`font-family="Inter"`) is what the Scoreboard-S export shipped
    with, which drew one package in two typefaces depending on which file you
    were looking at. `--font-family` is the retired single-font var: it now
    resolves to nothing, so a node still asking for it computes to the initial
    value and draws in the browser's default serif.
    """
    text = _uncommented(svg.read_text())
    classes = set(_type_classes(text))
    for node in re.findall(r"<text\b[^>]*>", text):
        fam = re.search(r'font-family\s*[:=]\s*"?\s*([^;"]*)', node)
        if fam:
            spec = fam.group(1)
            assert "--font-family" not in spec, (
                f"{svg.parent.name}/{svg.name}: a text node still binds the "
                f"retired --font-family. Pick a role: {', '.join(TYPE_ROLES)}."
            )
            assert any(r in spec for r in TYPE_ROLES), (
                f"{svg.parent.name}/{svg.name}: a text node names a literal "
                f"face ({spec.strip()}) instead of a role. The producer's "
                f"Typography settings cannot reach it."
            )
            continue
        # No inline family: it must be painted by one of this file's classes,
        # or by an ancestor that is. Only the former is checkable here, and a
        # node with neither is the silent case worth failing on.
        cls = re.search(r'class="([^"]*)"', node)
        assert cls and (set(cls.group(1).split()) & classes), (
            f"{svg.parent.name}/{svg.name}: a text node names neither a "
            f"font-family nor a class that sets one:\n  {node}"
        )


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_a_numeral_class_declares_tabular_figures(svg: Path):
    """A value that changes must not shove the thing beside it.

    This was free while the numeral role was guaranteed monospaced. It is not
    free any more: `monoFont` is a producer setting, and the moment it points
    at a proportional face an untagged score starts jittering as it ticks.
    """
    for name, body in _type_classes(svg.read_text()).items():
        if name.rsplit("-", 1)[-1] != "num":
            continue
        assert "tabular-nums" in body, (
            f"{svg.parent.name}/{svg.name}: .{name} is the numeral role but "
            f"does not declare `font-variant-numeric: tabular-nums`."
        )


LINE_BOX_ATTRS = ("data-x-labelled", "data-x-bare", "data-maxr")


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_a_left_aligned_caption_line_declares_all_three_edges(svg: Path):
    """Half of this rule is worse than none of it.

    A `line-text` that left-aligns beside its "Game" label authors BOTH left
    edges (with and without the label) against one right bound, because the
    label is bound only for a HUD game's line — see `lineTextBox` in
    mount-utils.js. Drop one through a design tool and the mount falls back to
    the theme's authored, centred geometry for the state that lost its edge
    only: the line would sit left-aligned while a game was on and jump back to
    centred the moment it ended. `lineTextBox` refuses a partial set for that
    reason; this is the other half of the same statement, said where a theme
    can be looked at.
    """
    for node in re.findall(r"<text[^>]*>", svg.read_text()):
        if 'data-slot="line-text"' not in node:
            continue
        present = [a for a in LINE_BOX_ATTRS if f"{a}=" in node]
        assert not present or len(present) == len(LINE_BOX_ATTRS), (
            f"{svg.parent.name}/{svg.name}: line-text declares "
            f"{', '.join(present)} but not "
            f"{', '.join(a for a in LINE_BOX_ATTRS if a not in present)}. "
            f"The mount honours all three or none."
        )


def test_no_two_packages_disagree_about_a_class_name():
    """One document can hold several themes at once, and CSS does not care.

    A container retains one LAYER per member it has stood up
    (`container-layers.js`), each holding an injected theme SVG — and an inline
    SVG's `<style>` is document-scoped. So two themes on one container's roster
    that use the same class name for different type are resolved by whichever
    mounted last. The Scorecard and the Stat Card shipped exactly that: both
    declared `.sc-num`, one mono and one body, and both are container members.
    """
    seen: dict[str, tuple[str, str]] = {}
    for svg in PACKAGE_SVGS:
        for name, body in _type_classes(svg.read_text()).items():
            role = next((r for r in TYPE_ROLES if r in body), None)
            where = f"{svg.parent.name}/{svg.name}"
            if name in seen and seen[name][1] != role:
                prior, prior_role = seen[name]
                pytest.fail(
                    f".{name} binds {prior_role} in {prior} and {role} in "
                    f"{where}. Whichever theme a container mounts LAST wins for "
                    f"both. Give one of them its own prefix."
                )
            seen.setdefault(name, (where, role))


@pytest.mark.parametrize("svg", PACKAGE_SVGS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_display_type_stays_within_the_weights_the_token_layer_loads(svg: Path):
    """Rajdhani is fetched at 500/600/700 — an 800 is synthesised, not loaded.

    A faux-bolded weight is a smeared outline at broadcast sizes, and it fails
    the way a missing weight always does: it renders, so nobody notices.
    """
    text = _uncommented(svg.read_text())
    display = {n for n, b in _type_classes(text).items() if "--font-display" in b}
    for node in re.findall(r"<text\b[^>]*>", text):
        spec = re.search(r'font-family\s*[:=]\s*"?\s*([^;"]*)', node)
        cls = re.search(r'class="([^"]*)"', node)
        is_display = (spec and "--font-display" in spec.group(1)) or (
            cls and (set(cls.group(1).split()) & display)
        )
        if not is_display:
            continue
        weight = re.search(r'font-weight\s*[:=]\s*"?\s*(\d+)', node)
        if weight and int(weight.group(1)) > 700:
            pytest.fail(
                f"{svg.parent.name}/{svg.name}: display type at weight "
                f"{weight.group(1)}, but the token layer loads Rajdhani at "
                f"500/600/700 only:\n  {node}"
            )

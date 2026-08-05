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
    REPO / "public" / "layout" / "scoreboard1" / "stats.html",
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

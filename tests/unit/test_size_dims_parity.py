"""Scoreboard canvas dims have one Python source of truth —
``theme_contracts.CONTRACTS["scoreboard-{size}"].canvas`` (consumed live by
``server/api/v1/layouts.py``) — but static JS and built-in theme SVGs carry
copies that can't import it. These tests regex-pin every copy to the contract
so a canvas change that misses one surface fails CI instead of silently
shipping a mis-sized OBS source (the classic/slice26 500×80 drift the 2.0.0
review caught).
"""

import re
from pathlib import Path

from server.theme_contracts import CONTRACTS

REPO = Path(__file__).resolve().parents[2]

SIZES = ("s", "l")


def _canvas(size: str) -> tuple[int, int]:
    return CONTRACTS[f"scoreboard-{size}"].canvas


def test_scoreboard_mount_size_dims_match_contracts():
    src = (REPO / "public/layout/lib/scoreboard-mount.js").read_text()
    block = re.search(r"SIZE_DIMS\s*=\s*\{(.*?)\};", src, re.DOTALL)
    assert block, "SIZE_DIMS literal not found in scoreboard-mount.js"
    entries = {
        size: (int(w), int(h))
        for size, w, h in re.findall(
            r"(\w+):\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}", block.group(1)
        )
    }
    assert set(entries) == set(SIZES)
    for size in SIZES:
        assert entries[size] == _canvas(size), f"SIZE_DIMS.{size} drifted"


def test_design_jsx_preview_rows_match_contracts():
    # The Design tab's preview tiles (PREVIEW_COLUMNS in design.jsx). A tile
    # quoting the wrong canvas hands the overlay the wrong viewport aspect.
    src = (REPO / "src/routes/layouts/design.jsx").read_text()
    for label, size in (("Scoreboard · Large", "l"), ("Scoreboard · Small", "s")):
        m = re.search(
            rf"label:\s*'{label}'.*?w:\s*(\d+),\s*h:\s*(\d+)", src
        )
        assert m, f"preview tile {label!r} not found in design.jsx"
        assert (int(m.group(1)), int(m.group(2))) == _canvas(size), (
            f"preview tile {label!r} drifted from scoreboard-{size} canvas"
        )


def test_production_elements_scoreboard_dims_match_contract():
    src = (REPO / "src/routes/production/elements.js").read_text()
    m = re.search(
        r"id:\s*'scoreboard'.*?width:\s*(\d+),\s*height:\s*(\d+)", src, re.DOTALL
    )
    assert m, "scoreboard element entry not found in elements.js"
    # The Production element's dedicated source is the default (large) scoreboard.
    assert (int(m.group(1)), int(m.group(2))) == _canvas("l")


def test_production_elements_scoreboard_size_table_matches_contracts():
    """The console's own size table — what the catalog tier OFFERS with no OBS.

    A fourth copy of the canvas dims, and the one a producer pastes into a
    browser source by hand, so it gets pinned like the other three.
    """
    src = (REPO / "src/routes/production/elements.js").read_text()
    block = re.search(r"sizes:\s*\[(.*?)\],\s*\n", src, re.DOTALL)
    assert block, "scoreboard `sizes` table not found in elements.js"
    entries = {
        size: (int(w), int(h))
        for size, w, h in re.findall(
            r"value:\s*'(\w+)'.*?width:\s*(\d+),\s*height:\s*(\d+)", block.group(1)
        )
    }
    # The offered sizes are the ones the layouts API expands (xs is retired).
    assert set(entries) == {"s", "l"}
    for size, dims in entries.items():
        assert dims == _canvas(size), f"elements.js sizes.{size} drifted"


def test_builtin_theme_svg_viewboxes_match_contracts():
    svgs = sorted((REPO / "public/design").glob("*/scoreboard-*.svg"))
    assert svgs, "no built-in scoreboard theme SVGs found"
    for svg in svgs:
        size = svg.stem.removeprefix("scoreboard-")
        m = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg.read_text())
        assert m, f"{svg}: viewBox not found"
        assert (int(m.group(1)), int(m.group(2))) == _canvas(size), (
            f"{svg.relative_to(REPO)} viewBox drifted from scoreboard-{size} canvas"
        )


# The designer-facing docs are the spec a theme is drawn against, so a canvas
# quoted there is as load-bearing as one in code — and it drifts the same way,
# silently (the 2.0.0 review found scoreboard-s quoted as both 500×80 and
# 388×128, and stats.svg as 325×120, against a real 388×156 / 452×118). These
# pin the two SPEC blocks; prose elsewhere may still cite a legacy canvas
# deliberately, e.g. the older 380×220 statscard that still renders centred.


def test_design_readme_tree_canvases_match_contracts():
    src = (REPO / "public/design/README.md").read_text()
    tree = re.search(r"```\n<package>/\n(.*?)```", src, re.DOTALL)
    assert tree, "package tree block not found in public/design/README.md"

    quoted = {
        element: (int(w), int(h))
        for element, w, h in re.findall(
            r"([\w-]+)\.svg.*?(\d+)×(\d+)", tree.group(1)
        )
    }
    assert quoted, "no element canvases quoted in the README package tree"
    unknown = set(quoted) - set(CONTRACTS)
    assert not unknown, f"README tree lists non-existent theme files: {sorted(unknown)}"
    for element, dims in quoted.items():
        assert dims == CONTRACTS[element].canvas, (
            f"README package tree: {element}.svg quoted at {dims[0]}×{dims[1]}, "
            f"contract says {CONTRACTS[element].canvas[0]}×{CONTRACTS[element].canvas[1]}"
        )


def test_designer_guide_scoreboard_row_matches_contracts():
    src = (REPO / "public/design/DESIGNER-GUIDE.md").read_text()
    row = re.search(r"\| Scoreboard \(([^)]*)\) \| ([^|]*)\|", src)
    assert row, "Scoreboard canvas row not found in DESIGNER-GUIDE.md"

    sizes = [s.strip() for s in row.group(1).split("/")]
    dims = [
        (int(w), int(h))
        for w, h in re.findall(r"(\d+)×(\d+)", row.group(2))
    ]
    assert sizes == list(SIZES), (
        f"DESIGNER-GUIDE lists scoreboard sizes {sizes}, offered sizes are {list(SIZES)}"
    )
    assert dims == [_canvas(s) for s in SIZES], (
        "DESIGNER-GUIDE scoreboard canvases drifted from the contracts"
    )


# ── the vertical Scorecard ──────────────────────────────────────────────────
# It stopped being a full-canvas source on 2026-09-06: the source is now the
# size of the CARD (496x766 — a 480-wide column inside an 8-unit gutter, by the
# tallest the melded stack gets). That move minted FIVE copies of one number —
# the mount's own constants, the layout's body size hint, the console registry,
# the container-member table and the built-in theme's viewBox — none of which
# can import the contract, and every one of which fails silently and plausibly.
# Same shape as the scoreboard pins above; same reason.


def _scorecard() -> tuple[int, int]:
    return CONTRACTS["scorecard"].canvas


def test_scorecard_mount_native_size_matches_contract():
    src = (REPO / "public/layout/lib/scorecard-mount.js").read_text()
    w = re.search(r"const NATIVE_W = (\d+);", src)
    h = re.search(r"const NATIVE_H = (\d+);", src)
    assert w and h, "NATIVE_W/NATIVE_H not found in scorecard-mount.js"
    assert (int(w.group(1)), int(h.group(1))) == _scorecard()


def test_scorecard_layout_body_size_matches_contract():
    """The `body { width/height }` hint is what the layouts API reports as the
    source's native size, so it is the number a producer's OBS source gets."""
    src = (REPO / "public/layout/scorecard/scorecard.html").read_text()
    m = re.search(r"body\s*\{\s*width:\s*(\d+)px;\s*height:\s*(\d+)px", src)
    assert m, "body size hint not found in scorecard.html"
    assert (int(m.group(1)), int(m.group(2))) == _scorecard()


def test_scorecard_production_element_dims_match_contract():
    src = (REPO / "src/routes/production/elements.js").read_text()
    m = re.search(
        r"id:\s*'scorecard'.*?width:\s*(\d+),\s*height:\s*(\d+)", src, re.DOTALL
    )
    assert m, "scorecard element entry not found in elements.js"
    assert (int(m.group(1)), int(m.group(2))) == _scorecard()


def test_scorecard_container_member_size_matches_contract():
    """A member has to FIT its container, so this number gates which containers
    can host the card at all."""
    src = (REPO / "public/layout/lib/container-members.js").read_text()
    m = re.search(r"scorecard:\s*\{\s*size:\s*\[(\d+),\s*(\d+)\]", src)
    assert m, "scorecard entry not found in container-members.js MEMBERS"
    assert (int(m.group(1)), int(m.group(2))) == _scorecard()


def test_builtin_scorecard_theme_viewbox_matches_contract():
    for svg in sorted((REPO / "public/design").glob("*/scorecard.svg")):
        m = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg.read_text())
        assert m, f"{svg}: viewBox not found"
        assert (int(m.group(1)), int(m.group(2))) == _scorecard(), (
            f"{svg.relative_to(REPO)} viewBox drifted from the scorecard canvas. "
            "The old 1920x1080 frame is an alt canvas for packages already in "
            "the wild, not a canvas to ship a built-in on."
        )

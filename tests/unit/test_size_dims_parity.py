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

SIZES = ("xs", "s", "m", "l")


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
    # PREVIEW_ROWS moved out of the layouts.jsx monolith into design.jsx when
    # that file was split along its show-time / install-time seam.
    src = (REPO / "src/routes/layouts/design.jsx").read_text()
    for label, size in (("Large Scoreboard", "l"), ("Small Scoreboard", "s")):
        m = re.search(
            rf"label:\s*'{label}'.*?w:\s*(\d+),\s*h:\s*(\d+)", src
        )
        assert m, f"PREVIEW_ROWS entry for {label!r} not found in design.jsx"
        assert (int(m.group(1)), int(m.group(2))) == _canvas(size), (
            f"PREVIEW_ROWS {label!r} drifted from scoreboard-{size} canvas"
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
    assert set(entries) == {"s", "m", "l"}
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

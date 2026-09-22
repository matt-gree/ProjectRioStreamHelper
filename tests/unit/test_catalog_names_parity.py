"""What the Add picker calls an element, and what the console calls it, are one name.

The producer meets an element twice: once as a row in the Add picker (named by
`server/api/v1/layouts.py`, from the layout file on disk) and once as a rack row
the moment that source exists (named by `ELEMENTS` in
`src/routes/production/elements.js`). Two runtimes, no import between them — the
same shape as `test_per_side_parity.py` and `test_size_dims_parity.py`, and the
same failure mode: silent drift that only a producer sees.

Drift is worse than a bare mismatch, because the server has THREE naming paths
and only one of them is a table. A size-variant layout is named from the file
stem, a team-variant one from `_DISPLAY_NAMES`, and everything else needs an
explicit `_STANDALONE_DISPLAY_NAMES` entry or it falls through to the raw stem —
which is how the Hit Visualizer came to read "hitvisualizer" in the picker and
"Hit Visualizer" in the rack, and how the Scorecard answered to two names at
once. A producer cannot tell a naming gap from a different element.
"""

import re
from pathlib import Path

from server.api.v1.layouts import (
    _DISPLAY_NAMES,
    _SHELVED_GROUPS,
    _SIZE_VARIANTS,
    _STANDALONE_DISPLAY_NAMES,
    _TEAM_VARIANTS,
    _derive_type,
)

REPO = Path(__file__).resolve().parents[2]


def _elements() -> list[dict]:
    """The registry's id/name/url/flavor, parsed the same way the sibling tests do."""
    src = (REPO / "src/routes/production/elements.js").read_text()
    body = src.split("export const ELEMENTS = [", 1)[1]
    out = []
    for block in re.split(r"\n    \{\n", body):
        got = {
            field: m.group(1)
            for field in ("id", "name", "url", "flavor")
            if (m := re.search(rf"^\s*{field}: '([^']*)',", block, re.M))
        }
        if {"id", "name", "url", "flavor"} <= got.keys():
            out.append(got)
    return out


def _catalog_name(url: str) -> tuple[str, str] | None:
    """(what the Add picker calls this layout, why), or None if it isn't offered.

    Mirrors `list_layouts` — deliberately, because a test that asked the route
    for the answer would pass whatever the route decided to do.
    """
    rel = Path(url.lstrip("/")).relative_to("layout")
    group, stem = str(rel.parent), rel.stem
    if group in _SHELVED_GROUPS or group == "shared":
        return None
    layout_type = _derive_type(stem, group)
    if layout_type in _SIZE_VARIANTS:
        return stem.capitalize(), "parentName (size variant)"
    if layout_type in _TEAM_VARIANTS:
        return _DISPLAY_NAMES.get(layout_type, layout_type.capitalize()), "_DISPLAY_NAMES"
    return (
        _STANDALONE_DISPLAY_NAMES.get(f"{group}/{stem}", stem),
        "_STANDALONE_DISPLAY_NAMES",
    )


def test_every_element_is_named_the_same_in_both_runtimes():
    checked = 0
    for el in _elements():
        # A fed element's canonical url is the generic container shell, and the
        # `shared` folder is never enumerated — containers are named by their
        # own definitions (`_container_layouts`), not by a file.
        if el["flavor"] == "fed":
            continue
        got = _catalog_name(el["url"])
        if got is None:
            continue
        catalog, source = got
        assert catalog == el["name"], (
            f"{el['id']}: Add picker says {catalog!r} ({source}), "
            f"rack row says {el['name']!r}"
        )
        checked += 1
    assert checked >= 12, "registry shape changed — the parser found almost nothing"


# A standalone display name with no element behind it. Empty on purpose rather
# than absent: an unregistered layout is a legal state (it rows through
# `genericElement`, keyed on its pathname), but naming one here is naming a row
# the console cannot open a panel for — so a name landing in this set is the
# argument for registering the layout, not for widening the exception.
UNREGISTERED: set[str] = set()


def test_no_display_name_outlives_its_element():
    urls = {el["url"] for el in _elements()}
    named = {
        key for key in _STANDALONE_DISPLAY_NAMES
        if f"/layout/{key}.html" not in urls
    }
    assert named == UNREGISTERED

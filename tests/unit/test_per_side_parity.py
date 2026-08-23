"""An element that comes in PAIRS is declared twice, in two runtimes.

`_TEAM_VARIANTS` (server/api/v1/layouts.py) expands a layout into two catalog
rows, which is how a producer ADDS the pair from the Add picker. `perSide`
(src/routes/production/elements.js) is what makes the console's catalog tier row
both sides with OBS closed. Same fact, two languages, no import between them —
so it is pinned here, the same way `test_size_dims_parity.py` pins the scoreboard
canvases across their three runtimes.

Drift in either direction is a silent half-loss: a `perSide` the server does not
offer is a row a producer cannot create, and a `_TEAM_VARIANTS` entry with no
`perSide` is an element whose side 2 disappears the moment OBS closes — which is
exactly the state the Roster, Player Name, Team Logo and Controller were in.
"""

import re
from pathlib import Path

from server.api.v1.layouts import _TEAM_VARIANTS

REPO = Path(__file__).resolve().parents[2]

# Every `?team=` layout now has an element declaring `perSide`, and this set is
# empty on purpose rather than deleted: an unregistered team-variant layout is a
# legal state (it rows through `genericElement` online, keyed on its pathname)
# and it is a state a producer pays for, because a generic row has no stage
# panel, no preview and no catalog row with OBS closed. `stats` was the one
# entry here — the console's `stats` element used to be the fed bar at
# /layout/shared/stats-feed.html while /layout/scoreboard1/stats.html, the
# overlay a broadcast actually uses, matched nothing. If a name lands here
# again, this comment is the argument for registering it rather than widening
# the exception.
UNREGISTERED: set[str] = set()


def _per_side_element_ids() -> set[str]:
    src = (REPO / "src/routes/production/elements.js").read_text()
    body = src.split("export const ELEMENTS = [", 1)[1]
    out = set()
    for block in re.split(r"\n    \{\n", body):
        match = re.search(r"id: '([^']+)'", block)
        if match and re.search(r"^\s*perSide: true,", block, re.M):
            out.add(match.group(1))
    return out


def test_every_per_side_element_is_offered_as_two_rows_by_the_add_picker():
    declared = _per_side_element_ids()
    assert declared, "no perSide elements found — did the registry shape change?"
    assert declared <= set(_TEAM_VARIANTS), (
        f"perSide elements missing from _TEAM_VARIANTS: {declared - set(_TEAM_VARIANTS)}"
    )


def test_every_team_variant_layout_with_an_element_declares_per_side():
    assert set(_TEAM_VARIANTS) - _per_side_element_ids() == UNREGISTERED


def test_both_sides_are_offered_and_neither_is_a_bare_default():
    """A side has no default row, and that is the difference from a size.

    `?team=` has a URL default of 1, but every source the Add picker creates
    names its side outright — so the catalog tier emits `t1` and `t2` rather
    than a bare row plus one variant, or an offline pin resolves to a source
    that never exists.
    """
    for variants in _TEAM_VARIANTS.values():
        assert [num for num, _label in variants] == [1, 2]

"""The board-game lifecycle is derived in TWO runtimes, from one table.

``server/boards.py`` ``lifecycle_of`` and ``src/routes/production/boards.js``
``boardLifecycle`` answer the same question — is a feed actually driving this
board — for the server's projector and the console's chips respectively. They
share a BEHAVIOUR rather than a literal, so parity is pinned with cases
(tests/fixtures/board_lifecycle.json) read by both suites, not by parsing one
language from the other.

Drift is silent and asymmetric, which is why it is worth a fixture: the server
half decides whether the Match projector defers to a game (port pick, captain
pick, blanks) and whether a bind clears, while the client half decides what the
rack says. A server that thinks a board is live where the console says FINAL puts
the wrong captain on air and shows nothing anywhere to explain it.
"""

import json
from pathlib import Path

import pytest

from server.boards import is_stale, lifecycle_of

REPO = Path(__file__).resolve().parents[2]
TABLE = json.loads((REPO / "tests/fixtures/board_lifecycle.json").read_text())


@pytest.mark.parametrize(
    "case", TABLE["cases"], ids=[c["why"][:48] for c in TABLE["cases"]]
)
def test_lifecycle_matches_the_shared_table(case):
    assert lifecycle_of(**case["in"]) == case["out"], case["why"]


def test_the_js_side_reads_the_same_table():
    """A fixture nobody reads is not a parity test.

    Cheap guard against the JS suite drifting off the table (renaming it, or
    inlining its own cases) — which would leave this file passing while the two
    implementations were free to disagree again.
    """
    js = (REPO / "src/routes/production/board-lifecycle.test.js").read_text()
    assert "board_lifecycle.json" in js


@pytest.mark.parametrize("lifecycle", TABLE["stale"]["true"])
def test_stale_states(lifecycle):
    assert is_stale(lifecycle) is True


@pytest.mark.parametrize("lifecycle", TABLE["stale"]["false"])
def test_live_states_are_not_stale(lifecycle):
    assert is_stale(lifecycle) is False


def test_the_table_covers_every_verdict():
    """Every state the function can return has at least one case.

    `restored` was added to a four-value enum; the next value added should fail
    here rather than land untested.
    """
    verdicts = {c["out"] for c in TABLE["cases"]}
    assert verdicts == {"empty", "live", "final", "stranded", "restored"}

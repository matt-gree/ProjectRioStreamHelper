"""Why a fixture is not waiting for a board (`Schedule.not_waiting_reason`).

`stage` has no producer-facing writer on the server — `note_live` promotes
draft→live on the first feed event and the post-game paths set `post`. Combined
with the anti-bounce condition (`stage == 'draft'`), that made a fed-then-unbound
fixture sit queued, unbound and undecided while Up next stayed silent about it
forever, with a badge on the Match desk as the only clue and no way to clear it.
`test_a_played_fixture_is_stranded_until_someone_sets_it_back` is that trap,
pinned: the strand is real behaviour, and the reason string plus the desk's stage
control are what make it visible and reversible.

The verdict and the explanation come from ONE function on purpose, so they cannot
drift into disagreeing about which fixture is next.
"""
import pytest

from server.api.v1.match import bind_board
from server.match import Match, default_match
from server.schedule import Schedule
from server.state import State


async def make_match(name1: str = "Alice", name2: str = "Bob", **over) -> int:
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = name1
    match["player"]["2"]["rioName"] = name2
    match.update(over)
    await State.Set(f"match.{m}", match)
    return m


@pytest.mark.asyncio
async def test_a_fresh_fixture_is_waiting_and_has_no_reason():
    m = await make_match()
    assert Schedule.not_waiting_reason(m) is None
    assert Schedule.is_up_next_eligible(m) is True


@pytest.mark.asyncio
async def test_the_verdict_and_the_reason_never_disagree():
    """One rule, stated once. Every state below is checked both ways rather than
    trusting that two implementations of four conditions stay in step."""
    cases = [
        await make_match(),
        await make_match("Carol", "Dave", stage="live"),
        await make_match("Erin", "Frank", stage="post"),
        await make_match("Gina", "Hank", decided=1),
    ]
    for m in cases:
        assert Schedule.is_up_next_eligible(m) == (Schedule.not_waiting_reason(m) is None)


@pytest.mark.asyncio
async def test_a_bound_fixture_names_the_board_holding_it():
    """The most actionable reason, so it is reported first — a producer looking for
    a missing fixture wants to be told where it already is."""
    m = await make_match()
    await bind_board(1, m)
    assert Schedule.not_waiting_reason(m) == "it is already on board 1"


@pytest.mark.asyncio
async def test_a_decided_series_says_so():
    m = await make_match(decided=2)
    assert Schedule.not_waiting_reason(m) == "the series is decided"


@pytest.mark.asyncio
async def test_a_played_fixture_is_stranded_until_someone_sets_it_back():
    """THE TRAP. A fixture fed once and then unbound is queued, unbound and
    undecided — and still not offered, because it has left `draft` and no server
    path ever puts it back. Writing the stage is the only way out, which is what
    the Match desk's lifecycle control now exposes."""
    m = await make_match(stage="live")
    await Schedule.append(m)

    assert Schedule.not_waiting_reason(m) == "it has already been played"
    assert Schedule.next_up() is None

    # The way out — the same write the desk's stage control makes.
    await State.Set(f"match.{m}.stage", "draft")
    assert Schedule.not_waiting_reason(m) is None
    assert Schedule.next_up() == m


@pytest.mark.asyncio
async def test_a_deleted_id_left_in_the_order_is_not_a_fixture():
    assert Schedule.not_waiting_reason(999) == "the match no longer exists"
    assert Schedule.not_waiting_reason("nonsense") == "the match no longer exists"


@pytest.mark.asyncio
async def test_membership_is_not_one_of_the_conditions():
    """`next_up` walks the queue, so being IN it is the caller's question. An
    unenrolled fixture is perfectly 'waiting' — it is just never reached, which is
    why the console states membership separately instead of folding it in here."""
    m = await make_match()
    assert Schedule.queue() == []
    assert Schedule.not_waiting_reason(m) is None
    assert Schedule.next_up() is None

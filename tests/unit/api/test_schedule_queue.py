"""The running order — membership and position (`schedule.queue`).

Two things are pinned here, and both are about where the order is allowed to be
edited from.

**Creating a match enrols it.** A producer authoring eight fixtures should not
have to add each one to the schedule; before this, they could build a night's
worth and find the schedule overlay empty and every board's Up next silent, with
nothing saying why. Taking one back out is one call.

**Membership and position are PER-ID verbs, not a whole-list write.** The UI used
to send the entire reordered queue back, which drops anything added between its
read and its write — and now that creation appends, that window is real.
`test_moving_does_not_drop_a_match_added_meanwhile` is the reason these endpoints
exist at all; it fails against a whole-list PUT.
"""
import pytest
from fastapi import HTTPException

from server.api.v1.match import bind_board, create_match, delete_match
from server.api.v1.schedule import (
    dequeue_match,
    enqueue_match,
    move_queued_match,
    update_schedule,
    SchedulePayload,
)
from server.match import Match, default_match
from server.schedule import Schedule
from server.state import State


async def make_match(name1: str = "Alice", name2: str = "Bob", **over) -> int:
    """A match in State, NOT queued — so a test opts into the order explicitly."""
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = name1
    match["player"]["2"]["rioName"] = name2
    match.update(over)
    await State.Set(f"match.{m}", match)
    return m


# --- creating a match enrols it ---

@pytest.mark.asyncio
async def test_creating_a_match_puts_it_at_the_end_of_the_order():
    first = await create_match()
    second = await create_match()
    assert Schedule.queue() == [first["id"], second["id"]]


@pytest.mark.asyncio
async def test_a_created_match_is_immediately_offered_as_next():
    """The whole point of enrolling on create: the board verb works without a
    separate 'now add it to the schedule' step."""
    created = await create_match()
    assert Schedule.next_up() == created["id"]


# --- membership ---

@pytest.mark.asyncio
async def test_enqueue_appends_and_is_idempotent():
    a, b = await make_match(), await make_match("Carol", "Dave")
    await enqueue_match(a)
    await enqueue_match(b)
    await enqueue_match(a)  # already in — must not move it to the end
    assert Schedule.queue() == [a, b]


@pytest.mark.asyncio
async def test_enqueue_rejects_a_match_that_does_not_exist():
    with pytest.raises(HTTPException) as e:
        await enqueue_match(9999)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_dequeue_takes_it_out_but_keeps_the_match():
    """Out of the order is not deleted: the fixture survives, it just stops
    appearing on the schedule overlay and stops being offered to a board."""
    a = (await create_match())["id"]
    await dequeue_match(a)
    assert Schedule.queue() == []
    assert Match.exists(a)
    assert Schedule.next_up() is None


@pytest.mark.asyncio
async def test_dequeue_is_a_noop_for_a_match_not_in_the_order():
    a = (await create_match())["id"]
    b = await make_match("Carol", "Dave")
    await dequeue_match(b)
    assert Schedule.queue() == [a]


@pytest.mark.asyncio
async def test_deleting_a_match_prunes_it_from_the_order():
    a = (await create_match())["id"]
    b = (await create_match())["id"]
    await delete_match(a)
    assert Schedule.queue() == [b]


# --- position ---

@pytest.mark.asyncio
async def test_move_shifts_one_place_in_each_direction():
    a = (await create_match())["id"]
    b = (await create_match())["id"]
    c = (await create_match())["id"]
    await move_queued_match(c, -1)
    assert Schedule.queue() == [a, c, b]
    await move_queued_match(a, 1)
    assert Schedule.queue() == [c, a, b]


@pytest.mark.asyncio
async def test_move_clamps_at_both_ends():
    """The UI disables the arrow at each end, but the server must not depend on
    that — a clamp is the difference between a no-op and an IndexError."""
    a = (await create_match())["id"]
    b = (await create_match())["id"]
    await move_queued_match(a, -1)
    assert Schedule.queue() == [a, b]
    await move_queued_match(b, 5)
    assert Schedule.queue() == [a, b]


@pytest.mark.asyncio
async def test_move_ignores_a_match_outside_the_order():
    a = (await create_match())["id"]
    b = await make_match("Carol", "Dave")
    await move_queued_match(b, -1)
    assert Schedule.queue() == [a]


@pytest.mark.asyncio
async def test_moving_does_not_drop_a_match_added_meanwhile():
    """WHY THESE ARE PER-ID ENDPOINTS.

    A client reads the order, the producer creates a match elsewhere (or a set
    loads off the bracket), then the client reorders. A whole-list write sends
    back the order it read and the new fixture vanishes from the schedule with no
    error anywhere. Asking the server to move ONE match cannot lose the other.
    """
    a = (await create_match())["id"]
    b = (await create_match())["id"]
    stale = Schedule.queue()          # what a client would have read: [a, b]
    c = (await create_match())["id"]  # arrives after that read

    await move_queued_match(b, -1)
    assert Schedule.queue() == [b, a, c]

    # And the shape of the bug, for contrast: replaying the stale list loses c.
    await update_schedule(SchedulePayload(queue=stale))
    assert c not in Schedule.queue()


# --- the order vs the board binding ---

@pytest.mark.asyncio
async def test_binding_a_match_leaves_its_place_in_the_order():
    """Taking a fixture does not consume its slot — what stops it being offered
    again is that a board holds it, which `next_up` derives. Position is the
    producer's running order and survives going on air."""
    a = (await create_match())["id"]
    b = (await create_match())["id"]
    await bind_board(1, a)
    assert Schedule.queue() == [a, b]
    assert Schedule.next_up() == b

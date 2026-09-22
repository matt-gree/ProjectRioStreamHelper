"""Schedule queue: the /schedule routes and the match-delete prune hook."""
import pytest

from server.api.v1.match import delete_match, update_match, MatchPayload
from server.api.v1.schedule import get_schedule, update_schedule, SchedulePayload
from server.match import Match, default_match
from server.schedule import Schedule
from server.state import State


async def make_match() -> int:
    m = Match.next_id()
    await State.Set(f"match.{m}", default_match())
    return m


async def enqueue(*ids: int) -> None:
    """Put ``ids`` on the running order, in order (none are enrolled yet)."""
    for m in ids:
        await Schedule.append(m)


@pytest.mark.asyncio
async def test_put_schedule_sets_the_overlay_heading():
    """Asserted field-by-field rather than against the whole response: the route
    also answers with `queues` (the model) and `success`, and pinning the exact
    dict made this fail on a response gaining a field while the behaviour was
    unchanged. Order and membership are the per-id verbs' job, not this route's.
    """
    a = await make_match()
    await enqueue(a)
    out = await update_schedule(SchedulePayload(title="Today's Matches"))
    assert out["queue"] == [a]
    assert out["title"] == "Today's Matches"
    # The title is the OVERLAY's heading and belongs to no order: heading a union of
    # Winners + Losers with the first order's name would be a lie about what is on
    # screen. The order keeps its own label.
    assert out["queues"] == [{"id": "main", "title": "Main", "matches": [a]}]
    out = await update_schedule(SchedulePayload(title="Finals Day"))
    assert out["queue"] == [a]
    assert out["title"] == "Finals Day"
    got = await get_schedule()
    assert (got["queue"], got["title"]) == ([a], "Finals Day")


@pytest.mark.asyncio
async def test_delete_match_prunes_queue():
    a = await make_match()
    b = await make_match()
    await enqueue(a, b)
    await delete_match(a)
    assert Schedule.queue() == [b]


@pytest.mark.asyncio
async def test_scheduled_at_field_round_trips():
    m = await make_match()
    assert Match.get(m).get("scheduledAt") == ""
    await update_match(m, MatchPayload(scheduledAt="6:30 PM"))
    assert Match.get(m).get("scheduledAt") == "6:30 PM"

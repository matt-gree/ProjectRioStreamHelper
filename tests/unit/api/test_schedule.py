"""Schedule queue: validation in Schedule.set_queue, the /schedule routes, and
the match-delete prune hook."""
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


@pytest.mark.asyncio
async def test_set_queue_drops_unknown_and_duplicates():
    a = await make_match()
    b = await make_match()
    clean = await Schedule.set_queue([a, 999, b, a, "junk", b])
    assert clean == [a, b]
    assert Schedule.queue() == [a, b]


@pytest.mark.asyncio
async def test_put_schedule_updates_queue_and_title():
    a = await make_match()
    out = await update_schedule(SchedulePayload(queue=[a], title="Today's Matches"))
    assert out == {"queue": [a], "title": "Today's Matches"}
    # Partial update: title-only leaves the queue alone.
    out = await update_schedule(SchedulePayload(title="Finals Day"))
    assert out == {"queue": [a], "title": "Finals Day"}
    got = await get_schedule()
    assert got == {"queue": [a], "title": "Finals Day"}


@pytest.mark.asyncio
async def test_delete_match_prunes_queue():
    a = await make_match()
    b = await make_match()
    await Schedule.set_queue([a, b])
    await delete_match(a)
    assert Schedule.queue() == [b]


@pytest.mark.asyncio
async def test_scheduled_at_field_round_trips():
    m = await make_match()
    assert Match.get(m).get("scheduledAt") == ""
    await update_match(m, MatchPayload(scheduledAt="6:30 PM"))
    assert Match.get(m).get("scheduledAt") == "6:30 PM"

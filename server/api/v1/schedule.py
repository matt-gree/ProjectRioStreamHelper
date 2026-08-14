"""Schedule endpoints — the producer's running orders over upcoming matches.

Plain @router decorators (not @method), mirroring match.py: the schedule lives in
the State store, so writes are already broadcast to clients via ``State.Set`` —
the authoring UI reads ``schedule.*`` from the state broadcast and only writes
through here.

MEMBERSHIP AND ORDER ARE PER-ID VERBS (``POST``/``DELETE`` ``/schedule/queue/{m}``
and ``…/move``). The whole-list ``PUT`` survives for the title and for callers
that really do own the entire order, but the UI must not use it for a one-match
change: sending the whole queue back drops anything added between the client's
read and its write, and creating a match now enrols it, so that window is real.

SEVERAL QUEUES. ``/schedule/queues*`` manages the lists themselves (a night can
run a winners order and a losers order independently); the per-match verbs take an
optional ``queue`` and default to the first. ``move`` deliberately takes NO queue —
the server looks up which one holds the match, so a client cannot reorder against
a stale idea of where it lives.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.schedule import Schedule
from server.state import State

router = APIRouter(prefix="/schedule", tags=["schedule"])


class SchedulePayload(BaseModel):
    """Partial update: only the fields present are applied."""

    queue: list[int] | None = None
    title: str | None = None


class QueuePayload(BaseModel):
    """A queue's own title (create / rename)."""

    title: str = ""


def _result() -> dict:
    """Every write answers with the whole shape, so a client never has to guess
    which of the two representations it just changed."""
    return {
        "success": True,
        "queues": Schedule.queues(),
        # The projected union — what the schedule overlay draws.
        "queue": Schedule.queue(),
        "title": (State.state.get("schedule", {}) or {}).get("title") or "",
    }


def _require_queue(qid: str) -> str:
    # The emptiness test comes FIRST: `get_queue("")` answers with the first queue
    # by design (a falsy id means "the default one"), so asking it about an empty
    # id would say yes to a queue nobody named.
    if not qid or Schedule.get_queue(qid) is None:
        raise HTTPException(404, f"queue {qid!r} does not exist")
    return qid


@router.get("", response_class=ORJSONResponse)
async def get_schedule():
    return _result()


@router.put("", response_class=ORJSONResponse)
async def update_schedule(payload: SchedulePayload):
    """Replace the FIRST queue's order (validated against existing matches)
    and/or its title. The legacy single-queue shape; per-id verbs below are what
    the UI uses."""
    if payload.queue is not None:
        await Schedule.set_queue(payload.queue)
    if payload.title is not None:
        # The OVERLAY's heading, not any order's title — see
        # Schedule.ensure_migrated for why those must stay separate.
        await State.Set("schedule.title", payload.title)
        await State.Save()
    return _result()


# ----- the queues themselves -----------------------------------------------


@router.post("/queues", response_class=ORJSONResponse)
async def create_queue(payload: QueuePayload):
    """Add a running order. Its id is minted from the title and never changes."""
    await Schedule.ensure_migrated()
    q = await Schedule.create_queue(payload.title)
    return {**_result(), "created": q}


@router.put("/queues/{qid}", response_class=ORJSONResponse)
async def rename_queue(qid: str, payload: QueuePayload):
    _require_queue(qid)
    await Schedule.rename_queue(qid, payload.title)
    return _result()


@router.delete("/queues/{qid}", response_class=ORJSONResponse)
async def delete_queue(qid: str):
    """Drop a running order. Its matches survive, unenrolled.

    409 rather than a silent no-op on the last one: a rig with no queues has
    nowhere for a new fixture to enrol and no answer for "what's next on board 2",
    the same reason at least one scoreboard always remains.
    """
    _require_queue(qid)
    if len(Schedule.queues()) <= 1:
        raise HTTPException(409, "the last running order cannot be removed")
    await Schedule.delete_queue(qid)
    return _result()


@router.post("/queues/{qid}/move", response_class=ORJSONResponse)
async def move_queue(qid: str, delta: int):
    """Shift a whole running order's position, clamped to the ends."""
    _require_queue(qid)
    await Schedule.move_queue(qid, delta)
    return _result()


# ----- matches within a queue ----------------------------------------------


@router.post("/queue/{m}", response_class=ORJSONResponse)
async def enqueue_match(m: int, queue: str | None = None):
    """Put match `m` at the end of a running order (idempotent).

    Membership is exclusive, so naming a different queue MOVES the match rather
    than listing it twice — a fixture belongs to one running order.
    """
    if str(m) not in (State.state.get("match", {}) or {}):
        raise HTTPException(404, f"match {m} does not exist")
    if queue:
        _require_queue(queue)
    await Schedule.append(m, queue)
    return _result()


@router.delete("/queue/{m}", response_class=ORJSONResponse)
async def dequeue_match(m: int):
    """Take match `m` out of every running order. The match itself survives —
    it just stops appearing in the schedule overlay and stops being offered as
    the next fixture for a board."""
    await Schedule.remove(m)
    return _result()


@router.post("/queue/{m}/move", response_class=ORJSONResponse)
async def move_queued_match(m: int, delta: int):
    """Shift match `m` by `delta` places within its own running order, clamped.

    No `queue` parameter on purpose: the server resolves which one holds the
    match, so a client working from a stale read cannot reorder the wrong list.
    """
    await Schedule.move(m, delta)
    return _result()

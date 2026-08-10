"""Schedule endpoints — the producer's ordered queue of upcoming matches.

Plain @router decorators (not @method), mirroring match.py: the schedule lives in
the State store, so writes are already broadcast to clients via ``State.Set`` —
the authoring UI reads ``schedule.*`` from the state broadcast and only writes
through here.

MEMBERSHIP AND ORDER ARE PER-ID VERBS (``POST``/``DELETE`` ``/schedule/queue/{m}``
and ``…/move``). The whole-list ``PUT`` survives for the title and for callers
that really do own the entire order, but the UI must not use it for a one-match
change: sending the whole queue back drops anything added between the client's
read and its write, and creating a match now enrols it, so that window is real.
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


@router.get("", response_class=ORJSONResponse)
async def get_schedule():
    sched = State.state.get("schedule", {}) or {}
    return {"queue": Schedule.queue(), "title": sched.get("title") or ""}


@router.put("", response_class=ORJSONResponse)
async def update_schedule(payload: SchedulePayload):
    """Replace the queue (validated against existing matches) and/or title."""
    if payload.queue is not None:
        await Schedule.set_queue(payload.queue)
    if payload.title is not None:
        await State.Set("schedule.title", payload.title)
        await State.Save()
    sched = State.state.get("schedule", {}) or {}
    return {"queue": Schedule.queue(), "title": sched.get("title") or ""}


def _queue_result() -> dict:
    return {"success": True, "queue": Schedule.queue()}


@router.post("/queue/{m}", response_class=ORJSONResponse)
async def enqueue_match(m: int):
    """Put match `m` at the end of the running order (idempotent)."""
    if str(m) not in (State.state.get("match", {}) or {}):
        raise HTTPException(404, f"match {m} does not exist")
    await Schedule.append(m)
    return _queue_result()


@router.delete("/queue/{m}", response_class=ORJSONResponse)
async def dequeue_match(m: int):
    """Take match `m` out of the running order. The match itself survives —
    it just stops appearing in the schedule overlay and stops being offered as
    the next fixture for a board."""
    await Schedule.remove(m)
    return _queue_result()


@router.post("/queue/{m}/move", response_class=ORJSONResponse)
async def move_queued_match(m: int, delta: int):
    """Shift match `m` by `delta` places, clamped to the ends of the queue."""
    await Schedule.move(m, delta)
    return _queue_result()

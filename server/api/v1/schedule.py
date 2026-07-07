"""Schedule endpoints — the producer's ordered queue of upcoming matches.

Plain @router decorators (not @method), mirroring match.py: the schedule lives in
the State store, so writes are already broadcast to clients via ``State.Set`` —
the authoring UI reads ``schedule.*`` from the state broadcast and only PUTs
through here. Reordering is client-side: the UI sends the whole queue back.
"""
from fastapi import APIRouter
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

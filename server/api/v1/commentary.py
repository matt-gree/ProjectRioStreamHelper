"""Commentary endpoints — the registry-bound caster desk (Phase 4).

Plain @router (not @method), like match.py: the commentary desk lives in the
State store, so its fields are already broadcast to clients whenever this handler
writes them through ``State.Set``/``SetBatch``. The authoring UI reads
``commentary.*`` straight from the state broadcast; it only PUTs through here.

A PUT replaces the whole (≤4) slot list — small enough that add/remove/reorder/
edit all collapse to "compute the new array, send it". The server normalizes each
slot, persists ``commentary.slots``, and re-projects the resolved overlay keys.
"""
from typing import Any

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.api.v1.subfields import register_subfields_route
from server.commentary import Commentary
from server.state import State

router = APIRouter(prefix="/commentary", tags=["commentary"])
register_subfields_route(router)


class SlotsPayload(BaseModel):
    """Full replacement of the authored caster slots (max 4 honored server-side).

    Each slot: ``{ participantId, subField, visible, subVisible }``.
    """

    slots: list[dict[str, Any]] = []


@router.get("", response_class=ORJSONResponse)
async def get_commentary():
    """The whole commentary object (authored slots + projected display keys)."""
    return State.state.get("commentary", {}) or {}


@router.put("", response_class=ORJSONResponse)
async def set_commentary(payload: SlotsPayload):
    """Replace the caster slots, then re-project. Returns the normalized slots."""
    slots = await Commentary.set_slots(payload.slots)
    return {"success": True, "slots": slots}

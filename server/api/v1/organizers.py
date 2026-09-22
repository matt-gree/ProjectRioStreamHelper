"""Organizer endpoints — the competition's address-book-bound staff.

Plain @router (not @method), like commentary.py: the authored list lives in the
State store, so it is already broadcast to clients whenever this handler writes
it. The Competition form reads ``tournamentInfo.organizers`` and the projected
``tournamentInfo.organizer_{i}_*`` keys straight off the state broadcast; it only
PUTs through here.

A PUT replaces the whole (≤3) list — small enough that add/remove/reorder/clear
all collapse to "compute the new array, send it". The server normalizes, persists
and re-projects against the registry.
"""
from typing import Any

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.organizers import Organizers

router = APIRouter(prefix="/organizers", tags=["organizers"])


class OrganizersPayload(BaseModel):
    """Full replacement of the authored organizer list (max 3 honored server-side).

    Each entry: ``{ participantId }``.
    """

    organizers: list[dict[str, Any]] = []


@router.get("", response_class=ORJSONResponse)
async def get_organizers():
    """The authored list, or an empty one when the producer has never set it.

    `authored() is None` is a real state — legacy hand-typed organizers this
    projector deliberately does not own — but it is not a distinction the client
    needs to act on, so it flattens to [] on the wire.
    """
    return {"organizers": Organizers.authored() or []}


@router.put("", response_class=ORJSONResponse)
async def set_organizers(payload: OrganizersPayload):
    """Replace the organizer list, then re-project. Returns the normalized list."""
    organizers = await Organizers.set_organizers(payload.organizers)
    return {"success": True, "organizers": organizers}

"""Player Plates endpoints — the two-player name/sub-plate band.

Plain @router (not @method), like commentary.py/match.py: the band lives in the
State store, so its fields are already broadcast to clients whenever this handler
writes them through ``State.Set``/``SetBatch``. The Production authoring UI reads
``playerplates.*`` straight from the state broadcast; it only PUTs through here.

A PUT replaces the whole config object (mode · source · matchId · two sides). The
server normalizes it, persists ``playerplates.config``, and re-projects the
resolved overlay keys.
"""
from typing import Any

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.api.v1.subfields import register_subfields_route
from server.playerplates import PlayerPlates
from server.state import State

router = APIRouter(prefix="/playerplates", tags=["playerplates"])
register_subfields_route(router)


class ConfigPayload(BaseModel):
    """Full replacement of the authored player-plates config.

    ``config`` = ``{ mode, source, matchId, sides: {"1": {...}, "2": {...}} }``;
    each side = ``{ name, subField, subLabel, subValue, visible, subVisible,
    location }``. All fields are normalized/validated server-side.
    """

    config: dict[str, Any] = {}


@router.get("", response_class=ORJSONResponse)
async def get_playerplates():
    """The whole player-plates object (authored config + projected display keys)."""
    return State.state.get("playerplates", {}) or {}


@router.put("", response_class=ORJSONResponse)
async def set_playerplates(payload: ConfigPayload):
    """Replace the config, then re-project. Returns the normalized config."""
    cfg = await PlayerPlates.set_config(payload.config)
    return {"success": True, "config": cfg}

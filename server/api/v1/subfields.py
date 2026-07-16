"""Shared ``GET /fields`` sub-route.

Commentary and Player Plates offer the same sub-plate field options — the
address-book keys in ``SUBFIELD_LABELS`` (``server/commentary.py``) — so both
routers register the identical handler through this one registrar.
"""
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from server.commentary import SUBFIELD_LABELS


def register_subfields_route(router: APIRouter) -> None:
    @router.get("/fields", response_class=ORJSONResponse)
    async def list_subfields():
        """Sub-plate field options (address-book key → label) the UI may offer."""
        return SUBFIELD_LABELS

"""Matchup endpoints — fetch/clear the head-to-head behind the Matchup History
element. Plain @router decorators (like match.py): the payload lands in the
State store, so clients receive it through the normal state broadcast; these
routes are only the producer's triggers."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse

from server.matchup import Matchup

router = APIRouter(prefix="/matchup", tags=["matchup"])


@router.post("/fetch", response_class=ORJSONResponse)
async def matchup_fetch(match: int):
    """Fetch + project the head-to-head for a match's two participants."""
    result = await Matchup.Fetch(match)
    if result.get("error"):
        raise HTTPException(400, result["error"])
    return result


@router.post("/clear", response_class=ORJSONResponse)
async def matchup_clear():
    """Blank the matchup band."""
    await Matchup.Clear()
    return {"success": True}

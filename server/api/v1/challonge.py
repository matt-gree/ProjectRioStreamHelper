from loguru import logger
from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.challonge.provider import ChallongeProvider

router = APIRouter()


@method(
    router.post, "/challonge/load-event",
    version="1", id="challonge.load_event",
    response_class=ORJSONResponse
)
async def challonge_load_event(url: str = "", session_id: str | None = None) -> ORJSONResponse:
    """Load tournament data from a Challonge URL."""
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    result = await ChallongeProvider.LoadEvent(url)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.post, "/challonge/clear",
    version="1", id="challonge.clear",
    response_class=ORJSONResponse
)
async def challonge_clear(session_id: str | None = None) -> ORJSONResponse:
    """Clear cached tournament data and the persisted bracket link."""
    await ChallongeProvider.Clear()
    return ORJSONResponse({"success": True})


@method(
    router.get, "/challonge/phases",
    version="1", id="challonge.phases",
    response_class=ORJSONResponse
)
async def challonge_phases(session_id: str | None = None) -> ORJSONResponse:
    """Get phases and phase groups for the current tournament."""
    phases = await ChallongeProvider.GetPhases()
    return ORJSONResponse(phases)


@method(
    router.get, "/challonge/sets",
    version="1", id="challonge.sets",
    response_class=ORJSONResponse
)
async def challonge_sets(
    page: int = 1,
    phase_id: str | None = None,
    phase_group_id: str | None = None,
    include_finished: bool = False,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Get paginated sets for the current tournament."""
    result = await ChallongeProvider.GetSets(
        page=page,
        phase_id=phase_id,
        phase_group_id=phase_group_id,
        include_finished=include_finished,
    )
    return ORJSONResponse(result)


@method(
    router.get, "/challonge/set/{set_id}",
    version="1", id="challonge.set",
    response_class=ORJSONResponse
)
async def challonge_set(set_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Get a single match by ID."""
    result = await ChallongeProvider.GetSet(set_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.post, "/challonge/load-set",
    version="1", id="challonge.load_set",
    response_class=ORJSONResponse
)
async def challonge_load_set(
    set_id: int = 0,
    scoreboard_number: int = 1,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Load a match's player data into a scoreboard."""
    if not set_id:
        raise HTTPException(status_code=400, detail="set_id is required")
    result = await ChallongeProvider.LoadSetIntoScoreboard(set_id, scoreboard_number)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.post, "/challonge/load-bracket",
    version="1", id="challonge.load_bracket",
    response_class=ORJSONResponse
)
async def challonge_load_bracket(
    phase_group_id: str = "",
    session_id: str | None = None,
) -> ORJSONResponse:
    """Fetch bracket structure for a phase group and write to State."""
    if not phase_group_id:
        raise HTTPException(status_code=400, detail="phase_group_id is required")
    # Convert to int if numeric
    pgid = int(phase_group_id) if phase_group_id.isdigit() else phase_group_id
    result = await ChallongeProvider.LoadBracket(pgid)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.get, "/challonge/bracket-data",
    version="1", id="challonge.bracket_data",
    response_class=ORJSONResponse
)
async def challonge_bracket_data(
    phase_group_id: str = "",
    session_id: str | None = None,
) -> ORJSONResponse:
    """Get bracket structure without writing to State."""
    if not phase_group_id:
        raise HTTPException(status_code=400, detail="phase_group_id is required")
    pgid = int(phase_group_id) if phase_group_id.isdigit() else phase_group_id
    result = await ChallongeProvider.GetBracketData(pgid)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.get, "/challonge/entrants",
    version="1", id="challonge.entrants",
    response_class=ORJSONResponse
)
async def challonge_entrants(
    page: int = 1,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Get paginated entrants for the current tournament."""
    result = await ChallongeProvider.GetEntrants(page=page)
    return ORJSONResponse(result)

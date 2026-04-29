from loguru import logger
from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.startgg.provider import StartGGProvider

router = APIRouter()


@method(
    router.post, "/startgg/load-event",
    version="1", id="startgg.load_event",
    response_class=ORJSONResponse
)
async def startgg_load_event(url: str = "", session_id: str | None = None) -> ORJSONResponse:
    """Load tournament data from a start.gg event URL."""
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    result = await StartGGProvider.LoadEvent(url)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.post, "/startgg/clear",
    version="1", id="startgg.clear",
    response_class=ORJSONResponse
)
async def startgg_clear(session_id: str | None = None) -> ORJSONResponse:
    """Clear cached tournament data and the persisted bracket link."""
    await StartGGProvider.Clear()
    return ORJSONResponse({"success": True})


@method(
    router.get, "/startgg/phases",
    version="1", id="startgg.phases",
    response_class=ORJSONResponse
)
async def startgg_phases(session_id: str | None = None) -> ORJSONResponse:
    """Get phases and phase groups for the current event."""
    phases = await StartGGProvider.GetPhases()
    return ORJSONResponse(phases)


@method(
    router.get, "/startgg/sets",
    version="1", id="startgg.sets",
    response_class=ORJSONResponse
)
async def startgg_sets(
    page: int = 1,
    phase_id: int | None = None,
    phase_group_id: int | None = None,
    include_finished: bool = False,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Get paginated sets for the current event."""
    result = await StartGGProvider.GetSets(
        page=page,
        phase_id=phase_id,
        phase_group_id=phase_group_id,
        include_finished=include_finished,
    )
    return ORJSONResponse(result)


@method(
    router.get, "/startgg/set/{set_id}",
    version="1", id="startgg.set",
    response_class=ORJSONResponse
)
async def startgg_set(set_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Get a single set by ID with full player detail."""
    result = await StartGGProvider.GetSet(set_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.post, "/startgg/load-set",
    version="1", id="startgg.load_set",
    response_class=ORJSONResponse
)
async def startgg_load_set(
    set_id: int = 0,
    scoreboard_number: int = 1,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Load a set's player tags and scores into a scoreboard."""
    if not set_id:
        raise HTTPException(status_code=400, detail="set_id is required")
    result = await StartGGProvider.LoadSetIntoScoreboard(set_id, scoreboard_number)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.post, "/startgg/load-bracket",
    version="1", id="startgg.load_bracket",
    response_class=ORJSONResponse
)
async def startgg_load_bracket(
    phase_group_id: int = 0,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Fetch bracket structure for a phase group and write to State for overlays."""
    if not phase_group_id:
        raise HTTPException(status_code=400, detail="phase_group_id is required")
    result = await StartGGProvider.LoadBracket(phase_group_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.get, "/startgg/bracket-data",
    version="1", id="startgg.bracket_data",
    response_class=ORJSONResponse
)
async def startgg_bracket_data(
    phase_group_id: int = 0,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Get bracket structure for a phase group (without writing to State)."""
    if not phase_group_id:
        raise HTTPException(status_code=400, detail="phase_group_id is required")
    result = await StartGGProvider.GetBracketData(phase_group_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return ORJSONResponse(result)


@method(
    router.get, "/startgg/entrants",
    version="1", id="startgg.entrants",
    response_class=ORJSONResponse
)
async def startgg_entrants(
    page: int = 1,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Get paginated entrants for the current event."""
    result = await StartGGProvider.GetEntrants(page=page)
    return ORJSONResponse(result)

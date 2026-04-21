from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from server.announcements import Announcements
from server.utils.router import method

router = APIRouter()


@method(
    router.get, "/announcements",
    version="1", id="announcements.get",
    response_class=ORJSONResponse,
)
async def announcements_get(session_id: str | None = None) -> ORJSONResponse:
    return ORJSONResponse({"items": Announcements.GetActive()})


@method(
    router.post, "/announcements/dismiss",
    version="1", id="announcements.dismiss",
    response_class=ORJSONResponse,
)
async def announcements_dismiss(
    announcement_id: str = "",
    session_id: str | None = None,
) -> ORJSONResponse:
    if not announcement_id:
        return ORJSONResponse({"error": "announcement_id required"}, status_code=400)
    await Announcements.Dismiss(announcement_id)
    return ORJSONResponse({"success": True})


@method(
    router.post, "/announcements/refresh",
    version="1", id="announcements.refresh",
    response_class=ORJSONResponse,
)
async def announcements_refresh(session_id: str | None = None) -> ORJSONResponse:
    await Announcements.Refresh()
    return ORJSONResponse({"success": True})

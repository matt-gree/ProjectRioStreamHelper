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
    router.post, "/announcements/dismiss-all",
    version="1", id="announcements.dismiss_all",
    response_class=ORJSONResponse,
)
async def announcements_dismiss_all(session_id: str | None = None) -> ORJSONResponse:
    count = await Announcements.DismissAll()
    return ORJSONResponse({"success": True, "dismissed": count})

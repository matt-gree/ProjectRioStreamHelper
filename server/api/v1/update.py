"""The in-app updater's REST face — see server/updater.py."""

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from server.updater import Updater, UpdateError
from server.utils.router import method

router = APIRouter()


def _refused(e: UpdateError) -> ORJSONResponse:
    return ORJSONResponse({"detail": str(e), **Updater.status()}, status_code=409)


@method(router.get, "/update", version="1", id="update.get", response_class=ORJSONResponse)
async def update_get(session_id: str | None = None) -> ORJSONResponse:
    return ORJSONResponse(Updater.status())


@method(router.post, "/update/check", version="1", id="update.check", response_class=ORJSONResponse)
async def update_check(session_id: str | None = None) -> ORJSONResponse:
    return ORJSONResponse(await Updater.check())


@method(router.post, "/update/download", version="1", id="update.download", response_class=ORJSONResponse)
async def update_download(session_id: str | None = None) -> ORJSONResponse:
    try:
        return ORJSONResponse(await Updater.download())
    except UpdateError as e:
        return _refused(e)


@method(router.post, "/update/install", version="1", id="update.install", response_class=ORJSONResponse)
async def update_install(session_id: str | None = None) -> ORJSONResponse:
    try:
        return ORJSONResponse(await Updater.install())
    except UpdateError as e:
        return _refused(e)

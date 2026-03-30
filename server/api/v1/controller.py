"""API endpoints for the gc-overlay controller input display."""

from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from server.controller_overlay import ControllerOverlay

router = APIRouter()


@method(
    router.get, "/controller/status",
    version="1", id="controller.status",
    response_class=ORJSONResponse,
)
async def controller_status(session_id: str | None = None) -> ORJSONResponse:
    """Get the current status of the controller overlay."""
    return ORJSONResponse(ControllerOverlay.GetStatus())


@method(
    router.post, "/controller/start",
    version="1", id="controller.start",
    response_class=ORJSONResponse,
)
async def controller_start(session_id: str | None = None) -> ORJSONResponse:
    """Start the controller overlay subprocess."""
    result = await ControllerOverlay.Launch()
    return ORJSONResponse(result)


@method(
    router.post, "/controller/stop",
    version="1", id="controller.stop",
    response_class=ORJSONResponse,
)
async def controller_stop(session_id: str | None = None) -> ORJSONResponse:
    """Stop the controller overlay subprocess."""
    result = await ControllerOverlay.Shutdown()
    return ORJSONResponse(result)


@method(
    router.put, "/controller/port",
    version="1", id="controller.port",
    response_class=ORJSONResponse,
)
async def controller_set_port(port: int = 8069, session_id: str | None = None) -> ORJSONResponse:
    """Set the port for the controller overlay (requires restart)."""
    await ControllerOverlay.SetPort(port)
    return ORJSONResponse({"success": True, "port": port})


@method(
    router.put, "/controller/player",
    version="1", id="controller.player",
    response_class=ORJSONResponse,
)
async def controller_set_player(controller: int = 1, session_id: str | None = None) -> ORJSONResponse:
    """Set which controller port to display (1-4, requires restart)."""
    if not 1 <= controller <= 4:
        return ORJSONResponse({"success": False, "error": "Controller must be 1-4"})
    await ControllerOverlay.SetController(controller)
    return ORJSONResponse({"success": True, "controller": controller})

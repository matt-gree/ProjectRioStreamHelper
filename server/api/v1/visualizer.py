"""RioVisualizer support endpoints.

The hit overlay renders the flight path from State (``score.{N}.hit.*``) but
needs the stadium geometry to draw the field. Serve it by pyrio name from the
submodule's importable api. (This module is imported before ``server.rio`` runs
its sys.path wiring, so ensure the path here before importing rio_visualizer.)
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse

from server.paths import ensure_rio_visualizer_on_path
from server.utils.router import method

ensure_rio_visualizer_on_path()
from rio_visualizer.api import load_stadium  # noqa: E402

router = APIRouter()


@method(router.get, "/visualizer/stadium/{name}", response_class=ORJSONResponse)
async def visualizer_stadium(name: str, session_id: str | None = None) -> ORJSONResponse:
    """Return a stadium's geometry JSON by its (pyrio) name, for the hit overlay."""
    data = load_stadium(name)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Unknown stadium: {name}")
    return ORJSONResponse(data)

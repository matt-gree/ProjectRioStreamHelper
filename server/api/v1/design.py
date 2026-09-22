"""Design Package endpoints — list / install / uninstall theme bundles.

Plain @router decorators (like branding.py — the install route is multipart and
can't be socket-mirrored). Packages are folders on disk, not State: the Design
tab re-fetches the list after a mutation. The selected package is a normal
settings key (``overlays.global.designPackage``), so switching packages already
broadcasts through the settings channel.

Package assets themselves are served at ``/design/{package}/{file}`` (see
server/server.py); resolution + validation live in server/design_packages.py.
"""
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import ORJSONResponse
from pathlib import Path

from server import design_packages

router = APIRouter(prefix="/design", tags=["design"])


@router.get("/packages", response_class=ORJSONResponse)
async def list_packages():
    """All installed design packages, built-ins first."""
    return design_packages.list_packages()


@router.post("/packages/install", response_class=ORJSONResponse)
async def install_package(file: UploadFile = File(...)):
    """Install a package from an uploaded .zip. Returns the package info."""
    data = await file.read()
    fallback_id = Path(file.filename or "").stem
    try:
        return design_packages.install_zip(data, fallback_id=fallback_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/packages/{package_id}", response_class=ORJSONResponse)
async def uninstall_package(package_id: str):
    """Remove a user-installed package (built-ins are refused)."""
    try:
        design_packages.delete_package(package_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"success": True}

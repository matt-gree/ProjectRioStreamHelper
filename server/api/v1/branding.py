"""Tournament branding endpoints — logo upload, serve, and delete."""

import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import ORJSONResponse
from server.paths import user_data_dir

router = APIRouter(prefix="/branding", tags=["branding"])

_branding_dir = user_data_dir() / "branding"
_logo_path = _branding_dir / "tournament_logo.png"

_MAX_SIZE = 2 * 1024 * 1024  # 2 MB
_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}


@router.post("/logo", response_class=ORJSONResponse)
async def upload_logo(file: UploadFile = File(...)):
    """Upload a tournament logo (PNG/JPEG/SVG/WebP, max 2 MB)."""
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    data = await file.read()
    if len(data) > _MAX_SIZE:
        raise HTTPException(400, f"File too large ({len(data)} bytes). Max is {_MAX_SIZE} bytes.")

    _branding_dir.mkdir(parents=True, exist_ok=True)
    _logo_path.write_bytes(data)

    return {"exists": True, "url": "/branding/tournament_logo.png"}


@router.get("/logo", response_class=ORJSONResponse)
async def get_logo():
    """Check if a tournament logo exists and return its URL."""
    if _logo_path.is_file():
        return {"exists": True, "url": "/branding/tournament_logo.png"}
    return {"exists": False, "url": None}


@router.delete("/logo", response_class=ORJSONResponse)
async def delete_logo():
    """Remove the tournament logo."""
    if _logo_path.is_file():
        _logo_path.unlink()
    return {"exists": False, "url": None}

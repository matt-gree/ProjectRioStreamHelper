"""Branding endpoints — overlay logo + merch images: upload, serve, delete."""

import re
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import ORJSONResponse
from server.paths import user_data_dir

router = APIRouter(prefix="/branding", tags=["branding"])

_branding_dir = user_data_dir() / "branding"
_logo_path = _branding_dir / "tournament_logo.png"
# Merch/advert images (lower-third Merch slot). Served through the existing
# /branding/ static mount at /branding/merch/{file}.
_merch_dir = _branding_dir / "merch"

_MAX_SIZE = 2 * 1024 * 1024  # 2 MB
_ALLOWED_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
_EXT_FOR_TYPE = {"image/png": ".png", "image/jpeg": ".jpg",
                 "image/svg+xml": ".svg", "image/webp": ".webp"}
_MAX_MERCH_FILES = 12


# Plain @router decorators throughout — UploadFile is multipart and can't be
# forwarded through a SocketIO event, so @method isn't applicable here.
@router.post("/logo", response_class=ORJSONResponse)
async def upload_logo(file: UploadFile = File(...)):
    """Upload an overlay logo (PNG/JPEG/SVG/WebP, max 2 MB)."""
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
    """Check if an overlay logo exists and return its URL."""
    if _logo_path.is_file():
        return {"exists": True, "url": "/branding/tournament_logo.png"}
    return {"exists": False, "url": None}


@router.delete("/logo", response_class=ORJSONResponse)
async def delete_logo():
    """Remove the overlay logo."""
    if _logo_path.is_file():
        _logo_path.unlink()
    return {"exists": False, "url": None}


# ── merch images ─────────────────────────────────────────────────────────────

def _merch_slug(filename: str) -> str:
    """Filesystem-safe stem from an uploaded filename (no path, no dots)."""
    stem = Path(filename or "image").stem
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-").lower()
    return slug or "image"


def _list_merch() -> list[dict]:
    if not _merch_dir.is_dir():
        return []
    out = []
    for p in sorted(_merch_dir.iterdir()):
        if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".svg", ".webp"}:
            out.append({"name": p.name, "url": f"/branding/merch/{p.name}"})
    return out


@router.get("/merch", response_class=ORJSONResponse)
async def list_merch():
    """List uploaded merch images."""
    return {"images": _list_merch()}


@router.post("/merch", response_class=ORJSONResponse)
async def upload_merch(file: UploadFile = File(...)):
    """Upload a merch image (PNG/JPEG/SVG/WebP, max 2 MB). Same-name re-upload
    replaces; otherwise a numeric suffix keeps both."""
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    data = await file.read()
    if len(data) > _MAX_SIZE:
        raise HTTPException(400, f"File too large ({len(data)} bytes). Max is {_MAX_SIZE} bytes.")

    existing = _list_merch()
    ext = _EXT_FOR_TYPE[file.content_type]
    name = f"{_merch_slug(file.filename)}{ext}"
    if len(existing) >= _MAX_MERCH_FILES and name not in {e["name"] for e in existing}:
        raise HTTPException(400, f"Too many merch images (max {_MAX_MERCH_FILES}). Delete one first.")

    _merch_dir.mkdir(parents=True, exist_ok=True)
    (_merch_dir / name).write_bytes(data)
    return {"name": name, "url": f"/branding/merch/{name}", "images": _list_merch()}


@router.delete("/merch/{name}", response_class=ORJSONResponse)
async def delete_merch(name: str):
    """Remove one merch image (path-traversal guarded)."""
    p = (_merch_dir / name).resolve()
    if _merch_dir.resolve() not in p.parents:
        raise HTTPException(400, "invalid name")
    if p.is_file():
        p.unlink()
    return {"images": _list_merch()}

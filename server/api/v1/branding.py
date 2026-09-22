"""Branding endpoints — overlay logo + merch images: upload, serve, delete."""

import re
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import ORJSONResponse
from server.paths import user_data_dir
from server.settings import Settings

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
# One logo per saved design PRESET, captured when the preset is saved and copied
# over the live logo when it is applied — a tournament's preset is not that
# tournament's preset while it still shows the last event's logo. Served through
# the /branding/ static mount at /branding/presets/{id}.png.
_presets_dir = _branding_dir / "presets"


def _adopt_legacy_dir() -> None:
    """Preset logos were stored under `branding/looks/` before the rename.
    Moved once, the first time anything here reaches for the folder."""
    legacy = _branding_dir / "looks"
    if legacy.is_dir() and not _presets_dir.exists():
        legacy.rename(_presets_dir)
_PRESET_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


async def _bump_logo_rev() -> None:
    """Tell every overlay the logo file changed under its unchanged URL.

    `/branding/tournament_logo.png` never changes name, so an <image> already
    pointing at it has no reason to fetch it again — a new logo reached an
    on-air overlay only when the source was reloaded. The revision rides on
    `overlays.global`, which every overlay already repaints on, and
    `OverlayBase.brandingLogoUrl` puts it in the query string.
    """
    rev = Settings.Get("overlays.global.logoRev", 0)
    await Settings.Set("overlays.global.logoRev", (rev if isinstance(rev, int) else 0) + 1)


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
    await _bump_logo_rev()

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
        await _bump_logo_rev()
    return {"exists": False, "url": None}


# ── design preset logos ────────────────────────────────────────────────────────

def _preset_logo(preset_id: str) -> Path:
    if not _PRESET_ID.match(preset_id or ""):
        raise HTTPException(400, "invalid preset id")
    _adopt_legacy_dir()
    return _presets_dir / f"{preset_id}.png"


def _preset_logo_info(preset_id: str) -> dict:
    p = _preset_logo(preset_id)
    return {"logo": p.is_file(), "url": f"/branding/presets/{preset_id}.png" if p.is_file() else None}


@router.get("/presets/{preset_id}/logo", response_class=ORJSONResponse)
async def get_preset_logo(preset_id: str):
    """Whether a saved preset carries a logo, and where to fetch it."""
    return _preset_logo_info(preset_id)


@router.post("/presets/{preset_id}/logo/capture", response_class=ORJSONResponse)
async def capture_preset_logo(preset_id: str):
    """Record the CURRENT logo as this preset's — including recording that there
    is none, so applying the preset later takes the live logo down with it."""
    dest = _preset_logo(preset_id)
    if _logo_path.is_file():
        _presets_dir.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(_logo_path.read_bytes())
    elif dest.is_file():
        dest.unlink()
    return _preset_logo_info(preset_id)


@router.put("/presets/{preset_id}/logo", response_class=ORJSONResponse)
async def upload_preset_logo(preset_id: str, file: UploadFile = File(...)):
    """Store a logo for a preset directly — the import path, where the logo
    arrives inside an exported preset file rather than from the live one."""
    dest = _preset_logo(preset_id)
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")
    data = await file.read()
    if len(data) > _MAX_SIZE:
        raise HTTPException(400, f"File too large ({len(data)} bytes). Max is {_MAX_SIZE} bytes.")
    _presets_dir.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return _preset_logo_info(preset_id)


@router.post("/presets/{preset_id}/logo/apply", response_class=ORJSONResponse)
async def apply_preset_logo(preset_id: str):
    """Make this preset's logo the live one — or remove the live one, when the
    preset was saved without a logo. Applying a preset REPLACES what it covers."""
    src = _preset_logo(preset_id)
    if src.is_file():
        _branding_dir.mkdir(parents=True, exist_ok=True)
        data = src.read_bytes()
        if not _logo_path.is_file() or _logo_path.read_bytes() != data:
            _logo_path.write_bytes(data)
            await _bump_logo_rev()
        return {"exists": True, "url": "/branding/tournament_logo.png"}
    if _logo_path.is_file():
        _logo_path.unlink()
        await _bump_logo_rev()
    return {"exists": False, "url": None}


@router.delete("/presets/{preset_id}/logo", response_class=ORJSONResponse)
async def delete_preset_logo(preset_id: str):
    """Drop a preset's logo file (the preset itself lives in settings)."""
    p = _preset_logo(preset_id)
    if p.is_file():
        p.unlink()
    return {"logo": False, "url": None}


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

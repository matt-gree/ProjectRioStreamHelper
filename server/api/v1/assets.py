import asyncio
import platform
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse

from server.paths import default_msb_assets_dir
from server.rio.pyrio.assets import (
    required_character_filenames,
    required_game_icon_filenames,
    required_team_filenames,
)
from server.settings import Settings
from server.utils.router import method

# Truncate per-category missing-file lists in the API response so a fully
# empty folder doesn't return ~100 filenames the UI has to render.
_MAX_MISSING_REPORTED = 8

router = APIRouter()


async def get_msb_assets_path() -> Path:
    """Resolve the active MSB assets folder: user override or default."""
    user_path = Settings.Get("assets.msb_path", "")
    if user_path:
        p = Path(user_path)
        if p.exists() and p.is_dir():
            return p
    return default_msb_assets_dir()


# Subfolder name → callable returning the canonical list of expected
# filenames. The callables are pyrio's authoritative source of truth.
REQUIRED_CATEGORIES: dict[str, callable] = {
    "characterIcons": required_character_filenames,
    "teamLogos": required_team_filenames,
    "gameIcons": required_game_icon_filenames,
}


def _inspect_category(sub_path: Path, expected: list[str]) -> dict:
    """Validate one subfolder against its canonical filename list."""
    if not sub_path.is_dir():
        return {
            "expected": len(expected),
            "found": 0,
            "missing_count": len(expected),
            "missing_sample": expected[:_MAX_MISSING_REPORTED],
            "folder_present": False,
        }

    try:
        present = {f.name for f in sub_path.iterdir() if f.is_file() and f.suffix.lower() == ".png"}
    except OSError:
        present = set()

    missing = [name for name in expected if name not in present]
    found = len(expected) - len(missing)
    return {
        "expected": len(expected),
        "found": found,
        "missing_count": len(missing),
        "missing_sample": missing[:_MAX_MISSING_REPORTED],
        "folder_present": True,
    }


def _inspect_assets(path: Path) -> dict:
    """Inspect the assets folder against pyrio's canonical filename lists.

    Returns per-category found/missing counts plus a top-level `complete`
    flag and a plain-English `summary` string for the UI.
    """
    categories: dict[str, dict] = {}
    for sub, expected_fn in REQUIRED_CATEGORIES.items():
        expected = expected_fn()
        categories[sub] = _inspect_category(path / sub, expected)

    total_expected = sum(c["expected"] for c in categories.values())
    total_found = sum(c["found"] for c in categories.values())
    complete = all(c["missing_count"] == 0 for c in categories.values())

    return {
        "categories": categories,
        "total_expected": total_expected,
        "total_found": total_found,
        "complete": complete,
    }


@method(
    router.get, "/assets/msb",
    version="1", id="assets.msb",
    response_class=ORJSONResponse
)
async def assets_msb(session_id: str | None = None) -> ORJSONResponse:
    """Get current MSB assets path info: configured, resolved, default, and file count."""
    configured = Settings.Get("assets.msb_path", "")
    resolved = await get_msb_assets_path()
    default = default_msb_assets_dir()
    inspection = _inspect_assets(resolved)
    return ORJSONResponse({
        "configured": configured,
        "resolved": str(resolved),
        "default": str(default),
        **inspection,
    })


@method(
    router.put, "/assets/msb",
    version="1", id="assets.msb.set",
    response_class=ORJSONResponse
)
async def assets_msb_set(path: str = "", session_id: str | None = None) -> ORJSONResponse:
    """Set the MSB assets folder override. Empty string clears the override."""
    if path:
        p = Path(path)
        if not p.exists() or not p.is_dir():
            raise HTTPException(status_code=400, detail="Path must be an existing directory")

    await Settings.Set("assets.msb_path", path, session_id=session_id)
    resolved = await get_msb_assets_path()
    return ORJSONResponse({
        "success": True,
        "resolved": str(resolved),
        **_inspect_assets(resolved),
    })


def _open_folder_dialog() -> str | None:
    """Native folder picker. macOS: osascript. Windows: SHBrowseForFolderW."""
    system = platform.system()

    if system == "Darwin":
        script = (
            'try\n'
            '    set chosen to POSIX path of (choose folder '
            'with prompt "Select MSB image assets folder")\n'
            '    return chosen\n'
            'on error\n'
            '    return ""\n'
            'end try'
        )
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=120
        )
        path = result.stdout.strip()
        return path if path else None

    elif system == "Windows":
        # Use the modern IFileDialog COM interface via PowerShell — simpler
        # than ctypes wrappers around SHBrowseForFolderW and gives a real
        # folder-picker dialog rather than the legacy tree view.
        ps = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
            "$f.Description = 'Select MSB image assets folder'; "
            "if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"
        )
        result = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", ps],
            capture_output=True, text=True, timeout=120
        )
        path = result.stdout.strip()
        return path if path else None

    return None


@method(
    router.post, "/assets/msb/browse",
    version="1", id="assets.msb.browse",
    response_class=ORJSONResponse
)
async def assets_msb_browse(session_id: str | None = None) -> ORJSONResponse:
    """Open the native OS folder picker."""
    system = platform.system()
    if system not in ("Darwin", "Windows"):
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {system}")
    selected = await asyncio.to_thread(_open_folder_dialog)
    if selected:
        return ORJSONResponse({"success": True, "path": selected})
    return ORJSONResponse({"success": False, "path": None})


@method(
    router.post, "/assets/msb/reveal",
    version="1", id="assets.msb.reveal",
    response_class=ORJSONResponse
)
async def assets_msb_reveal(session_id: str | None = None) -> ORJSONResponse:
    """Reveal the active MSB assets folder in the OS file manager."""
    path = await get_msb_assets_path()
    # default_msb_assets_dir() mkdir's, but a custom override might have
    # vanished since it was set — recreate the default if so.
    if not path.is_dir():
        path = default_msb_assets_dir()

    system = platform.system()
    if system == "Darwin":
        await asyncio.to_thread(subprocess.Popen, ["open", str(path)])
    elif system == "Windows":
        await asyncio.to_thread(subprocess.Popen, ["explorer", str(path)])
    else:
        await asyncio.to_thread(subprocess.Popen, ["xdg-open", str(path)])

    return ORJSONResponse({"success": True, "path": str(path)})

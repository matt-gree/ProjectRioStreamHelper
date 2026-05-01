import asyncio
from pathlib import Path

from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.rio.provider import RioGameDataProvider, get_default_hud_file_path, get_user_hud_path
from server.settings import Settings

router = APIRouter()


@method(
    router.get, "/rio/game",
    version="1", id="rio.game",
    response_class=ORJSONResponse
)
async def rio_game(session_id: str | None = None) -> ORJSONResponse:
    """Get the current parsed game state from the HUD file."""
    return ORJSONResponse(RioGameDataProvider.current_game)


@method(
    router.post, "/rio/refresh",
    version="1", id="rio.refresh",
    response_class=ORJSONResponse
)
async def rio_refresh(session_id: str | None = None) -> ORJSONResponse:
    """Force a re-read of the HUD file and update state."""
    game = await RioGameDataProvider.FetchHUDGame()
    if not game:
        raise HTTPException(status_code=404, detail="No HUD data available")
    return ORJSONResponse({"success": True, "game": game})


@method(
    router.post, "/rio/swap",
    version="1", id="rio.swap",
    response_class=ORJSONResponse
)
async def rio_swap(
    scoreboard_number: int | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Toggle team sides (manual swap) for the HUD-linked scoreboards.

    The swap is applied to all HUD-target scoreboards since they all mirror
    the same HUD-derived game.
    """
    from server.api.v1.scoreboards import hud_target_scoreboards
    hud_targets = hud_target_scoreboards()
    if scoreboard_number is not None and scoreboard_number not in hud_targets:
        raise HTTPException(
            status_code=400,
            detail=f"Scoreboard {scoreboard_number} is not HUD-linked",
        )

    await RioGameDataProvider.toggle_sides_swapped()

    return ORJSONResponse({
        "success": True,
        "sides_swapped": RioGameDataProvider._sides_swapped,
    })


@method(
    router.get, "/rio/hud-path",
    version="1", id="rio.hud_path",
    response_class=ORJSONResponse
)
async def rio_hud_path(session_id: str | None = None) -> ORJSONResponse:
    """Get current HUD path info: configured path, resolved path, and default."""
    configured = Settings.Get("project_rio.hud_path", "")
    resolved = await get_user_hud_path()
    default = get_default_hud_file_path()
    return ORJSONResponse({
        "configured": configured,
        "resolved": str(resolved) if resolved else None,
        "default": str(default),
    })


@method(
    router.put, "/rio/hud-path",
    version="1", id="rio.hud_path.set",
    response_class=ORJSONResponse
)
async def rio_hud_path_set(path: str = "", session_id: str | None = None) -> ORJSONResponse:
    """Set the HUD file path and restart the watcher."""
    if path:
        p = Path(path)
        if not p.exists() or not p.is_file() or p.suffix != ".json":
            raise HTTPException(status_code=400, detail="Path must be an existing .json file")

    await Settings.Set("project_rio.hud_path", path, session_id=session_id)

    loaded = await RioGameDataProvider.ReloadHudPath()

    resolved = await get_user_hud_path()
    result = {
        "success": True,
        "resolved": str(resolved) if resolved else None,
    }
    if not loaded:
        parse_err = ""
        if RioGameDataProvider.hud_watcher and RioGameDataProvider.hud_watcher.last_error:
            parse_err = f" Error: {RioGameDataProvider.hud_watcher.last_error}"
        result["warning"] = (
            f"Path is valid but the HUD file could not be read.{parse_err} "
            "The watcher is active and will update when the file changes."
        )
    return ORJSONResponse(result)


def _open_file_dialog() -> str | None:
    """Open the native OS file picker. macOS uses osascript; Windows uses Win32 ctypes."""
    import platform
    import subprocess

    default = get_default_hud_file_path()
    initial_dir = str(default.parent) if default.parent.exists() else str(Path.home())
    system = platform.system()

    if system == "Darwin":
        # AppleScript: runs in its own process, no main-thread requirement
        script = (
            f'set defaultFolder to POSIX file "{initial_dir}"\n'
            'try\n'
            '    set chosen to POSIX path of (choose file '
            'of type {"public.json"} '
            'with prompt "Select decoded.hud.json" '
            'default location defaultFolder)\n'
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
        # Use native Win32 GetOpenFileNameW via ctypes — no subprocess or COM required.
        import ctypes
        import ctypes.wintypes as wt

        OFN_FILEMUSTEXIST = 0x1000
        OFN_PATHMUSTEXIST = 0x0800
        OFN_NOCHANGEDIR   = 0x0008  # don't change the process working directory

        class OPENFILENAMEW(ctypes.Structure):
            _fields_ = [
                ("lStructSize",       wt.DWORD),
                ("hwndOwner",         wt.HWND),
                ("hInstance",         wt.HINSTANCE),
                ("lpstrFilter",       ctypes.c_wchar_p),
                ("lpstrCustomFilter", ctypes.c_wchar_p),
                ("nMaxCustFilter",    wt.DWORD),
                ("nFilterIndex",      wt.DWORD),
                ("lpstrFile",         ctypes.c_void_p),   # writable buffer — use addressof
                ("nMaxFile",          wt.DWORD),
                ("lpstrFileTitle",    ctypes.c_void_p),
                ("nMaxFileTitle",     wt.DWORD),
                ("lpstrInitialDir",   ctypes.c_wchar_p),
                ("lpstrTitle",        ctypes.c_wchar_p),
                ("Flags",             wt.DWORD),
                ("nFileOffset",       wt.WORD),
                ("nFileExtension",    wt.WORD),
                ("lpstrDefExt",       ctypes.c_wchar_p),
                ("lCustData",         wt.LPARAM),
                ("lpfnHook",          ctypes.c_void_p),
                ("lpTemplateName",    ctypes.c_wchar_p),
                ("pvReserved",        ctypes.c_void_p),
                ("dwReserved",        wt.DWORD),
                ("FlagsEx",           wt.DWORD),
            ]

        buf = ctypes.create_unicode_buffer(32768)
        ofn = OPENFILENAMEW()
        ofn.lStructSize    = ctypes.sizeof(OPENFILENAMEW)
        ofn.hwndOwner      = ctypes.windll.user32.GetForegroundWindow()
        ofn.lpstrFilter    = "JSON files (*.json)\0*.json\0All files (*.*)\0*.*\0\0"
        ofn.nFilterIndex   = 1
        ofn.lpstrFile      = ctypes.addressof(buf)
        ofn.nMaxFile       = len(buf)
        ofn.lpstrInitialDir = initial_dir
        ofn.lpstrTitle     = "Select decoded.hud.json"
        ofn.lpstrDefExt    = "json"
        ofn.Flags          = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR

        if ctypes.windll.comdlg32.GetOpenFileNameW(ctypes.byref(ofn)):
            return buf.value or None
        return None

    return None


@method(
    router.post, "/rio/browse-hud",
    version="1", id="rio.browse_hud",
    response_class=ORJSONResponse
)
async def rio_browse_hud(session_id: str | None = None) -> ORJSONResponse:
    """Open the native OS file picker to select the HUD JSON file."""
    import platform
    system = platform.system()
    if system not in ("Darwin", "Windows"):
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {system}")
    selected = await asyncio.to_thread(_open_file_dialog)
    if selected:
        return ORJSONResponse({"success": True, "path": selected})
    return ORJSONResponse({"success": False, "path": None})

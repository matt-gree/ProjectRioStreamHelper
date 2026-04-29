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
        # IFileOpenDialog with FOS_PICKFOLDERS — same modern Explorer-style
        # window as GetOpenFileNameW used for the HUD file picker.
        # IFileDialog is a COM STA object, so we spin a clean dedicated thread,
        # initialise COM there, then join.  asyncio's thread pool threads are
        # not STA and must not call CoInitialize themselves.
        import ctypes
        import ctypes.wintypes as wt
        import threading

        owner_hwnd = ctypes.windll.user32.GetForegroundWindow()
        result_holder: list[str | None] = [None]

        def _pick_folder() -> None:
            ole32 = ctypes.windll.ole32

            class GUID(ctypes.Structure):
                _fields_ = [
                    ("Data1", wt.DWORD),
                    ("Data2", wt.WORD),
                    ("Data3", wt.WORD),
                    ("Data4", ctypes.c_ubyte * 8),
                ]

            def make_guid(d1, d2, d3, d4):
                g = GUID()
                g.Data1, g.Data2, g.Data3 = d1, d2, d3
                for i, b in enumerate(d4):
                    g.Data4[i] = b
                return g

            # CLSID_FileOpenDialog = {DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}
            CLSID_FileOpenDialog = make_guid(
                0xDC1C5A9C, 0xE88A, 0x4DDE,
                (0xA5, 0xA1, 0x60, 0xF8, 0x2A, 0x20, 0xAE, 0xF7),
            )
            # IID_IFileOpenDialog = {D57C7288-D4AD-4768-BE02-9D969532D960}
            IID_IFileOpenDialog = make_guid(
                0xD57C7288, 0xD4AD, 0x4768,
                (0xBE, 0x02, 0x9D, 0x96, 0x95, 0x32, 0xD9, 0x60),
            )

            S_OK                 = 0
            CLSCTX_INPROC_SERVER = 1
            FOS_PICKFOLDERS      = 0x00000020
            FOS_FORCEFILESYSTEM  = 0x00000040
            # SIGDN_FILESYSPATH = 0x80058000 interpreted as signed 32-bit
            SIGDN_FILESYSPATH    = -2147123200

            hr_init = ole32.CoInitialize(None)
            try:
                pfd = ctypes.c_void_p()
                hr = ole32.CoCreateInstance(
                    ctypes.byref(CLSID_FileOpenDialog),
                    None,
                    CLSCTX_INPROC_SERVER,
                    ctypes.byref(IID_IFileOpenDialog),
                    ctypes.byref(pfd),
                )
                if hr != S_OK or not pfd.value:
                    return

                # Helper: call COM vtable method at index idx on ptr.
                def meth(ptr, idx, restype, *argtypes):
                    vptr = ctypes.cast(ptr, ctypes.POINTER(ctypes.c_void_p))
                    vtbl = ctypes.cast(vptr[0], ctypes.POINTER(ctypes.c_void_p))
                    proto = ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)
                    return proto(vtbl[idx])

                pv = pfd.value
                # IFileDialog::SetOptions (vtable 9)
                meth(pv, 9, ctypes.HRESULT, wt.DWORD)(pv, FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
                # IFileDialog::SetTitle (vtable 17)
                meth(pv, 17, ctypes.HRESULT, ctypes.c_wchar_p)(pv, "Select MSB image assets folder")
                # IModalWindow::Show (vtable 3)
                hr = meth(pv, 3, ctypes.HRESULT, wt.HWND)(pv, owner_hwnd)

                if hr == S_OK:
                    psi = ctypes.c_void_p()
                    # IFileDialog::GetResult (vtable 20)
                    hr = meth(pv, 20, ctypes.HRESULT, ctypes.POINTER(ctypes.c_void_p))(pv, ctypes.byref(psi))
                    if hr == S_OK and psi.value:
                        sv = psi.value
                        psz = ctypes.c_wchar_p()
                        # IShellItem::GetDisplayName (vtable 5)
                        hr = meth(sv, 5, ctypes.HRESULT, ctypes.c_int, ctypes.POINTER(ctypes.c_wchar_p))(
                            sv, SIGDN_FILESYSPATH, ctypes.byref(psz)
                        )
                        if hr == S_OK and psz.value:
                            result_holder[0] = psz.value
                            ole32.CoTaskMemFree(psz)
                        meth(sv, 2, wt.ULONG)(sv)  # IShellItem::Release

                meth(pv, 2, wt.ULONG)(pv)  # IFileOpenDialog::Release
            finally:
                if hr_init in (0, 1):  # S_OK or S_FALSE (already initialised)
                    ole32.CoUninitialize()

        t = threading.Thread(target=_pick_folder, daemon=True)
        t.start()
        t.join(timeout=120)
        return result_holder[0]

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

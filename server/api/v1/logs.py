"""Log viewer endpoints: list, tail, and reveal the logs directory.

Logs live alongside user_data in the per-user writable root (see paths.py).
"""

import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from loguru import logger

from server.paths import _frozen_writable_root
from server.utils.router import method

router = APIRouter()


def _logs_dir() -> Path:
    """Resolve the logs directory used by main.py."""
    root = _frozen_writable_root() or Path(".").resolve()
    p = root / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_log_path(name: str) -> Path | None:
    """Resolve a log file name safely inside the logs dir.

    Rejects traversal and anything outside the logs directory. Only allows
    files (no dirs) to avoid surprises with rotated subdirectories.
    """
    if not name:
        return None
    # Strip any path separators; we only want a bare filename.
    if "/" in name or "\\" in name or name.startswith(".."):
        return None
    p = (_logs_dir() / name).resolve()
    try:
        p.relative_to(_logs_dir().resolve())
    except ValueError:
        return None
    return p if p.is_file() else None


@method(
    router.get, "/logs",
    version="1", id="logs.list",
    response_class=ORJSONResponse,
)
async def logs_list(session_id: str | None = None) -> ORJSONResponse:
    """List log files (name, size in bytes, mtime as epoch seconds)."""
    d = _logs_dir()
    items = []
    for entry in sorted(d.iterdir()):
        if entry.is_file():
            st = entry.stat()
            items.append({
                "name": entry.name,
                "size": st.st_size,
                "mtime": st.st_mtime,
            })
    return ORJSONResponse({"dir": str(d), "items": items})


@method(
    router.get, "/logs/tail",
    version="1", id="logs.tail",
    response_class=ORJSONResponse,
)
async def logs_tail(
    name: str = "tsh_info.txt",
    bytes: int = 262144,  # 256 KB default; query-param name kept for API stability
    session_id: str | None = None,
) -> ORJSONResponse:
    """Return the last N bytes of a log file as UTF-8 text.

    If the file is shorter than the requested byte count, returns the whole
    file. If the requested byte offset splits a multi-byte char, we skip
    forward to the next valid UTF-8 boundary.
    """
    p = _safe_log_path(name)
    if p is None:
        raise HTTPException(status_code=404, detail="log not found")

    # Clamp to a sensible max so one request can't hog RAM.
    max_bytes = max(1024, min(int(bytes), 2 * 1024 * 1024))  # 1 KB .. 2 MB

    size = p.stat().st_size
    with p.open("rb") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
            # Align to line start so we don't render a partial first line.
            f.readline()
        data = f.read()
    text = data.decode("utf-8", errors="replace")
    return ORJSONResponse({
        "name": p.name,
        "size": size,
        "returned": len(data),
        "truncated": size > max_bytes,
        "text": text,
    })


@method(
    router.post, "/logs/reveal",
    version="1", id="logs.reveal",
    response_class=ORJSONResponse,
)
async def logs_reveal(session_id: str | None = None) -> ORJSONResponse:
    """Reveal the logs folder in the OS file manager."""
    d = _logs_dir()
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(d)])
    elif sys.platform == "win32":
        os.startfile(str(d))  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", str(d)])
    return ORJSONResponse({"success": True, "dir": str(d)})

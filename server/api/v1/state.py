import asyncio
import platform
import subprocess
from pathlib import Path

from loguru import logger

from server import socketio
from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.state import State

# This only needs to be declared once in the file
router = APIRouter()


# ── SocketIO-only batch handlers ──────────────────────────────────
# Frontend uses these to commit multi-key UI actions (swap teams, runner
# placement, source change) atomically — one disk write, one rebroadcast,
# one diff cycle instead of N. There's no REST equivalent because the
# frontend never writes state via REST; if you ever need one, add it with
# a Pydantic body model.

@socketio.on('v1.state.set_batch')
async def on_state_set_batch(sid, data):
    """Apply a batch of {key, value} entries from a client. Echoes via sid."""
    try:
        items = data.get("items") or []
        entries = [(item["key"], item["value"]) for item in items]
        if entries:
            await State.SetBatch(entries, session_id=sid)
            await State.Save()
        return {"success": True}
    except Exception as e:
        logger.exception("state.set_batch handler failed")
        return {"error": str(e)}


@socketio.on('v1.state.unset_batch')
async def on_state_unset_batch(sid, data):
    """Apply a batch of unset keys from a client. Echoes via sid."""
    try:
        items = data.get("items") or []
        keys = [item["key"] for item in items]
        if keys:
            await State.UnsetBatch(keys, session_id=sid)
            await State.Save()
        return {"success": True}
    except Exception as e:
        logger.exception("state.unset_batch handler failed")
        return {"error": str(e)}

@method(
    router.get, "/state",
    version="1", id="state.get",
    response_class=ORJSONResponse
)
async def state_get(key: str | None = None, session_id: str | None = None) -> ORJSONResponse:
    if key == None or key == "":
        return ORJSONResponse(State.state)
    
    return ORJSONResponse(await State.Get(key))

@method(
    router.put, "/state",
    version="1", id="state.set",
    response_class=ORJSONResponse
)
async def state_set(key: str = "", value: str | None = None, session_id: str | None = None):
    await State.Set(key, value, session_id=session_id)
    await State.Save()
    return ORJSONResponse({"success": True})

@method(
    router.post, "/state/export-all",
    version="1", id="state.export_all",
    response_class=ORJSONResponse
)
async def state_export_all(session_id: str | None = None):
    await State.ExportAll()
    return ORJSONResponse({"success": True})


@method(
    router.post, "/state/stream-labels/reveal",
    version="1", id="state.stream_labels.reveal",
    response_class=ORJSONResponse
)
async def state_stream_labels_reveal(session_id: str | None = None):
    """Reveal the stream_labels export folder in the OS file manager.

    The folder is created on demand if it doesn't exist yet — the user
    may click this before enabling the txt export switch.
    """
    path = Path(str(State._stream_labels_out))
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot create folder: {e}")

    system = platform.system()
    if system == "Darwin":
        await asyncio.to_thread(subprocess.Popen, ["open", str(path)])
    elif system == "Windows":
        await asyncio.to_thread(subprocess.Popen, ["explorer", str(path)])
    else:
        await asyncio.to_thread(subprocess.Popen, ["xdg-open", str(path)])

    return ORJSONResponse({"success": True, "path": str(path)})

@method(
    router.delete, "/state",
    version="1", id="state.unset",
    response_class=ORJSONResponse
)
async def state_unset(key: str = "", session_id: str | None = None):
    await State.Unset(key, session_id=session_id)
    await State.Save()
    return ORJSONResponse({"success": True})
"""Participant registry endpoints — CRUD over the local address book.

Plain @router decorators (not @method): the registry is deliberately OUT of the
State SocketIO broadcast (overlays never read the directory — see
server/participants.py), and the frontend talks to these over REST. No socketio
event registration is needed or wanted here.
"""
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.participants import Participants

router = APIRouter(prefix="/participants", tags=["participants"])


class ParticipantPayload(BaseModel):
    """Partial participant for create/update. Only the blocks present are
    applied; unknown keys inside each block are ignored by the singleton."""
    identities: dict[str, Any] | None = None
    display: dict[str, Any] | None = None
    meta: dict[str, Any] | None = None


class StartGGImportPayload(BaseModel):
    """Bulk import of parsed start.gg players (one element for per-row add).
    The server owns de-dupe so the import is atomic and idempotent."""
    players: list[dict[str, Any]] = []


class ImportPayload(BaseModel):
    """Manual restore of a full address-book backup (the Export shape). Rows are
    whole participant records, not start.gg players. ``replace`` wipes the book
    first; otherwise rows are merged by start.gg userId / rioName."""
    participants: list[dict[str, Any]] = []
    replace: bool = False


@router.get("", response_class=ORJSONResponse)
async def list_participants():
    """List every participant row (the streamer's working set)."""
    return Participants.List()


@router.post("", response_class=ORJSONResponse)
async def create_participant(payload: ParticipantPayload):
    """Create a row from a partial display/identities body."""
    return await Participants.Create(payload.model_dump(exclude_none=True))


@router.put("/{pid}", response_class=ORJSONResponse)
async def update_participant(pid: str, payload: ParticipantPayload):
    """Merge-update an existing row. 404 if it doesn't exist."""
    row = await Participants.Update(pid, payload.model_dump(exclude_none=True))
    if row is None:
        raise HTTPException(404, f"participant {pid!r} not found")
    return row


@router.delete("/{pid}", response_class=ORJSONResponse)
async def delete_participant(pid: str):
    """Delete a row. 404 if it doesn't exist."""
    if not await Participants.Delete(pid):
        raise HTTPException(404, f"participant {pid!r} not found")
    return {"success": True}


@router.get("/export", response_class=ORJSONResponse)
async def export_participants():
    """Full address-book snapshot for manual backup / transfer between
    machines. Round-trips through POST /import."""
    return Participants.Export()


@router.post("/import", response_class=ORJSONResponse)
async def import_participants(payload: ImportPayload):
    """Restore an exported address book. Merges by default (non-destructive);
    ``replace=true`` wipes the book first for an exact restore."""
    return await Participants.ImportRows(payload.participants, replace=payload.replace)


@router.post("/import/startgg", response_class=ORJSONResponse)
async def import_startgg(payload: StartGGImportPayload):
    """Upsert parsed start.gg players into the registry (D1: explicit, never
    automatic). De-dupes by start.gg userId, then by rioName==gamerTag. Returns
    the resulting rows so the client can replace-by-id without a refetch."""
    rows = []
    for player in payload.players:
        rows.append(await Participants.UpsertFromStartGG(player))
    return {"imported": len(rows), "rows": rows}

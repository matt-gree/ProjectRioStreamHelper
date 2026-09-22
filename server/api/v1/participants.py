"""Participant registry endpoints — CRUD over the local address book.

Plain @router decorators (not @method): the registry is deliberately OUT of the
State SocketIO broadcast (overlays never read the directory — see
server/participants.py), and the frontend talks to these over REST. No socketio
event registration is needed or wanted here.
"""
from typing import Any

import re

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import ORJSONResponse, Response
from pydantic import BaseModel

from server.participants import MAIN_BOOK, Participants

router = APIRouter(prefix="/participants", tags=["participants"])


class ParticipantPayload(BaseModel):
    """Partial participant for create/update. Only the blocks present are
    applied; unknown keys inside each block are ignored by the singleton."""
    identities: dict[str, Any] | None = None
    display: dict[str, Any] | None = None
    # Production preferences (today: `side`, the cascade's pin layer). A block
    # missing here is dropped by pydantic before the singleton ever sees it,
    # which is how a new field silently fails to save. `exclude_none` drops the
    # BLOCK when absent, not an explicit `{"side": None}` — so clearing a pin
    # still reaches Update.
    prefs: dict[str, Any] | None = None
    meta: dict[str, Any] | None = None
    # Which book the row is in (schema v2). Its logo is set through
    # `/{pid}/logo`, never here — a logo is a file, not a field.
    book: str | None = None


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
    # The book to import INTO (default `main`), and the export's own `book`
    # block — consulted only for an OLD file whose logos hung off teams.
    target: str = MAIN_BOOK
    book: dict[str, Any] | None = None


class BookPayload(BaseModel):
    name: str | None = None
    modes: list[str] | None = None


class CommunityPayload(BaseModel):
    community: str


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
    """The main book's snapshot — kept at its old path for anything that
    scripted a backup. Round-trips through POST /import."""
    return Participants.Export(MAIN_BOOK)


@router.post("/import", response_class=ORJSONResponse)
async def import_participants(payload: ImportPayload):
    """Restore an exported book INTO an existing one (``target``, default
    main). Merges by default (non-destructive); ``replace=true`` wipes that
    book's people first for an exact restore."""
    if payload.target not in Participants.books:
        raise HTTPException(404, f"book {payload.target!r} not found")
    return await Participants.ImportRows(
        payload.participants,
        replace=payload.replace,
        book=payload.target,
        teams=(payload.book or {}).get("teams"),
    )


# ----- books -----------------------------------------------------------------


@router.get("/books", response_class=ORJSONResponse)
async def list_books():
    """Every book (main first), each with its league modes and a people `count`."""
    return Participants.ListBooks()


@router.post("/books", response_class=ORJSONResponse)
async def create_book(payload: BookPayload):
    return await Participants.CreateBook(payload.model_dump(exclude_none=True))


async def _read_shared(file: UploadFile):
    """A shared book file, zip or (older) JSON → (payload, {logo path: bytes})."""
    import orjson

    data = await file.read()
    if data[:2] == b"PK":
        try:
            return Participants.ReadZip(data)
        except ValueError as e:
            raise HTTPException(400, str(e))
    try:
        payload = orjson.loads(data)
    except Exception:
        raise HTTPException(400, "Not an address-book file (expected a .zip or .json)")
    if isinstance(payload, list):
        payload = {"participants": payload}
    if not isinstance(payload, dict):
        raise HTTPException(400, "Not an address-book file")
    return payload, {}


@router.post("/books/import/file", response_class=ORJSONResponse)
async def import_shared_book_file(file: UploadFile = File(...)):
    """Open a book file — a `.prsh-book.zip`, or a JSON book shared before
    zips — as a NEW book: league, people and their logos.

    THE ONLY FILE WAY IN. A sibling `POST /import/file` took the same file
    INTO an existing book, merging or replacing it; it existed for the page's
    Import button and went with it on 2026-09-19, because a file somebody
    sends you is their book and opening it must not be able to rewrite yours.
    A scripted merge or exact restore is still `POST /import`, which takes
    rows in a body rather than a file — a caller that means it, not a click.
    """
    payload, files = await _read_shared(file)
    return await Participants.ImportAsNewBook(payload, files)


@router.get("/communities", response_class=ORJSONResponse)
async def list_communities():
    """Every Rio community, by name — what a league book can be pulled from."""
    from server.rio import stats_api

    try:
        return await stats_api.fetch_communities()
    except Exception as e:
        raise HTTPException(502, f"Could not reach Project Rio: {e}")


@router.post("/books/{bid}/community", response_class=ORJSONResponse)
async def pull_community(bid: str, payload: CommunityPayload):
    """Bring every player in a Rio community into book ``bid``.

    Answers with who came in and HOW: ``source`` is ``members`` when Rio handed
    over the community's own list, ``games`` when the community is private to
    this Rio key and its players were taken from the games in its modes."""
    from server.rio import stats_api

    if bid not in Participants.books:
        raise HTTPException(404, f"book {bid!r} not found")
    try:
        roster = await stats_api.fetch_community_roster(payload.community)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(502, f"Could not reach Project Rio: {e}")
    result = await Participants.AddPlayers(
        bid, roster["usernames"], community=roster["community"], modes=roster["modes"],
    )
    return {**result, "source": roster["source"], "found": len(roster["usernames"])}


@router.put("/books/{bid}", response_class=ORJSONResponse)
async def update_book(bid: str, payload: BookPayload):
    book = await Participants.UpdateBook(bid, payload.model_dump(exclude_none=True))
    if book is None:
        raise HTTPException(404, f"book {bid!r} not found")
    return book


@router.delete("/books/{bid}", response_class=ORJSONResponse)
async def delete_book(bid: str):
    if bid == MAIN_BOOK:
        raise HTTPException(400, "The main address book cannot be deleted")
    if not await Participants.DeleteBook(bid):
        raise HTTPException(404, f"book {bid!r} not found")
    return {"success": True}


@router.get("/books/{bid}/export", response_class=ORJSONResponse)
async def export_book(bid: str):
    """One book as JSON — people and league, WITHOUT logo files. What
    the main book's backup is; a book with logos is shared as the zip."""
    data = Participants.Export(bid)
    if data is None:
        raise HTTPException(404, f"book {bid!r} not found")
    return data


@router.get("/books/{bid}/export.zip")
async def export_book_zip(bid: str):
    """One book, whole — `book.json` + `logos/` — the file a producer shares."""
    data = Participants.ExportZip(bid)
    if data is None:
        raise HTTPException(404, f"book {bid!r} not found")
    name = re.sub(r"[^a-z0-9]+", "-", Participants.books[bid]["name"].casefold()).strip("-") or "address-book"
    return Response(
        data, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}.prsh-book.zip"'},
    )


@router.post("/{pid}/logo", response_class=ORJSONResponse)
async def upload_logo(pid: str, file: UploadFile = File(...)):
    """Replace a person's league logo (PNG/JPEG/WebP/SVG, max 10 MB — the
    console scales rasters down first). Returns the updated row."""
    data = await file.read()
    try:
        row = await Participants.SetLogo(pid, data, file.content_type or "")
    except ValueError as e:
        raise HTTPException(400, str(e))
    if row is None:
        raise HTTPException(404, f"participant {pid!r} not found")
    return row


@router.delete("/{pid}/logo", response_class=ORJSONResponse)
async def delete_logo(pid: str):
    row = await Participants.SetLogo(pid, None)
    if row is None:
        raise HTTPException(404, f"participant {pid!r} not found")
    return row


@router.post("/import/startgg", response_class=ORJSONResponse)
async def import_startgg(payload: StartGGImportPayload):
    """Upsert parsed start.gg players into the registry (D1: explicit, never
    automatic). De-dupes by start.gg userId, then by rioName==gamerTag. Returns
    the resulting rows so the client can replace-by-id without a refetch."""
    rows = []
    for player in payload.players:
        rows.append(await Participants.UpsertFromStartGG(player))
    # Fan out ONCE for the batch, here rather than inside UpsertFromStartGG:
    # an event import is one call per entrant, and each projector writes its
    # full key set, so re-projecting per row would multiply a 64-player import
    # into 320 full re-projections for a single button press.
    if rows:
        await Participants.reproject_dependents()
    return {"imported": len(rows), "rows": rows}

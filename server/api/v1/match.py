"""Match endpoints — CRUD over the fixture object above scoreboards.

Plain @router decorators (not @method): a Match lives in the State store, so its
fields are already broadcast to clients through ``State.Set``/``SetBatch`` whenever
this handler writes them — there is no separate socketio event to register. The
authoring UI reads ``match.{M}.*`` straight from the state broadcast, like
``score.*``; it only POSTs/PUTs through these routes (mirrors participants.py).

Every write re-projects the affected board(s) so the bound scoreboard's overlay
reflects the fixture immediately. See ``server/match.py`` for the projection.
"""
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.match import Match, default_match
from server.state import State

router = APIRouter(prefix="/match", tags=["match"])


class MatchPayload(BaseModel):
    """Partial match for update. Only the blocks present are applied; nested
    dicts are flattened into ``match.{M}.<dotpath>`` leaf writes."""

    label: str | None = None
    stage: str | None = None
    format: dict[str, Any] | None = None
    gameMode: str | None = None
    provider: dict[str, Any] | None = None
    player: dict[str, Any] | None = None


class BindPayload(BaseModel):
    """Bind a scoreboard to a match, or unbind when ``match`` is null."""

    match: int | None = None


def _flatten(prefix: str, obj: dict, out: list[tuple]) -> None:
    for k, v in obj.items():
        key = f"{prefix}.{k}"
        if isinstance(v, dict):
            _flatten(key, v, out)
        else:
            out.append((key, v))


@router.get("", response_class=ORJSONResponse)
async def list_matches():
    """All matches keyed by id (``{M: {...}}``)."""
    return State.state.get("match", {}) or {}


@router.get("/{m}", response_class=ORJSONResponse)
async def get_match(m: int):
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")
    return Match.get(m)


@router.post("", response_class=ORJSONResponse)
async def create_match():
    """Create the next match with default fields. Returns its id + body."""
    m = Match.next_id()
    body = default_match()
    await State.Set(f"match.{m}", body)
    await State.Save()
    return {"id": m, "match": body}


@router.put("/{m}", response_class=ORJSONResponse)
async def update_match(m: int, payload: MatchPayload):
    """Merge-update a match (partial), then re-project bound boards. 404 if the
    match doesn't exist."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    entries: list[tuple] = []
    _flatten(f"match.{m}", payload.model_dump(exclude_none=True), entries)
    if entries:
        await State.SetBatch(entries)
        await State.Save()
    await Match.project_match(m)
    return Match.get(m)


@router.delete("/{m}", response_class=ORJSONResponse)
async def delete_match(m: int):
    """Delete a match. Unbinds and blanks any boards bound to it first."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    for sb in Match.bound_scoreboards(m):
        await State.Unset(f"score.{sb}.match")
        await Match.clear_scoreboard(sb)

    await State.Unset(f"match.{m}")
    await State.Save()
    return {"success": True}


# Binding lives under /scoreboards/{N}/match but is owned here (it's match logic).
bind_router = APIRouter(prefix="/scoreboards", tags=["match"])


@bind_router.put("/{sb}/match", response_class=ORJSONResponse)
async def bind_scoreboard(sb: int, payload: BindPayload):
    """Bind board ``sb`` to a match (or unbind + blank when ``match`` is null)."""
    m = payload.match
    if m is not None and not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    if m is None:
        await State.Unset(f"score.{sb}.match")
        await State.Save()
        await Match.clear_scoreboard(sb)
    else:
        await State.Set(f"score.{sb}.match", m)
        await State.Save()
        await Match.project_scoreboard(sb, m)
    return {"success": True, "match": m}

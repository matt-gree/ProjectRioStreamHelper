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
    series: dict[str, Any] | None = None
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
        await State.Unset(f"score.{sb}.match_conflict")
        await Match.clear_scoreboard(sb)

    await State.Unset(f"match.{m}")
    await State.Save()
    return {"success": True}


class StartGGSetPayload(BaseModel):
    """Load a start.gg set's players into a match's sides."""

    setId: int


@router.post("/{m}/flip", response_class=ORJSONResponse)
async def flip_match(m: int):
    """Swap participant 1↔2 on the fixture (authoring), carrying series wins."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")
    await Match.flip_sides(m)
    return Match.get(m)


class DecidePayload(BaseModel):
    """Force-decide the series for a side (null clears the decided flag)."""

    side: int | None = None


@router.post("/{m}/decide", response_class=ORJSONResponse)
async def decide_match(m: int, payload: DecidePayload):
    """Producer override: force the series decided for ``side`` (or clear)."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")
    await Match.force_decide(m, payload.side)
    return Match.get(m)


@router.post("/{m}/startgg-set", response_class=ORJSONResponse)
async def load_startgg_set(m: int, payload: StartGGSetPayload):
    """Fill match ``m`` from a start.gg set.

    Fetches the set with full player detail, upserts each player into the
    participant registry (start.gg userId de-dupe — same path as the Competition
    import), and seats slot 0/1 on sides 1/2 with the registry row's
    participantId + rioName (rioName stays empty until the entrant is mapped;
    the projection still resolves display identity from the row). Also stamps
    the round name as the match label and records the set id, then re-projects.
    """
    from server.participants import Participants
    from server.startgg.provider import StartGGProvider

    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    s = await StartGGProvider.GetSet(payload.setId)
    if not s or s.get("error"):
        raise HTTPException(400, (s or {}).get("error") or "Set not found")

    entrants = s.get("entrants") or [[], []]
    entries: list[tuple] = []
    for side, players in ((1, entrants[0] if len(entrants) > 0 else []),
                          (2, entrants[1] if len(entrants) > 1 else [])):
        player = players[0] if players else None
        if not player:
            continue
        row = await Participants.UpsertFromStartGG(player)
        rio = (row.get("identities") or {}).get("rioName") or ""
        entries.append((f"match.{m}.player.{side}.participantId", row["id"]))
        entries.append((f"match.{m}.player.{side}.rioName", rio))

    if s.get("round_name"):
        entries.append((f"match.{m}.label", s["round_name"]))
    entries.append((f"match.{m}.provider.startgg.setId", payload.setId))

    await State.SetBatch(entries)
    await State.Save()
    await Match.project_match(m)
    return Match.get(m)


# Binding lives under /scoreboards/{N}/match but is owned here (it's match logic).
bind_router = APIRouter(prefix="/scoreboards", tags=["match"])


@bind_router.put("/{sb}/match", response_class=ORJSONResponse)
async def bind_scoreboard(sb: int, payload: BindPayload):
    """Bind board ``sb`` to a match (or unbind + blank when ``match`` is null).

    A match encodes both sides of a single fixture, so it only binds to a
    ``single``-kind board (a HUD board is single by construction). Binding to a
    ``set`` (rotating feed) board is rejected — a rotation has no fixed sides to
    project onto.
    """
    m = payload.match
    if m is not None and not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    if m is None:
        await State.Unset(f"score.{sb}.match")
        await State.Unset(f"score.{sb}.match_conflict")
        await State.Save()
        await Match.clear_scoreboard(sb)
    else:
        from server.bindings import is_set
        if is_set(sb):
            raise HTTPException(
                409,
                f"scoreboard {sb} is a rotating set — bind a match to a single-game board",
            )
        await State.Set(f"score.{sb}.match", m)
        await State.Save()
        await Match.project_scoreboard(sb, m)
    return {"success": True, "match": m}


@bind_router.post("/{sb}/match-conflict/dismiss", response_class=ORJSONResponse)
async def dismiss_match_conflict(sb: int):
    """Producer override: clear a board's match conflict, keeping the match bound
    (the "keep + ignore this game" resolution). The bound match stays put; the
    live game runs as-is until the next new game re-evaluates the gate."""
    await State.Set(f"score.{sb}.match_conflict", None)
    await State.Save()
    return {"success": True}

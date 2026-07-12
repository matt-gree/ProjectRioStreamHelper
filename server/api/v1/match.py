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

from server.match import Match, _norm_side, default_match
from server.rio.provider import RioGameDataProvider
from server.schedule import Schedule
from server.state import State

router = APIRouter(prefix="/match", tags=["match"])


async def _regate_bound_boards(m) -> None:
    """Re-run the identity gate on every board bound to match ``m`` against the
    current live game. Called after a match mutation that can change identity
    (participant edit, flip, set load, decide) so a conflict raised/cleared by
    the change surfaces immediately instead of only on the next new game."""
    for sb in Match.bound_scoreboards(m):
        await RioGameDataProvider.evaluate_match_gate_for_board(sb)


def _sync_primary_if(m) -> None:
    """Schedule the primary-match surface auto-prep (Matchup band + Player Plates)
    when a mutation touched the *primary* match's players. A no-op for any other
    match. Fire-and-forget — never blocks or fails the match write."""
    if str(m) == str(Match.PRIMARY_MATCH_ID):
        Match.schedule_primary_sync()


class MatchPayload(BaseModel):
    """Partial match for update. Only the blocks present are applied; nested
    dicts are flattened into ``match.{M}.<dotpath>`` leaf writes."""

    label: str | None = None
    phase: str | None = None
    stage: str | None = None
    scheduledAt: str | None = None
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
    await _regate_bound_boards(m)
    _sync_primary_if(m)
    return Match.get(m)


@router.delete("/{m}", response_class=ORJSONResponse)
async def delete_match(m: int):
    """Delete a match. Unbinds and blanks any boards bound to it first, and
    prunes it from the schedule queue."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    for sb in Match.bound_scoreboards(m):
        await State.Unset(f"score.{sb}.match")
        await State.Unset(f"score.{sb}.match_conflict")
        await Match.clear_scoreboard(sb)

    await State.Unset(f"match.{m}")
    await State.Save()
    await Schedule.remove(m)
    return {"success": True}


class StartGGSetPayload(BaseModel):
    """Load a start.gg set's players into a match's sides.

    ``setId`` is ``int | str`` because an *unseeded* phase hands out synthetic
    ``preview_<phaseGroupId>_<round>_<idx>`` string ids, not numeric ones."""

    setId: int | str


@router.post("/{m}/flip", response_class=ORJSONResponse)
async def flip_match(m: int):
    """Swap participant 1↔2 on the fixture (authoring), carrying series wins."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")
    await Match.flip_sides(m)
    await _regate_bound_boards(m)
    _sync_primary_if(m)
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
    await _regate_bound_boards(m)
    return Match.get(m)


def _game_count(v) -> int | None:
    """A reported set score usable as a series game count: a non-negative int
    (W/L strings carry no count; start.gg marks DQs with -1)."""
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


async def apply_startgg_set(m, s: dict, set_id: int) -> None:
    """Seat a fetched start.gg set (``GetSet`` result) onto match ``m``.

    Upserts each slot-0 player into the participant registry (start.gg userId
    de-dupe — same path as the Competition import) and seats them on sides 1/2
    with the registry row's participantId + rioName (rioName stays empty until
    the entrant is mapped; the projection still resolves display identity from
    the row). Also stamps the round name as the match label, the bracket's
    best-of (start.gg ``totalGames``), any already-reported numeric set score
    into the series, and the set id — then re-projects bound boards.
    """
    from server.participants import Participants

    entrants = s.get("entrants") or [[], []]
    seeds = s.get("seeds") or [None, None]
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
        # Bracket seed → match side, for intro elements (the Matchup band).
        entries.append((f"match.{m}.player.{side}.seed", seeds[side - 1] if side - 1 < len(seeds) else None))

    if s.get("round_name"):
        entries.append((f"match.{m}.label", s["round_name"]))

    # Competition phase (start.gg phase name, e.g. "Swiss Qualifier" / "Top Cut")
    # + bracket type. The phase name is exactly the "where in the competition are
    # we" descriptor the global Competition Phase field wants, so populate it from
    # the loaded set; also stamp it on the match for per-fixture Bracket/Phase/
    # Round surfaces. Only write when present so a detail-less set never blanks a
    # producer's manual phase text.
    phase = (s.get("tournament_phase") or "").strip()
    if phase:
        entries.append(("tournamentInfo.phase", phase))
        entries.append((f"match.{m}.phase", phase))
    bracket_type = s.get("bracket_type") or ""
    if bracket_type:
        entries.append((f"match.{m}.bracketType", bracket_type))

    # Bracket format → series format, so the decided arithmetic runs on the
    # bracket's real best-of instead of a hand-typed one.
    best_of = s.get("totalGames")
    if isinstance(best_of, int) and best_of >= 1:
        entries.append((f"match.{m}.format.bestOf", best_of))
    else:
        best_of = int((Match.get(m).get("format") or {}).get("bestOf") or 1)

    # Seed the series from an already-reported set score (loading mid-set, or
    # after a PRSH restart). W/L-only brackets carry no game counts — skip.
    w1, w2 = _game_count(s.get("team1score")), _game_count(s.get("team2score"))
    if w1 is not None and w2 is not None:
        entries.append((f"match.{m}.series.1", w1))
        entries.append((f"match.{m}.series.2", w2))
        # Mirror award_game: first side at ceil(bestOf/2) owns `decided`; a
        # producer's existing decided flag is never stomped.
        if _norm_side(Match.get(m).get("decided")) is None:
            need = best_of // 2 + 1
            clinched = 1 if w1 >= need else 2 if w2 >= need else None
            if clinched:
                entries.append((f"match.{m}.decided", clinched))

    entries.append((f"match.{m}.provider.startgg.setId", set_id))

    await State.SetBatch(entries)
    await State.Save()
    await Match.project_match(m)
    await _regate_bound_boards(m)
    _sync_primary_if(m)


@router.post("/{m}/startgg-set", response_class=ORJSONResponse)
async def load_startgg_set(m: int, payload: StartGGSetPayload):
    """Fill match ``m`` from a start.gg set (see ``apply_startgg_set``)."""
    from server.startgg.provider import StartGGProvider

    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    s = await StartGGProvider.GetSet(payload.setId)
    if not s or s.get("error"):
        raise HTTPException(400, (s or {}).get("error") or "Set not found")

    await apply_startgg_set(m, s, payload.setId)
    return Match.get(m)


def _match_for_setid(set_id) -> int | None:
    """The existing match already holding this start.gg set id, or None."""
    for k, v in (State.state.get("match", {}) or {}).items():
        if not isinstance(v, dict):
            continue
        provider = v.get("provider") or {}
        if (provider.get("startgg") or {}).get("setId") == set_id:
            try:
                return int(k)
            except (TypeError, ValueError):
                continue
    return None


@router.post("/from-startgg", response_class=ORJSONResponse)
async def match_from_startgg(payload: StartGGSetPayload):
    """Create (or reuse) a match seeded from a start.gg set — without binding any
    board. This is the bracket page's "make a match for this set" path: sets load
    into a match, and the producer binds that match to a board on the Match tab.
    Reusing the match that already holds this set id keeps re-loading idempotent.
    """
    from server.startgg.provider import StartGGProvider

    s = await StartGGProvider.GetSet(payload.setId)
    if not s or s.get("error"):
        raise HTTPException(400, (s or {}).get("error") or "Set not found")

    m = _match_for_setid(payload.setId)
    created = m is None
    if created:
        m = Match.next_id()
        await State.Set(f"match.{m}", default_match())
        await State.Save()

    await apply_startgg_set(m, s, payload.setId)
    return {"id": m, "created": created, "match": Match.get(m)}


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
        from server.bindings import is_rotating
        if is_rotating(sb):
            raise HTTPException(
                409,
                f"scoreboard {sb} is rotating — bind a match to a single-game board",
            )
        await State.Set(f"score.{sb}.match", m)
        await State.Save()
        await Match.project_scoreboard(sb, m)
        # Re-run the identity gate against the current live game so a mismatch
        # created by binding mid-game surfaces the conflict now, rather than
        # waiting for the next new-game event (or an app restart).
        await RioGameDataProvider.evaluate_match_gate_for_board(sb)
    return {"success": True, "match": m}


@bind_router.post("/{sb}/match-conflict/dismiss", response_class=ORJSONResponse)
async def dismiss_match_conflict(sb: int):
    """Producer override: clear a board's match conflict, keeping the match bound
    (the "keep + ignore this game" resolution). The bound match stays put; the
    live game runs as-is until the next new game re-evaluates the gate."""
    await State.Set(f"score.{sb}.match_conflict", None)
    await State.Save()
    return {"success": True}

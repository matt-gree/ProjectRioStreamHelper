"""Match endpoints — CRUD over the fixture object above scoreboards.

Plain @router decorators (not @method): a Match lives in the State store, so its
fields are already broadcast to clients through ``State.Set``/``SetBatch`` whenever
this handler writes them — there is no separate socketio event to register. The
authoring UI reads ``match.{M}.*`` straight from the state broadcast, like
``score.*``; it only POSTs/PUTs through these routes (mirrors participants.py).

Every write re-projects the affected board(s) so the bound scoreboard's overlay
reflects the fixture immediately. See ``server/match.py`` for the projection.
"""
import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server.bindings import transport
from server.boards import board_lifecycle, is_stale
from server.match import Match, _norm_side, default_match
from server.rio.provider import RioGameDataProvider, release_and_clear_game
from server.schedule import Schedule
from server.startgg.provider import auto_fill_entries
from server.state import State

router = APIRouter(prefix="/match", tags=["match"])


async def _resettle_bound_boards(m) -> None:
    """Settle every board bound to match ``m`` against the current live game.

    Called after a match mutation that can change identity (participant edit,
    flip, set load, decide). Two things consult the fixture and normally only run
    when a FRAME arrives, so both have to be nudged here or the board keeps
    describing the previous fixture until the feed speaks again:

    1. the identity gate, so a conflict raised or cleared by the change surfaces
       now rather than on the next new game;
    2. the side cascade, so the live team, logo and roster follow the names. A
       flip moved only the projected names, leaving one player's name over the
       other's logo, and `side_reason` naming a layer that had changed.

    Gate first: it can auto-retire a decided mismatch, and that unbind changes
    what the cascade decides.
    """
    for sb in Match.bound_scoreboards(m):
        await _settle_board(sb)


async def _settle_board(sb: int) -> None:
    """Gate, then re-orient, one board against the live game (see above)."""
    await RioGameDataProvider.evaluate_match_gate_for_board(sb)
    await RioGameDataProvider.reorient_board(sb)


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
    # Constrained because `stage` is an INPUT now (the Match desk's badge is a
    # control), and it gates Up next: anything that is not exactly "draft" reads
    # as already played. A typo — "Draft" — would strand the fixture out of the
    # running order with a reason that blames a stage nothing set.
    stage: Literal["draft", "live", "post"] | None = None
    scheduledAt: str | None = None
    format: dict[str, Any] | None = None
    series: dict[str, Any] | None = None
    gameMode: str | None = None
    provider: dict[str, Any] | None = None
    player: dict[str, Any] | None = None


class BindPayload(BaseModel):
    """Bind a scoreboard to a match, or unbind when ``match`` is null."""

    match: int | None = None


def _side_wins(src: dict, side: int) -> int:
    """One side's wins out of a series dict, whichever way its keys are typed."""
    try:
        return int(src.get(str(side), src.get(side)) or 0)
    except (TypeError, ValueError):
        return 0


def _check_series_fits(m: int, payload: "MatchPayload") -> None:
    """A SERIES MAY NOT HOLD MORE GAMES THAN THE FORMAT ALLOWS.

    The desk's steppers are the only caller that writes ``series`` by hand, and
    they clamp themselves — this is the backstop that makes the rule the
    RECORD's rather than one surface's, since the same PUT is a plain REST call.

    Stated as "may not INCREASE past the format", not "may not exceed it",
    because the two come apart on the one move that must stay available:
    LOWERING ``bestOf`` under a series already longer than it (a Bo3 at 2-1 set
    back to a Bo1). That is not adding a game, and rejecting it would trap the
    producer in a format they cannot leave without first zeroing a score that is
    on air. So an over-full series can always be corrected DOWN, and only a write
    that makes it longer is refused.
    """
    if payload.series is None:
        return
    best = payload.format.get("bestOf") if payload.format else None
    if best is None:
        best = (Match.get(m).get("format") or {}).get("bestOf")
    try:
        best = int(best or 1)
    except (TypeError, ValueError):
        best = 1

    cur = Match.get(m).get("series") or {}
    merged = {str(k): v for k, v in cur.items()}
    merged.update({str(k): v for k, v in payload.series.items()})
    now = _side_wins(cur, 1) + _side_wins(cur, 2)
    nxt = _side_wins(merged, 1) + _side_wins(merged, 2)
    if nxt > best and nxt > now:
        raise HTTPException(
            409,
            f"match {m} allows {best} game{'' if best == 1 else 's'}: a series of "
            f"{nxt} is more than the format holds",
        )


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
async def create_match(queue: str | None = None):
    """Create the next match with default fields, enrolled in a running order.

    A new fixture joins a running order because that is what creating one almost
    always means — it is tonight's next match. Before this, a producer could
    author eight fixtures and find the schedule overlay empty and every board's
    Up next silent, with nothing on the desk saying why. Taking one back out is
    one click on the Match desk (`DELETE /schedule/queue/{m}`).

    WHICH order is the caller's to name. Omitted means the first, which is the
    whole answer on a single-order rig; a rig running winners and losers has two,
    and creating into the one you are looking at beats creating into the first
    and moving it — the move is a second verb, on a control the producer has to
    find, for a fixture they already knew the home of.

    404 on an order that does not exist, and on an EMPTY id: `get_queue("")`
    answers with the first by design, so accepting it would silently enrol into
    an order nobody named (cf. `_require_queue` in the schedule routes).
    """
    if queue is not None:
        await Schedule.ensure_migrated()
        if not queue or Schedule.get_queue(queue) is None:
            raise HTTPException(404, f"queue {queue!r} does not exist")
    m = Match.next_id()
    body = default_match()
    await State.Set(f"match.{m}", body)
    await State.Save()
    await Schedule.append(m, queue)
    return {"id": m, "match": body}


@router.put("/{m}", response_class=ORJSONResponse)
async def update_match(m: int, payload: MatchPayload):
    """Merge-update a match (partial), then re-project bound boards. 404 if the
    match doesn't exist."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")
    _check_series_fits(m, payload)

    entries: list[tuple] = []
    _flatten(f"match.{m}", payload.model_dump(exclude_none=True), entries)
    if entries:
        await State.SetBatch(entries)
        await State.Save()
    await Match.project_match(m)
    await _resettle_bound_boards(m)
    _sync_primary_if(m)
    return Match.get(m)


@router.delete("/{m}", response_class=ORJSONResponse)
async def delete_match(m: int):
    """Delete a match. Unbinds and blanks any boards bound to it first, and
    prunes it from the schedule queue."""
    if not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    for sb in Match.bound_scoreboards(m):
        await _unbind_board(sb)

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
    await _resettle_bound_boards(m)
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
    await _resettle_bound_boards(m)
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
    # Round surfaces.
    #
    # The GLOBAL field goes through the auto-fill record, the same as every other
    # tournamentInfo field start.gg supplies. It used to be a bare write guarded
    # only against blanking, so a producer's hand-typed "Season 9 Week 2" was
    # protected from a detail-less set and destroyed by a detailed one — every
    # set load, silently. The PER-MATCH copy is unconditional and should be: it
    # is this set's own fact, not a field anyone types.
    phase = (s.get("tournament_phase") or "").strip()
    if phase:
        entries.extend(auto_fill_entries({"phase": phase}, skip_blank=True))
        entries.append((f"match.{m}.phase", phase))
    bracket_type = s.get("bracket_type") or ""
    if bracket_type:
        entries.append((f"match.{m}.bracketType", bracket_type))

    # Bracket format → series format, so the decided arithmetic runs on the
    # bracket's real best-of instead of a hand-typed one.
    best_of = s.get("totalGames")
    if isinstance(best_of, int) and best_of >= 1:
        # `_need()` (server/match.py) uses a majority (bestOf // 2 + 1) to
        # decide a series — an even bestOf has no majority (e.g. 4 needs 3,
        # so does 5) and can end all-square, undecidable. Bump to the next
        # odd number so whatever start.gg reports always yields a decidable
        # series.
        if best_of % 2 == 0:
            best_of += 1
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
    await _resettle_bound_boards(m)
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
        # Same rule as create_match: a set pulled off the bracket is a fixture for
        # tonight. Reusing an existing match leaves the order alone — it is already
        # placed, and re-loading a set must not shuffle the running order.
        await Schedule.append(m)

    await apply_startgg_set(m, s, payload.setId)
    return {"id": m, "created": created, "match": Match.get(m)}


# Binding lives under /scoreboards/{N}/match but is owned here (it's match logic).
bind_router = APIRouter(prefix="/scoreboards", tags=["match"])


def require_board(sb: int) -> int:
    """404 unless board ``sb`` is actually in the rig.

    Board ids arrive from requests, and nothing downstream checks them: binding a
    match to a board that does not exist writes `score.{sb}.match` for a board no
    layout reads and no rack row lists — a phantom board's state that persists and
    that the UI has no way to show or clear. Found by driving
    `POST /scoreboards/2/next-match` against a one-board rig, which happily
    reported success.

    The guard belongs on the ROUTES, not in `bind_board`: "is this id in the rig"
    is input validation whose answer is an HTTP status, where `bind_board` holds
    the data invariant (a match fills exactly one board) for callers that already
    have a real board.
    """
    from server.settings import Settings
    active = Settings.Get("scoreboards.active", [1]) or [1]
    if int(sb) not in [int(x) for x in active]:
        raise HTTPException(404, f"scoreboard {sb} is not in the rig")
    return int(sb)


async def _unbind_board(sb: int) -> None:
    """Drop board ``sb``'s binding and blank the keys the projector owns.

    Then re-settle the board: the cascade consulted the match that just went
    away, so without this the board keeps reporting `side_reason` as `match` —
    explaining its orientation by a layer no longer there — and keeps the
    orientation that layer chose, until the next feed frame.

    An UNPLAYED fixture also gives back the `live` stage the feed gave it — see
    ``Match.note_unbound``, which owns that rule and its guard. Read the id
    first: the unset below is what makes it unreachable.
    """
    m = Match.scoreboard_match(sb)
    await State.UnsetBatch([f"score.{sb}.match", f"score.{sb}.match_conflict"])
    await State.Save()
    await Match.note_unbound(m)
    await Match.clear_scoreboard(sb)
    await RioGameDataProvider.reorient_board(sb)


async def _clear_superseded_game(sb: int) -> None:
    """Clear a board's game as part of TURNING THE BOARD OVER to the next fixture.

    BINDING IS AUTHORING; TAKING IS TURNOVER. Only the second one clears, and
    conflating them is a bug this function used to carry.

    It ran inside `bind_board`, so EVERY path that attaches a fixture inherited it
    — the Match desk's board chips, the board desk's bind, the start.gg set loader.
    Attaching a match to a HUD board therefore BLANKED THE PRODUCER'S SCOREBOARD:
    on a HUD board the game on screen is whatever Project Rio is showing, saying
    "this game is Match 5" is the ordinary working gesture, and PRSH answered it by
    deleting the game. That is backwards, and it is worse than leaving stale data,
    because the producer did not ask for anything to be removed and nothing said
    anything was.

    What the auto-clear was originally hired for is already solved elsewhere, and
    better. The real defect behind "a new match attaches to the previous
    scoreboard" was the PROJECTOR deferring to stale feed data and dropping its
    picks, which `Match._board_side_has_feed_data` now answers directly by not
    treating a `restored` board as a live feed. What is left — last night's score
    sitting under tonight's names — is a thing the producer can SEE, with an
    explicit, prominent verb for it on the board desk's turnover bar. A visible
    button they choose beats an invisible rule that sometimes eats their game.

    So the only caller is `take_next_match`, whose whole meaning is "this board is
    done with what it has, move on", and whose button says so.

    Two conditions survive:

    * the game is over (`is_stale` — final, stranded, or restored). A LIVE game is
      never cleared even by a take: binding mid-game is a real move, which is why
      `evaluate_match_gate_for_board` exists to catch a mismatch created that way.

    * the board's own feed delivers its next game — a HUD board, or any board whose
      game is `restored` residue nobody chose this session.

      An API board is the exception because its POOL owns the slot: a completed
      record sitting there is content the producer configured, with real ports, a
      real captain and real names (the same content `_board_side_has_feed_data`
      protects from a draft pick), and a fixture bound to label it is legitimate.
      Clearing it would destroy exactly that — and for a *live* API game the pool
      would re-push it a second later anyway (`_reapply_single_live`), so the clear
      is both risky and ineffective there.
    """
    lifecycle = board_lifecycle(sb)
    if not is_stale(lifecycle):
        return
    if lifecycle != "restored" and transport(sb) != "hud":
        return
    # `reproject=False`: the caller binds and projects immediately after, and the
    # fixture in scope right now is still the outgoing one.
    await release_and_clear_game(sb, reproject=False)


async def bind_board(sb: int, m, *, supersede: bool = False) -> None:
    """Put match ``m`` on board ``sb``, moving it off any board already holding it.

    A MATCH FILLS EXACTLY ONE BOARD. A match exists so the stream can show a
    fixture before any game data arrives, and it owns the series score for that
    fixture — two boards holding one match would be two boards claiming one game.

    This is the only place that writes ``score.{N}.match``, so that every caller
    inherits the rule. It used to be a loop in the Match desk's `selectBoard`,
    which meant nothing else did: this route didn't, and `/startgg/load-set` wrote
    the key directly, so loading one set onto two boards left it on both. Under
    confirm mode the console's version wasn't even atomic — each sibling unbind was
    a separately discardable staged entry, so committing the bind without one put a
    match on two boards, a state nothing in the UI can draw.

    ``supersede=True`` ALSO CLEARS the board's outgoing game, and belongs to the
    turnover verb alone (`take_next_match`). It defaults off because binding is
    AUTHORING: attaching a fixture says "this fixture describes this board", never
    "delete what is on it". With the clear wired in here unconditionally, putting a
    match on a HUD board blanked the game Project Rio was showing — see
    `_clear_superseded_game`.
    """
    for other in Match.bound_scoreboards(m):
        if other != sb:
            await _unbind_board(other)
    if supersede:
        await _clear_superseded_game(sb)
    await State.Set(f"score.{sb}.match", m)
    await State.Save()
    await Match.project_scoreboard(sb, m)
    # Settle the board against the live game now rather than on the next frame:
    # the gate surfaces a mismatch created by binding mid-game, and the cascade
    # seats the live roster/logo under the names just projected — without it a
    # HUD board whose fixture sides are the reverse of the feed's showed one
    # player's name over the other's team until the feed spoke again, which on a
    # paused or finished game is never.
    await _settle_board(sb)


@bind_router.put("/{sb}/match", response_class=ORJSONResponse)
async def bind_scoreboard(sb: int, payload: BindPayload):
    """Bind board ``sb`` to a match (or unbind + blank when ``match`` is null).

    A match encodes both sides of a single fixture, so it only binds to a
    ``single``-kind board (a HUD board is single by construction). Binding to a
    ``set`` (rotating feed) board is rejected — a rotation has no fixed sides to
    project onto.

    A match already on another board is MOVED here, not copied — see
    ``bind_board``, which owns that rule for every caller.
    """
    require_board(sb)
    m = payload.match
    if m is not None and not Match.exists(m):
        raise HTTPException(404, f"match {m!r} not found")

    if m is None:
        await _unbind_board(sb)
    else:
        _require_single_game(sb)
        await bind_board(sb, m)
    return {"success": True, "match": m}


def _require_single_game(sb: int) -> None:
    """409 unless board ``sb`` can hold one fixture.

    A HUD-transport board is single by construction — its stored playback.mode
    is ignored while HUD is on (see server/bindings.py), so a board left in
    "rotate" from a prior HUD-off session must not be rejected. Only a board that
    is *actually* rotating (API transport + rotate mode) has no fixed sides to
    project a match onto.
    """
    from server.bindings import is_rotating
    if transport(sb) != "hud" and is_rotating(sb):
        raise HTTPException(
            409,
            f"scoreboard {sb} is rotating — bind a match to a single-game board",
        )


# Taking the next queued fixture has to be ATOMIC — resolve and bind under one
# lock. `next_up()` reads state and `bind_board` awaits before its first write, so
# two boards advancing in the same tick can both resolve the same match; the
# second bind would then STEAL it (exclusivity working exactly as designed) and
# leave the first board empty. A lock is the whole fix: the point of a queue on a
# multi-board rig is that two boards take two different fixtures.
_take_next_lock = asyncio.Lock()


@bind_router.post("/{sb}/next-match", response_class=ORJSONResponse)
async def take_next_match(sb: int, queue: str | None = None):
    """Bind board ``sb`` to the next queued fixture waiting for a board.

    "Next" is DERIVED, never stored — `Schedule.next_up()` walks the queue for the
    first fixture nothing holds and nothing has decided. There is no cursor to
    advance and none to get out of step, which is what lets several matches run at
    once and lets whichever board frees up first take the next one.

    WHICH queue is the board's own (`scoreboards.match_queue.{N}`, defaulting to the
    first), overridable per press via ``queue``. The default keeps one-click Up next
    working; the override is what lets a single board pull from Winners now and
    Losers next, without the producer reassigning the board between fixtures.

    409 when the queue has nothing waiting, so the producer gets told why rather
    than watching a button do nothing.
    """
    require_board(sb)
    if queue and Schedule.get_queue(queue) is None:
        raise HTTPException(404, f"queue {queue!r} does not exist")
    _require_single_game(sb)
    async with _take_next_lock:
        m = Schedule.next_up(queue) if queue else Schedule.next_up_for_board(sb)
        if m is None:
            raise HTTPException(409, "nothing in the queue is waiting for a board")
        # The one superseding bind: this verb's entire meaning is "this board is
        # done with what it has", and the button that calls it says so.
        await bind_board(sb, m, supersede=True)
    return {"success": True, "match": m, "queue": Schedule.queue()}


@bind_router.post("/{sb}/match-conflict/dismiss", response_class=ORJSONResponse)
async def dismiss_match_conflict(sb: int):
    """Producer override: clear a board's match conflict, keeping the match bound
    (the "keep + ignore this game" resolution). The bound match stays put; the
    live game runs as-is until the next new game re-evaluates the gate."""
    await State.Set(f"score.{sb}.match_conflict", None)
    await State.Save()
    return {"success": True}

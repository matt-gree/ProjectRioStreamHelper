"""Cross-subsystem invariants — the rules that live BETWEEN models.

Each subsystem here is unit-tested and correct on its own. The bugs that reach a
broadcast are the ones in the seams: a projector and a live feed both writing
`score.{N}.player.{T}.*`, a container's feed and its roster, `schedule.queue` and
the orders it projects. No single module owns those rules, so no single module's
tests can see them break.

This is the one place they are written down. A check is a pure function over
State + Settings — no I/O, no awaits — so the same list runs from a test
(`tests/integration/test_invariants.py`), from a route (`GET /api/v1/invariants`)
and from the agent CLI (`scripts/prsh-agent.py doctor --assert`) without three
implementations disagreeing about what "healthy" means.

Adding one: write the failure you actually saw into the docstring. A check whose
name and message do not say what went wrong on air is a check nobody will trust
enough to act on at 2am mid-tournament.
"""
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get

# Which tiers may appear in production.feed.reason (server/automations.py).
_FEED_REASONS = {"manual", "rule", "resting"}
# Which layers the side cascade may name (RioGameDataProvider._decide).
_SIDE_REASONS = {"manual", "match", "pin", "back_to_back", ""}


def _boards() -> list[int]:
    active = Settings.Get("scoreboards.active", [1]) or [1]
    return [int(b) for b in active]


def _score(sb: int) -> dict:
    v = deep_get(State.state, f"score.{sb}")
    return v if isinstance(v, dict) else {}


# ── the checks ──────────────────────────────────────────────────────────────

def board_with_a_game_has_names(_) -> list[str]:
    """A board carrying a game must name both its players.

    Seen live: unbinding a match mid-game blanked both sides' `rioName` while the
    board kept its team, roster, batter and inning — so one console surface said
    "No game on this board yet" while another rendered that board's live stats,
    and the scoreboard went nameless. A projector blanking a key the feed also
    owns; see `_FEED_SHARED_KEYS` in server/match.py.
    """
    out = []
    for sb in _boards():
        s = _score(sb)
        if not s.get("game_id"):
            continue
        for t in (1, 2):
            if not deep_get(s, f"player.{t}.rioName"):
                out.append(
                    f"board {sb} carries game {s['game_id']} but side {t} has no rioName"
                )
    return out


def side_reason_names_a_live_layer(_) -> list[str]:
    """`side_reason` must name a layer that is still there.

    It is the console's answer to "why is this player on the left", so a stale
    one is worse than a blank one. Unbinding used to leave `match` on a board
    with no match — the cascade only re-runs when a frame arrives, and nothing
    re-ran it when the thing it consults went away.
    """
    out = []
    for sb in _boards():
        s = _score(sb)
        reason = s.get("side_reason", "")
        if reason not in _SIDE_REASONS:
            out.append(f"board {sb} side_reason {reason!r} is not a cascade layer")
        if reason == "match" and not s.get("match"):
            out.append(f"board {sb} side_reason is 'match' but no match is bound")
    return out


def a_match_fills_exactly_one_board(_) -> list[str]:
    """No match id may sit on two boards.

    A match owns the series for its fixture, so two boards holding one match are
    two boards claiming one game — a state nothing in the UI can draw.
    `bind_board` is the only writer of `score.{N}.match` for this reason.
    """
    holders: dict[str, list[int]] = {}
    for sb in _boards():
        m = _score(sb).get("match")
        if m is not None:
            holders.setdefault(str(m), []).append(sb)
    return [f"match {m} is bound to boards {sbs}"
            for m, sbs in holders.items() if len(sbs) > 1]


def a_bound_board_seats_its_fixture(_) -> list[str]:
    """A board bound to a match, with no identity conflict, shows that fixture's
    players on the sides the fixture puts them.

    This is what the projector is FOR, so a disagreement means a projection did
    not run after a mutation. Skipped while `match_conflict` is raised: that is
    the producer being told the live players are not the fixture's, and the
    mismatch is the message rather than a bug.
    """
    out = []
    for sb in _boards():
        s = _score(sb)
        m = s.get("match")
        if m is None or s.get("match_conflict"):
            continue
        fixture = deep_get(State.state, f"match.{m}")
        if not isinstance(fixture, dict):
            out.append(f"board {sb} is bound to match {m}, which does not exist")
            continue
        for t in (1, 2):
            want = deep_get(fixture, f"player.{t}.rioName") or ""
            got = deep_get(s, f"player.{t}.rioName") or ""
            if want and got and want != got:
                out.append(
                    f"board {sb} side {t} shows {got!r} but match {m} seats {want!r} there"
                )
    return out


def per_board_state_belongs_to_a_live_board(_) -> list[str]:
    """No `score.{N}` or per-board setting may outlive its board.

    Board ids are RE-USED (`_lowest_available_id`), so a leftover is not dormant —
    the next board with that id inherits it, with nothing on its panel explaining
    where it came from.
    """
    out = []
    live = {str(b) for b in _boards()}
    for sb in (State.state.get("score") or {}):
        if str(sb) not in live:
            out.append(f"score.{sb} exists but board {sb} is not in the rig")
    for key in ("binding", "aliases", "match_queue", "rotation"):
        for sb in (Settings.Get(f"scoreboards.{key}", {}) or {}):
            if str(sb) not in live:
                out.append(f"scoreboards.{key}.{sb} exists but board {sb} is not in the rig")
    for sb in (deep_get(State.state, "scoreboards.rotation") or {}):
        if str(sb) not in live:
            out.append(f"scoreboards.rotation.{sb} (state mirror) outlived board {sb}")
    return out


def a_container_feeds_only_its_own_members(_) -> list[str]:
    """What a container is showing must be on that container's roster.

    Membership IS the relationship — the roster is where a member is added and
    removed — so an occupant that is not a member is something the producer
    cannot see, move or take off air from the container's own panel.
    """
    out = []
    defs = Settings.Get("production.container_defs", {}) or {}
    feeds = deep_get(State.state, "production.feed.container") or {}
    for cid, occupant in feeds.items():
        if not isinstance(occupant, dict) or not occupant.get("element"):
            continue
        cdef = defs.get(cid)
        if cdef is None:
            out.append(f"container {cid!r} has a feed but no definition")
            continue
        members = cdef.get("members") or []
        if occupant["element"] not in members:
            out.append(
                f"container {cid!r} is showing {occupant['element']!r}, "
                f"which is not on its roster {members}"
            )
    return out


def a_feed_states_whose_authority_it_is(_) -> list[str]:
    """Every occupied container reports which tier put it there.

    `production.feed.reason` is modelled on `side_reason` for the same reason: a
    producer deciding whether to take a container back needs to know whether it
    is theirs, a rule's, or resting. Precedence is manual > rule > resting.
    """
    out = []
    feeds = deep_get(State.state, "production.feed.container") or {}
    reasons = deep_get(State.state, "production.feed.reason") or {}
    for cid, occupant in feeds.items():
        if not isinstance(occupant, dict) or not occupant.get("element"):
            continue
        reason = reasons.get(cid)
        if reason is None:
            out.append(f"container {cid!r} is occupied but reports no reason")
        elif reason not in _FEED_REASONS:
            out.append(f"container {cid!r} reports reason {reason!r}, not one of {sorted(_FEED_REASONS)}")
    return out


def an_automation_points_at_things_that_exist(_) -> list[str]:
    """A rule's container and member must both still be there.

    Rules outlive the container edits around them: deleting a container, or
    dropping a member from a roster, leaves any rule that named it pointing at
    nothing — and a rule that can never fire looks identical on the panel to one
    that simply has not fired yet.
    """
    out = []
    defs = Settings.Get("production.container_defs", {}) or {}
    for rid, rule in (Settings.Get("production.automations", {}) or {}).items():
        if not isinstance(rule, dict):
            continue
        cid = rule.get("container")
        cdef = defs.get(cid)
        if cdef is None:
            out.append(f"automation {rid!r} targets container {cid!r}, which does not exist")
            continue
        member = rule.get("member")
        if member and member not in (cdef.get("members") or []):
            out.append(
                f"automation {rid!r} shows {member!r}, which is not on {cid!r}'s roster"
            )
    return out


def a_resting_occupant_is_a_member(_) -> list[str]:
    """A container's resting occupant must be on its own roster.

    Resting is where a container returns after every dwell and what it boots
    into, so a resting occupant that is not a member is a container that goes
    blank on its own schedule. Absent is fine — that is "empty" and is right for
    a container that only ever holds pushed content.
    """
    out = []
    for cid, cdef in (Settings.Get("production.container_defs", {}) or {}).items():
        if not isinstance(cdef, dict):
            continue
        resting = cdef.get("resting")
        if resting and resting not in (cdef.get("members") or []):
            out.append(
                f"container {cid!r} rests on {resting!r}, which is not on its roster"
            )
    return out


def the_queue_projection_matches_its_orders(_) -> list[str]:
    """`schedule.queue` is the union of `schedule.queues`, in order, and lists
    only matches that exist.

    It is a PROJECTION, rewritten in the same `SetBatch` as the orders — the
    schedule overlay and the console subject read it, so a drifted projection is
    a fixture silently on or off air. `queues()` prunes dead ids on READ only, so
    a path that unsets `match.{M}` directly has to call `Schedule.reproject()`.
    """
    orders = deep_get(State.state, "schedule.queues")
    projection = deep_get(State.state, "schedule.queue")
    if orders is None and projection is None:
        return []
    orders = orders or []
    projection = list(projection or [])

    expected, seen = [], set()
    for q in orders:
        for m in (q.get("matches") or []):
            if m not in seen:
                seen.add(m)
                expected.append(m)
    out = []
    if projection != expected:
        out.append(f"schedule.queue is {projection} but its orders project {expected}")
    live = State.state.get("match") or {}
    for m in projection:
        if str(m) not in live:
            out.append(f"schedule.queue lists match {m}, which does not exist")
    return out


CHECKS = [
    board_with_a_game_has_names,
    side_reason_names_a_live_layer,
    a_match_fills_exactly_one_board,
    a_bound_board_seats_its_fixture,
    per_board_state_belongs_to_a_live_board,
    a_container_feeds_only_its_own_members,
    a_feed_states_whose_authority_it_is,
    an_automation_points_at_things_that_exist,
    a_resting_occupant_is_a_member,
    the_queue_projection_matches_its_orders,
]


def run() -> list[dict]:
    """Run every check. Returns one entry per check with its violations.

    A check that raises is reported as a violation of itself rather than taking
    the run down with it — the same instinct as `run_startup_projection`: a
    diagnostic must never be the thing that breaks.
    """
    results = []
    for check in CHECKS:
        try:
            violations = check(None)
        except Exception as e:  # noqa: BLE001 — a broken check is a finding, not a crash
            violations = [f"check raised {type(e).__name__}: {e}"]
        results.append({
            "id": check.__name__,
            "summary": (check.__doc__ or "").strip().split("\n")[0],
            "violations": violations,
        })
    return results


def violations() -> list[str]:
    """Flat list of every violation, prefixed by the check that found it."""
    return [f"{r['id']}: {v}" for r in run() for v in r["violations"]]

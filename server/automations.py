"""Container automations — the engine that drives a shared container by itself.

A container is one OBS browser source hosting whichever of its members is fed to
it. A producer feeds one by hand; an AUTOMATION is a rule that does it on its
own. There are two kinds, and the difference is the whole model:

    WHEN   a MOMENT happens        "when a new batter steps up by this side,
                                     show the Stat Card of the batter for 8 s"
    WHILE  a STATE holds            "while the game is final, show the Game Summary"

and under both, the container's resting member — the console calls it
OTHERWISE — is what it shows when nothing else applies.

PRECEDENCE: manual > when > while > otherwise, mirrored to
`production.feed.reason.{container}` as manual / rule / state / resting, so a
surface can say WHY something is up. Inside each kind the producer's ORDER
decides: the first matching WHEN rule takes a moment, the top WHILE rule that
holds is the steady state. A WHEN rule interrupts and HANDS BACK — when its
duration ends, the container returns to whatever the WHILE rules and OTHERWISE
say now, which is not necessarily what was up when it fired.

A rule is never free text. Every word it is built from is an id in
`public/layout/lib/automation-vocab.json` — the console builds its menus from
that file and this module implements each id (`EVENTS`, `STATES`, `UNTIL`,
`ONCE`, `CONDITIONS`); `tests/unit/test_automation_vocab.py` fails if the two
disagree. That is what keeps "a rule that silently never fires" unwritable: a
word the feed has no data for is simply not in the list.

WHY THIS IS SERVER-SIDE, IN THE WRITE PATH. The container feed is already server
state and the console already reads it, so one authority is the point — a rule
living inside an overlay mount is invisible to the producer, untestable in
pytest, and re-decided independently by every source of the same container. And
the decision costs nothing here: the keys a rule watches are written by the HUD
event itself, so a rule that runs as a State write hook (`State.hooks`) folds
its feed write into the SAME SetBatch as the trigger — same socket frame, same
latency. A polling loop would reintroduce exactly the round-trip this avoids.

MANUAL behaves like the player-side cascade's: a producer's Push wins and
suspends the rules until they clear it. CLEARING the feed is what hands the
container back — there is no separate "resume" verb to get wrong. The
suspension survives a restart, because the mirrored reason is what remembers it.

A moment is detected per SERVER RUN: the first observation of a value seeds the
baseline without firing, so a mid-game start does not pop a card for a batter
who was already up.
"""

import asyncio
import json

from loguru import logger

from server.paths import app_root
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get

FEED_KEY = "production.feed.container"
# Where the deciding tier is mirrored. Deliberately NOT under
# `production.feed.container.*`: every container overlay filters its render on
# that prefix, and the reason is console-facing — an overlay has no business
# re-rendering because the console learned why it shows what it shows.
REASON_KEY = "production.feed.reason"

MANUAL = "manual"
RULE = "rule"
STATE = "state"
RESTING = "resting"

DEFAULT_DWELL = 7.0

VOCAB_PATH = app_root() / "public" / "layout" / "lib" / "automation-vocab.json"


# ── Content resolvers ────────────────────────────────────────────────────────
#
# A rule's action is "show <member>", so the engine has to build the feed payload
# that member's mount expects. One resolver per member that needs more than a
# frame of reference; everything else takes the generic one. This is the
# server-side half of `MEMBERS` in public/layout/lib/fed-container.js — the
# registry there says how to MOUNT a member, this says how to ADDRESS one.
#
# A resolver returning None IS the guard failing: there is nothing to show, so
# the rule does not fire.


def _team_role(sb: int, team: int) -> str:
    """'batting' or 'pitching' for this side, this half-inning.

    Mirrors RioData.getTeamRole (public/layout/lib/rio-data.js). This is what
    makes one trigger serve a mirrored pair of containers: the same batter change
    resolves to the batter on the side at bat and the pitcher on the side in the
    field.
    """
    try:
        home = int(deep_get(State.state, f"score.{sb}.home_team", 2))
    except (TypeError, ValueError):
        home = 2
    half = deep_get(State.state, f"score.{sb}.half_inning", "Top") or "Top"
    away = 1 if home == 2 else 2
    batting = away if half == "Top" else home
    return "batting" if batting == team else "pitching"


def _resolve_scoped(member: str, sb: int, team: int):
    """A member that only needs to know whose frame of reference it is in."""
    return {"element": member, "scoreboard": sb, "team": team}


def _resolve_stat_line(member: str, sb: int, team: int):
    """A stat element — the Stat Card or the Stat Bar: a scope, plus a guard.

    Both resolve their own line inside the mount (RioData.getStatsLine — the
    side's batter or pitcher by its role), so the payload is only the frame of
    reference. What they still need from here is the GUARD — without one, every
    batter change would fire whether or not this side has anyone on the field,
    and the guard-fail retry that keeps a batter from being skipped a frame
    early would never engage.
    """
    role = _team_role(sb, team)
    field = "batter" if role == "batting" else "pitcher"
    if not (deep_get(State.state, f"score.{sb}.{field}", "") or ""):
        return None
    return {"element": member, "scoreboard": sb, "team": team}


RESOLVERS = {
    "statscard": _resolve_stat_line,
    "statsbar": _resolve_stat_line,
}


def resolve_content(member: str, sb: int, team: int):
    if not member:
        return None
    return RESOLVERS.get(member, _resolve_scoped)(member, sb, team)


# ── The board, as rules read it ─────────────────────────────────────────────


def _board(sb: int, key: str, default=None):
    return deep_get(State.state, f"score.{sb}.{key}", default)


def _batting_side(sb: int) -> int:
    """The side at bat this half-inning (see `_team_role`)."""
    return 1 if _team_role(sb, 1) == "batting" else 2


def _is_final(sb: int) -> bool:
    """The game on this board has reached its end, by any of the three ways a
    board says so: the HUD's own verdict, a completed API record, or a capture
    that wrote the FINAL onto the board (`PostGame._settle_board_entries`)."""
    return bool(_board(sb, "game_over") or _board(sb, "game_completed")
                or _board(sb, "half_inning") == "Final")


def _int(value, default=0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# ── The vocabulary, implemented ─────────────────────────────────────────────
#
# Each table is keyed by the ids in automation-vocab.json and nothing else.

class _Event:
    """A MOMENT: a value read off one board, and when its change counts.

    `actor` is the side the moment belongs to, for an event that has one — the
    batter's side for a new batter. A rule's "by" filters on it and the "the
    player in the event" subject resolves to it.

    `fires(prev, new, sb)` gets the board too, because a PLAY event watches one
    value (the play's id) and judges what kind of play it was off the rest of
    the key.
    """

    __slots__ = ("value", "fires", "actor")

    def __init__(self, value, fires, actor=None):
        self.value = value
        self.fires = fires
        self.actor = actor


def _half_value(sb: int):
    return (_board(sb, "game_id"), _board(sb, "inning"), _board(sb, "half_inning"))


def _half_fires(prev, new) -> bool:
    # A half-inning ending is the half CHANGING within one game. A new game
    # (a different id) resets the inning without ending anything, and FINAL is
    # the game ending, which is its own event.
    return (prev[0] == new[0] and new[0] is not None
            and prev[2] in ("Top", "Bottom") and new[2] in ("Top", "Bottom"))


# ── plays ──
#
# `score.{N}.play` is the play the last RESOLVED HUD frame finished (written by
# apply_parsed_game_to_state off HudWatcher._extract_play): {id, result, rbi,
# star}. Its `id` changing IS the moment — once per play, never once per HUD
# write — and `result` is Rio's own `Result of AB` word, mapped onto the
# vocabulary here and nowhere else. An API game has no frames and no plays, so
# these events are a local-HUD board's.

_HITS = frozenset({"Single", "Double", "Triple", "HR"})


def _play(sb: int) -> dict:
    play = _board(sb, "play")
    return play if isinstance(play, dict) else {}


def _play_event(test):
    return _Event(
        value=lambda sb: _play(sb).get("id") or "",
        fires=lambda prev, new, sb: bool(new) and test(_play(sb)),
        actor=_batting_side,
    )


def _lead(sb: int) -> int:
    """Which side leads: 1, 2, or 0 for a tie. score_left/right are sides 1/2
    as the board draws them."""
    a, b = _int(_board(sb, "score_left")), _int(_board(sb, "score_right"))
    return 1 if a > b else 2 if b > a else 0


EVENTS: dict[str, _Event] = {
    # Empty is "nobody" (a cleared board), never an arrival: it resets the
    # baseline so the next real name reads as a change.
    "batter_up": _Event(
        value=lambda sb: _board(sb, "batter", "") or "",
        fires=lambda prev, new, sb: new != "",
        actor=_batting_side,
    ),
    "pitcher_change": _Event(
        value=lambda sb: _board(sb, "pitcher", "") or "",
        fires=lambda prev, new, sb: new != "",
        actor=lambda sb: 3 - _batting_side(sb),
    ),
    "home_run": _play_event(lambda p: p.get("result") == "HR"),
    "hit": _play_event(lambda p: p.get("result") in _HITS),
    "strikeout": _play_event(lambda p: p.get("result") == "Strikeout"),
    # A star pitch is the PITCHER's and a star swing the batter's, so this one
    # has no side of its own.
    "star": _Event(
        value=lambda sb: _play(sb).get("id") or "",
        fires=lambda prev, new, sb: bool(new) and bool(_play(sb).get("star")),
    ),
    # Taking the lead counts (a tie broken); falling back to a tie does not —
    # nobody has the lead to have changed to.
    "lead_change": _Event(
        value=lambda sb: (_board(sb, "game_id"), _lead(sb)),
        fires=lambda prev, new, sb: prev[0] == new[0] and new[1] != 0 and new[1] != prev[1],
        actor=_lead,
    ),
    "half_end": _Event(value=_half_value, fires=lambda prev, new, sb: _half_fires(prev, new)),
    "game_end": _Event(
        value=_is_final,
        fires=lambda prev, new, sb: bool(new) and not prev,
    ),
}

# A WHILE rule's condition, as (board, the container's side) -> bool.
STATES = {
    "final": lambda sb, team: _is_final(sb),
    "no_game": lambda sb, team: not _board(sb, "game_id"),
    "side_batting": lambda sb, team: bool(_board(sb, "game_id")) and not _is_final(sb)
    and _batting_side(sb) == team,
    "side_pitching": lambda sb, team: bool(_board(sb, "game_id")) and not _is_final(sb)
    and _batting_side(sb) != team,
}

# How a WHEN rule can end besides a number of seconds: the next time this
# MOMENT happens on the rule's board. `manual` ends only when a producer clears
# the container or another WHEN rule takes it.
UNTIL = {
    "next_batter": "batter_up",
    "half_end": "half_end",
    "manual": None,
}

# How often a WHEN rule may fire: the period it is limited to, as a key. None
# means every time.
ONCE = {
    "always": None,
    "half": lambda sb: ("half", _board(sb, "game_id"), _board(sb, "inning"), _board(sb, "half_inning")),
    "inning": lambda sb: ("inning", _board(sb, "game_id"), _board(sb, "inning")),
    "game": lambda sb: ("game", _board(sb, "game_id")),
}

CONDITIONS = {
    "inning": lambda sb: _int(_board(sb, "inning"), 1),
    "margin": lambda sb: abs(_int(_board(sb, "score_left")) - _int(_board(sb, "score_right"))),
    "outs": lambda sb: _int(_board(sb, "outs")),
    # The play's own RBI — 0 for a moment that is not a play.
    "rbi": lambda sb: _int(_play(sb).get("rbi")),
}

OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    "=": lambda a, b: a == b,
}

# Whose content a scoped member is handed: which SIDE, given the container's
# own side and (for a moment) the side the moment belongs to.
SUBJECTS = {
    "scope": lambda sb, team, actor: team,
    "batting": lambda sb, team, actor: _batting_side(sb),
    "fielding": lambda sb, team, actor: 3 - _batting_side(sb),
    "event": lambda sb, team, actor: actor or team,
}

BY = ("any", "scope", "1", "2")


def load_vocab() -> dict:
    """The shared vocabulary file. Read by the tests that pin it to the tables
    above; the engine itself never needs the labels."""
    return json.loads(VOCAB_PATH.read_text(encoding="utf-8"))


# ── Rules ───────────────────────────────────────────────────────────────────


class Rule:
    """One normalized automation, with its container's scope already folded in.

    Settings are user-editable JSON, so normalization is where a malformed rule
    becomes an inert one instead of an exception inside a state write.
    """

    __slots__ = ("id", "container", "kind", "event", "state", "by", "subject",
                 "member", "seconds", "until", "once", "conditions", "order",
                 "scoreboard", "team")

    def __init__(self, **kw):
        for name in self.__slots__:
            setattr(self, name, kw.get(name))


def _scope_of(def_) -> tuple[int, int]:
    """A container definition's frame of reference: (scoreboard, team).

    Board 1 / side 1 is the default, matching every other place a missing
    `?scoreboard=` means board 1.
    """
    scope = def_.get("scope") if isinstance(def_, dict) else None
    scope = scope if isinstance(scope, dict) else {}
    try:
        sb = int(scope.get("scoreboard") or 1)
    except (TypeError, ValueError):
        sb = 1
    try:
        team = int(scope.get("team") or 1)
    except (TypeError, ValueError):
        team = 1
    return (sb if sb >= 1 else 1), (2 if team == 2 else 1)


def _resting_of(def_) -> str | None:
    """The member a container shows OTHERWISE, if the roster still holds it."""
    if not isinstance(def_, dict):
        return None
    resting = def_.get("resting")
    if resting and resting in (def_.get("members") or []):
        return resting
    return None


def _conditions_of(raw) -> list[tuple[str, str, int]] | None:
    """A rule's "only if" list, or None if any entry is malformed — a condition
    the engine cannot read must not be silently dropped, or the rule would fire
    more often than the producer asked."""
    out = []
    for c in raw or []:
        if not isinstance(c, dict):
            return None
        field, op = c.get("field"), c.get("op")
        if field not in CONDITIONS or op not in OPS:
            return None
        try:
            value = int(c.get("value"))
        except (TypeError, ValueError):
            return None
        out.append((field, op, value))
    return out


def normalize_rule(rid: str, entry, defs: dict) -> Rule | None:
    """A stored rule as the engine runs it, or None for one that cannot fire.

    Inert rather than an error for every way a rule can go stale: rosters and
    containers are edited freely, and a rule left behind must not feed a
    container something it cannot render.
    """
    if not isinstance(entry, dict) or not entry.get("enabled", True):
        return None
    container, member = entry.get("container"), entry.get("member")
    def_ = defs.get(container) if container else None
    if not isinstance(def_, dict) or not member or member not in (def_.get("members") or []):
        return None
    kind = entry.get("kind")
    sb, team = _scope_of(def_)
    subject = entry.get("subject") or "scope"
    if subject not in SUBJECTS:
        return None
    try:
        order = float(entry.get("order", 0))
    except (TypeError, ValueError):
        order = 0.0
    common = dict(id=rid, container=container, kind=kind, member=member,
                  subject=subject, order=order, scoreboard=sb, team=team)

    if kind == "while":
        if entry.get("state") not in STATES:
            return None
        return Rule(state=entry["state"], **common)

    if kind != "when" or entry.get("event") not in EVENTS:
        return None
    by = str(entry.get("by") or "any")
    once = entry.get("once") or "always"
    conditions = _conditions_of(entry.get("conditions"))
    if by not in BY or once not in ONCE or conditions is None:
        return None
    until, seconds = entry.get("until", DEFAULT_DWELL), None
    if isinstance(until, (int, float)) and not isinstance(until, bool):
        seconds = float(until) if until > 0 else DEFAULT_DWELL
        until = None
    elif until not in UNTIL:
        return None
    return Rule(event=entry["event"], by=by, once=once, conditions=conditions,
                seconds=seconds, until=until, **common)


class Automations:
    """The engine. Class-level singleton, in the house pattern."""

    # Normalized rules + the Settings revision they were built from. This runs
    # inside every state write, so the rule set is not re-normalized per call;
    # Settings.revision moves on any settings write and rebuilds it.
    _rules_rev: int | None = None
    _rules: list[Rule] = []
    # (event id, board) pairs some rule fires on or ends on, and the boards any
    # rule reads — the hot path's whole test for "is this write mine".
    _watched: frozenset = frozenset()
    _boards: frozenset = frozenset()
    # Containers whose steady state can move with the game (they have WHILE
    # rules), and every container a rule or a resting member puts something on.
    _stateful: frozenset = frozenset()
    _resting_ids: frozenset = frozenset()

    # Baseline per (event, board). Deliberately starts EMPTY — the first
    # observation seeds without firing.
    _seen: dict = {}

    # Containers a producer holds. Rules do not fire on these.
    _manual: set = set()

    # container id -> the WHEN rule currently up on it.
    _active: dict = {}

    # (rule id, period) pairs a once-per rule has already fired in.
    _spent: set = set()

    # container id -> its running dwell (or settle) task.
    _timers: dict = {}

    # Containers the engine is mid-write on. Its own writes come back through the
    # hooks (apply_baseline goes through SetBatch like anything else), and without
    # this the engine would read its own write as a producer's Push.
    _writing: set = set()

    _started = False

    # ── lifecycle ───────────────────────────────────────────────────────────

    @classmethod
    async def Start(cls):
        """Register the write hooks, then settle every container."""
        if cls.on_write not in State.hooks:
            State.hooks.append(cls.on_write)
        if cls.on_unset not in State.unset_hooks:
            State.unset_hooks.append(cls.on_unset)
        if cls.on_settings not in Settings.watchers:
            Settings.watchers.append(cls.on_settings)
        cls._started = True
        try:
            await cls.settle_all()
        except Exception:
            # Same contract as a projector's project_all: a bad persisted
            # definition must never block boot.
            logger.exception("[automations] startup pass failed")

    @classmethod
    async def Stop(cls):
        for task in list(cls._timers.values()):
            task.cancel()
        cls._timers.clear()
        if cls.on_write in State.hooks:
            State.hooks.remove(cls.on_write)
        if cls.on_unset in State.unset_hooks:
            State.unset_hooks.remove(cls.on_unset)
        if cls.on_settings in Settings.watchers:
            Settings.watchers.remove(cls.on_settings)
        cls._started = False

    @classmethod
    def reset(cls):
        """Drop all runtime state. For tests and the state-reset escape hatch."""
        for task in list(cls._timers.values()):
            task.cancel()
        cls._timers.clear()
        cls._rules_rev = None
        cls._rules = []
        cls._watched = frozenset()
        cls._boards = frozenset()
        cls._stateful = frozenset()
        cls._resting_ids = frozenset()
        cls._seen = {}
        cls._manual = set()
        cls._active = {}
        cls._spent = set()
        cls._writing = set()

    # ── rule set ────────────────────────────────────────────────────────────

    @classmethod
    def rules(cls) -> list[Rule]:
        if cls._rules_rev == Settings.revision:
            return cls._rules
        raw = Settings.Get("production.automations", {}) or {}
        defs = Settings.Get("production.container_defs", {}) or {}
        if not isinstance(defs, dict):
            defs = {}
        rules: list[Rule] = []
        if isinstance(raw, dict):
            for rid, entry in raw.items():
                rule = normalize_rule(rid, entry, defs)
                if rule:
                    rules.append(rule)
        # The producer's order, with the id as a stable tie-break so two rules
        # saved at the same position never swap between restarts.
        rules.sort(key=lambda r: (r.order, r.id))
        cls._rules = rules
        watched = set()
        for r in rules:
            if r.kind == "when":
                watched.add((r.event, r.scoreboard))
                if UNTIL.get(r.until):
                    watched.add((UNTIL[r.until], r.scoreboard))
        cls._watched = frozenset(watched)
        cls._boards = frozenset(r.scoreboard for r in rules)
        cls._stateful = frozenset(r.container for r in rules if r.kind == "while")
        cls._resting_ids = frozenset(
            cid for cid, d in defs.items() if _resting_of(d)
        )
        # A rule that is no longer what it was cannot still be up.
        live = {r.id for r in rules}
        cls._active = {c: r for c, r in cls._active.items() if r.id in live}
        cls._rules_rev = Settings.revision
        return rules

    # ── the write path ──────────────────────────────────────────────────────

    @classmethod
    async def on_write(cls, entries) -> list[tuple[str, object]]:
        """State write hook: decide every container this write moves.

        Returns the feed/reason entries for the caller to fold into its own batch,
        so a rule's consequence and its trigger reach the overlays in one frame.
        """
        rules = cls.rules()
        # Nothing configured: one check per write and out. This runs on the HUD
        # hot path, so the idle cost has to be nil.
        if not rules and not cls._resting_ids and not cls._manual:
            return []

        added: list[tuple[str, object]] = []

        # Producer writes first: a batch carrying both a Push and a trigger must
        # not fire the rule that Push just overrode.
        for key, value in entries:
            container = cls._container_of(key)
            if container is not None:
                added += cls._observe_feed(container, value)

        if not rules:
            return added
        touched = cls._touched_boards(entries)
        if not touched:
            return added

        fired = cls._detect(touched)
        decided: set = set()

        # 1. A WHEN rule whose moment to end just came, ends — before anything
        #    fires, so "until the next batter" hands over to the rule that the
        #    same next batter fires.
        ending = [c for c, r in cls._active.items()
                  if r.until and UNTIL[r.until] and (UNTIL[r.until], r.scoreboard) in fired]
        for container in ending:
            cls._active.pop(container, None)
            cls._cancel_timer(container)

        # 2. Moments, in the producer's order: the first match per container wins.
        tried: dict = {}
        for rule in rules:
            if rule.kind != "when" or rule.container in decided or rule.container in cls._manual:
                continue
            key = (rule.event, rule.scoreboard)
            if key not in fired:
                continue
            actor = fired[key]
            if not cls._passes(rule, actor):
                continue
            tried.setdefault(key, False)
            payload = cls._content(rule, actor)
            if not payload:
                continue
            tried[key] = True
            decided.add(rule.container)
            added += cls._fire(rule, payload)

        # Every eligible rule's guard failed — the content has not resolved yet
        # (a HUD event can carry the new batter a tick before its roster index).
        # Roll the baseline back so the next tick RETRIES instead of skipping
        # this batter entirely.
        for key, landed in tried.items():
            if not landed:
                cls._seen[key] = cls._prev.get(key, ...)

        # 3. Steady state, for every container no moment holds.
        for container in set(ending) | cls._stateful:
            if container in decided or container in cls._manual or container in cls._active:
                continue
            if container not in ending and not cls._scope_touched(container, touched):
                continue
            added += cls._settle_entries(container)
        return added

    @staticmethod
    def _touched_boards(entries) -> set:
        out = set()
        for key, _ in entries:
            if key.startswith("score."):
                head = key.split(".", 2)[1]
                if head.isdigit():
                    out.add(int(head))
        return out

    @classmethod
    def _scope_touched(cls, container: str, touched: set) -> bool:
        defs = Settings.Get("production.container_defs", {}) or {}
        sb, _ = _scope_of(defs.get(container) if isinstance(defs, dict) else None)
        return sb in touched

    # The pre-write baseline of every pair `_detect` moved this write, for the
    # guard-failure rollback above.
    _prev: dict = {}

    @classmethod
    def _detect(cls, touched: set) -> dict:
        """The moments this write is. {(event, board): the moment's side or None}."""
        fired: dict = {}
        cls._prev = {}
        for event_id, sb in cls._watched:
            if sb not in touched:
                continue
            event = EVENTS[event_id]
            new = event.value(sb)
            key = (event_id, sb)
            prev = cls._seen.get(key, ...)
            cls._seen[key] = new
            cls._prev[key] = prev
            if prev is ... or new == prev:
                continue
            if event.fires(prev, new, sb):
                fired[key] = event.actor(sb) if event.actor else None
        return fired

    @classmethod
    def _passes(cls, rule: Rule, actor) -> bool:
        if rule.by == "scope" and actor != rule.team:
            return False
        if rule.by in ("1", "2") and actor != int(rule.by):
            return False
        for field, op, value in rule.conditions:
            if not OPS[op](CONDITIONS[field](rule.scoreboard), value):
                return False
        period = ONCE[rule.once]
        if period is not None and (rule.id, period(rule.scoreboard)) in cls._spent:
            return False
        return True

    @staticmethod
    def _content(rule: Rule, actor=None):
        team = SUBJECTS[rule.subject](rule.scoreboard, rule.team, actor)
        return resolve_content(rule.member, rule.scoreboard, team)

    @staticmethod
    def _container_of(key: str) -> str | None:
        """The container a feed key names, or None if the key isn't a feed key."""
        if not key.startswith(FEED_KEY + "."):
            return None
        container = key[len(FEED_KEY) + 1:]
        # A deeper path is a write INTO a payload, not a change of occupant.
        return None if ("." in container or not container) else container

    @classmethod
    def _observe_feed(cls, container: str, value) -> list[tuple[str, object]]:
        """A feed write the engine did not make is the producer's."""
        if container in cls._writing:
            return []
        if value is None:
            # Clearing hands the container back. Restoring the steady state has
            # to be a follow-up write (this one is already on the wire), so it
            # is scheduled rather than folded.
            cls._hand_back(container)
            return []
        cls._manual.add(container)
        cls._active.pop(container, None)
        cls._cancel_timer(container)
        return [(f"{REASON_KEY}.{container}", MANUAL)]

    @classmethod
    def _fire(cls, rule: Rule, payload: dict) -> list[tuple[str, object]]:
        cls._cancel_timer(rule.container)
        cls._active[rule.container] = rule
        period = ONCE[rule.once]
        if period is not None:
            cls._spent.add((rule.id, period(rule.scoreboard)))
        if rule.seconds:
            cls._timers[rule.container] = asyncio.ensure_future(
                cls._dwell(rule.container, rule.seconds)
            )
        return [
            (f"{FEED_KEY}.{rule.container}", payload),
            (f"{REASON_KEY}.{rule.container}", RULE),
        ]

    # ── steady state ───────────────────────────────────────────────────────

    @classmethod
    def baseline(cls, container: str) -> tuple[dict | None, str]:
        """What this container shows when no moment and no producer holds it.

        The top WHILE rule whose state holds and whose content resolves, else
        the resting member (OTHERWISE), else nothing — with the reason that
        decided it.
        """
        for rule in cls.rules():
            if rule.container != container or rule.kind != "while":
                continue
            if STATES[rule.state](rule.scoreboard, rule.team):
                payload = cls._content(rule)
                if payload:
                    return payload, STATE
        defs = Settings.Get("production.container_defs", {}) or {}
        def_ = defs.get(container) if isinstance(defs, dict) else None
        resting = _resting_of(def_)
        if resting:
            sb, team = _scope_of(def_)
            payload = resolve_content(resting, sb, team)
            if payload:
                return payload, RESTING
        return None, RESTING

    @classmethod
    def _settle_entries(cls, container: str) -> list[tuple[str, object]]:
        """The steady state as entries to fold into the current batch, or [] if
        nothing changes. Emptying a container is an unset, which a hook cannot
        return, so that one case is scheduled instead."""
        payload, reason = cls.baseline(container)
        live = deep_get(State.state, f"{FEED_KEY}.{container}")
        if payload is None:
            if live is not None or cls.reason(container) != reason:
                cls._schedule_settle(container)
            return []
        if live == payload and cls.reason(container) == reason:
            return []
        return [
            (f"{FEED_KEY}.{container}", payload),
            (f"{REASON_KEY}.{container}", reason),
        ]

    @classmethod
    async def _dwell(cls, container: str, seconds: float):
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        cls._timers.pop(container, None)
        cls._active.pop(container, None)
        try:
            await cls.apply_baseline(container)
        except Exception:
            logger.exception("[automations] handing {} back failed", container)

    @classmethod
    def _cancel_timer(cls, container: str):
        task = cls._timers.pop(container, None)
        if task:
            task.cancel()

    @classmethod
    def pending(cls, container: str):
        """This container's running dwell/settle task, if any. Test seam."""
        return cls._timers.get(container)

    @classmethod
    async def apply_baseline(cls, container: str):
        """Put this container's steady state up, or leave it empty.

        Both the return from a moment and the boot state, because they are the
        same question: what does this container show when nothing else is up. A
        container a producer holds is left alone, and so is one a moment holds.
        """
        if container in cls._manual or container in cls._active:
            return
        defs = Settings.Get("production.container_defs", {}) or {}
        if not isinstance(defs, dict) or not isinstance(defs.get(container), dict):
            return
        payload, reason = cls.baseline(container)

        cls._writing.add(container)
        try:
            if payload:
                await State.SetBatch([
                    (f"{FEED_KEY}.{container}", payload),
                    (f"{REASON_KEY}.{container}", reason),
                ])
            else:
                # Nothing to show. An empty container is transparent, which is
                # the honest rendering of "nothing is up"; the reason still says
                # who decided that.
                if deep_get(State.state, f"{FEED_KEY}.{container}") is not None:
                    await State.UnsetBatch([f"{FEED_KEY}.{container}"])
                await State.SetBatch([(f"{REASON_KEY}.{container}", reason)])
            await State.Save()
        finally:
            cls._writing.discard(container)

    # The name the return-from-a-dwell path had before WHILE rules existed.
    apply_resting = apply_baseline

    @classmethod
    async def settle_all(cls):
        """Bring every container to a defensible state at boot.

        state.json persists, so whatever was on air when the process died is
        still there — including a stat card whose moment died with it. The
        mirrored reason is what tells them apart: a MANUAL feed is the producer's
        and is restored as a suspension, anything else is the engine's and
        settles back to the steady state.

        A feed or reason for a container with NO definition is dropped first. It
        is on nothing a producer can see or clear — the container's own panel is
        gone — and a container rebuilt under the same slugged id would inherit
        it. The console's delete already unsets both; this covers a definition
        that left some other way (a settings migration, a hand-edited file).
        """
        defs = Settings.Get("production.container_defs", {}) or {}
        if not isinstance(defs, dict):
            return
        orphans = [
            f"{key}.{cid}"
            for key in (FEED_KEY, REASON_KEY)
            for cid in (deep_get(State.state, key) or {})
            if cid not in defs
        ]
        if orphans:
            await State.UnsetBatch(orphans)
            await State.Save()
        cls.rules()
        for container, def_ in defs.items():
            if not isinstance(def_, dict):
                continue
            live = deep_get(State.state, f"{FEED_KEY}.{container}")
            if live is not None and cls.reason(container) == MANUAL:
                cls._manual.add(container)
                continue
            if _resting_of(def_) or live is not None or container in cls._stateful:
                await cls.apply_baseline(container)

    @classmethod
    async def on_settings(cls, keys) -> None:
        """A rule or a roster changed: re-settle every container it could move.

        The write path only re-decides a container when the GAME moves, so
        without this a While rule added while the game is already final would
        sit there doing nothing until the next HUD frame — which on a finished
        game never comes. Only containers whose steady state actually differs
        are written, and one a producer or a moment holds is left alone.
        """
        if not any(k == "production" or k.startswith(("production.automations",
                                                        "production.container_defs"))
                   for k in keys):
            return
        await cls.resettle()

    @classmethod
    async def resettle(cls):
        cls.rules()
        defs = Settings.Get("production.container_defs", {}) or {}
        if not isinstance(defs, dict):
            return
        for container, def_ in defs.items():
            if not isinstance(def_, dict) or container in cls._manual or container in cls._active:
                continue
            payload, reason = cls.baseline(container)
            live = deep_get(State.state, f"{FEED_KEY}.{container}")
            if payload is None and live is None:
                # Never touched and nothing to show — leave it unmirrored rather
                # than stamping a reason on every container in the show.
                continue
            if live == payload and cls.reason(container) == reason:
                continue
            try:
                await cls.apply_baseline(container)
            except Exception:
                logger.exception("[automations] re-settling {} failed", container)

    # ── manual ─────────────────────────────────────────────────────────────

    @classmethod
    def _hand_back(cls, container: str):
        """A cleared feed ends the suspension and restores the steady state."""
        cls._manual.discard(container)
        cls._active.pop(container, None)
        cls._schedule_settle(container)

    @classmethod
    def _schedule_settle(cls, container: str):
        cls._cancel_timer(container)
        if cls._started:
            cls._timers[container] = asyncio.ensure_future(cls._settle(container))

    @classmethod
    async def _settle(cls, container: str):
        cls._timers.pop(container, None)
        try:
            await cls.apply_baseline(container)
        except Exception:
            logger.exception("[automations] settling {} failed", container)

    @classmethod
    async def on_unset(cls, keys) -> None:
        """Clear is how a producer hands a container back — there is no Resume."""
        for key in keys:
            container = cls._container_of(key)
            if container is not None and container not in cls._writing:
                cls._hand_back(container)

    @classmethod
    def reason(cls, container: str) -> str:
        return deep_get(State.state, f"{REASON_KEY}.{container}", "") or ""

    @classmethod
    def is_manual(cls, container: str) -> bool:
        return container in cls._manual

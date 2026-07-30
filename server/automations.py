"""Container automations — the engine that drives a shared container by itself.

A container is one OBS browser source hosting whichever of its members is fed to
it. Until now the only thing that fed one was a producer. An AUTOMATION is a rule
that does it on its own:

    trigger   a state key changes            score.{sb}.batter
    guard     the content resolves           a stat line exists for that side
    action    show <member>                  stats
    dwell     seconds                        7
    return    to the container's resting occupant (or empty)

WHY THIS IS SERVER-SIDE, IN THE WRITE PATH. The container feed is already server
state and the console already reads it, so one authority is the point — a rule
living inside an overlay mount is invisible to the producer, untestable in
pytest, and re-decided independently by every source of the same container. And
the decision costs nothing here: `score.{N}.batter` is written by the HUD event
itself, so a rule that runs as a State write hook (`State.hooks`) folds its feed
write into the SAME SetBatch as the trigger — same socket frame, same latency as
the in-mount flip it replaces. A polling loop would have reintroduced exactly the
round-trip this design avoids.

PRECEDENCE: manual > rule > resting, mirrored to
`production.feed.reason.{container}` so a surface can say WHY something is up
without inventing a vocabulary. Deliberately the same shape as the player-side
cascade (`manual > match > pin > back_to_back`, mirrored to
`score.{N}.side_reason`), including how manual behaves: a producer's Push wins and
suspends the rules until they clear it. CLEARING the feed is what hands the
container back, because resting is by definition what a container shows when
nothing else is up — there is no separate "resume" verb to get wrong. The
suspension survives a restart, because the mirrored reason is what remembers it.

BEHAVIOUR CHANGE from the in-mount flip, worth knowing rather than discovering:
the old cycle seeded its baseline per PAGE LOAD, so a source shown mid-game
waited for the next batter. Here "first observation" is per SERVER RUN, so a
source that loads mid-dwell comes up already showing the stat card — which is the
better answer (it matches what is on air everywhere else), but it will otherwise
surface as "why did it flash on refresh".
"""

import asyncio

from loguru import logger

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
RESTING = "resting"

DEFAULT_DWELL = 7.0


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


def _find_char_index(sb: int, team: int, name: str) -> int:
    for i in range(9):
        if deep_get(State.state, f"score.{sb}.player.{team}.character.{i}.name") == name:
            return i
    return -1


def _resolve_stats(member: str, sb: int, team: int):
    """The stat card for whoever this side has on the field right now.

    Mirrors RioData.getStatsLine: the role decides batter vs pitcher, and the
    roster index comes from the HUD's own index with a name scan as the fallback
    (an API game carries no index).
    """
    role = _team_role(sb, team)
    field = "batter" if role == "batting" else "pitcher"
    name = deep_get(State.state, f"score.{sb}.{field}", "") or ""
    if not name:
        return None
    try:
        idx = int(deep_get(State.state, f"score.{sb}.{field}_roster_index", -1))
    except (TypeError, ValueError):
        idx = -1
    if idx < 0:
        idx = _find_char_index(sb, team, name)
    if idx < 0:
        return None
    return {"element": member, "scoreboard": sb, "team": team,
            "charIndex": idx, "role": role}


def _resolve_scoped(member: str, sb: int, team: int):
    """A member that only needs to know whose frame of reference it is in."""
    return {"element": member, "scoreboard": sb, "team": team}


RESOLVERS = {
    "stats": _resolve_stats,
}


def resolve_content(member: str, sb: int, team: int):
    if not member:
        return None
    return RESOLVERS.get(member, _resolve_scoped)(member, sb, team)


# ── Rules ───────────────────────────────────────────────────────────────────


class Rule:
    """One normalized automation, with its container's scope already folded in.

    Settings are user-editable JSON, so normalization is where a malformed rule
    becomes an inert one instead of an exception inside a state write.
    """

    __slots__ = ("id", "name", "container", "trigger", "member", "dwell",
                 "scoreboard", "team")

    def __init__(self, rid, name, container, trigger, member, dwell, scoreboard, team):
        self.id = rid
        self.name = name
        self.container = container
        self.trigger = trigger
        self.member = member
        self.dwell = dwell
        self.scoreboard = scoreboard
        self.team = team


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
    """The member a container returns to, if the roster still holds it."""
    if not isinstance(def_, dict):
        return None
    resting = def_.get("resting")
    if resting and resting in (def_.get("members") or []):
        return resting
    return None


class Automations:
    """The engine. Class-level singleton, in the house pattern."""

    # Normalized rules + the Settings revision they were built from. This runs
    # inside every state write, so the rule set is not re-normalized per call;
    # Settings.revision moves on any settings write and rebuilds it.
    _rules_rev: int | None = None
    _rules: list[Rule] = []
    _trigger_keys: frozenset = frozenset()
    _resting_ids: frozenset = frozenset()

    # Baseline per trigger key. Deliberately starts EMPTY — the first observation
    # seeds without firing, so a mid-game server start does not pop a card for a
    # batter who was already up.
    _seen: dict = {}

    # Containers a producer holds. Rules do not fire on these.
    _manual: set = set()

    # container id -> its running dwell (or resume) task.
    _timers: dict = {}

    # Containers the engine is mid-write on. Its own writes come back through the
    # hooks (apply_resting goes through SetBatch like anything else), and without
    # this the engine would read its own resting write as a producer's Push.
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
        cls._started = False

    @classmethod
    def reset(cls):
        """Drop all runtime state. For tests and the state-reset escape hatch."""
        for task in list(cls._timers.values()):
            task.cancel()
        cls._timers.clear()
        cls._rules_rev = None
        cls._rules = []
        cls._trigger_keys = frozenset()
        cls._resting_ids = frozenset()
        cls._seen = {}
        cls._manual = set()
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
                rule = cls._normalize(rid, entry, defs)
                if rule:
                    rules.append(rule)
        cls._rules = rules
        cls._trigger_keys = frozenset(r.trigger for r in rules)
        cls._resting_ids = frozenset(
            cid for cid, d in defs.items() if _resting_of(d)
        )
        cls._rules_rev = Settings.revision
        return rules

    @classmethod
    def _normalize(cls, rid: str, entry, defs: dict) -> Rule | None:
        if not isinstance(entry, dict) or not entry.get("enabled", True):
            return None
        container = entry.get("container")
        member = entry.get("member")
        trigger = entry.get("trigger")
        if not container or not member or not trigger:
            return None
        # A rule whose container is gone, or whose member has left the roster, is
        # INERT rather than an error: rosters are edited freely, and a rule left
        # behind must not feed a container something it cannot render.
        def_ = defs.get(container)
        if not isinstance(def_, dict) or member not in (def_.get("members") or []):
            return None
        sb, team = _scope_of(def_)
        try:
            dwell = float(entry.get("dwell", DEFAULT_DWELL))
        except (TypeError, ValueError):
            dwell = DEFAULT_DWELL
        if dwell <= 0:
            dwell = DEFAULT_DWELL
        return Rule(
            rid=rid,
            name=entry.get("name") or rid,
            container=container,
            # `{sb}` resolves from the container's scope, so one canned rule
            # reads the same on every board instead of naming one.
            trigger=str(trigger).replace("{sb}", str(sb)),
            member=member,
            dwell=dwell,
            scoreboard=sb,
            team=team,
        )

    # ── the write path ──────────────────────────────────────────────────────

    @classmethod
    async def on_write(cls, entries) -> list[tuple[str, object]]:
        """State write hook: decide every container this write moves.

        Returns the feed/reason entries for the caller to fold into its own batch,
        so a rule's consequence and its trigger reach the overlays in one frame.
        """
        rules = cls.rules()
        # Nothing configured: one frozenset check per write and out. This runs on
        # the HUD hot path, so the idle cost has to be nil.
        if not rules and not cls._resting_ids and not cls._manual:
            return []

        added: list[tuple[str, object]] = []

        # Producer writes first: a batch carrying both a Push and a trigger must
        # not fire the rule that Push just overrode.
        for key, value in entries:
            container = cls._container_of(key)
            if container is not None:
                added += cls._observe_feed(container, value)

        if rules:
            for key, value in entries:
                if key in cls._trigger_keys:
                    added += cls._observe_trigger(key, value, rules)
        return added

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
            # Clearing hands the container back. Restoring resting has to be a
            # follow-up write (this one is already on the wire), so it is
            # scheduled rather than folded.
            cls._hand_back(container)
            return []
        cls._manual.add(container)
        cls._cancel_timer(container)
        return [(f"{REASON_KEY}.{container}", MANUAL)]

    @classmethod
    def _observe_trigger(cls, key: str, value, rules) -> list[tuple[str, object]]:
        prev = cls._seen.get(key, ...)
        norm = "" if value is None else value
        cls._seen[key] = norm

        if prev is ...:
            return []            # first observation this server run — seed only
        if norm == prev:
            return []
        if norm == "":
            # No batter (between innings). The baseline is empty now, so the next
            # real one reads as a change and fires — same as the in-mount cycle.
            return []

        added: list[tuple[str, object]] = []
        eligible = 0
        for rule in rules:
            if rule.trigger != key or rule.container in cls._manual:
                continue
            eligible += 1
            payload = resolve_content(rule.member, rule.scoreboard, rule.team)
            if payload:
                added += cls._fire(rule, payload)

        if eligible and not added:
            # Every eligible rule's guard failed — the content has not resolved
            # yet (a HUD event can carry the new batter a tick before its roster
            # index). Roll the baseline back so the next tick RETRIES instead of
            # skipping this batter entirely, which is what the in-mount cycle did
            # by not advancing `lastBatter`.
            cls._seen[key] = prev
        return added

    @classmethod
    def _fire(cls, rule: Rule, payload: dict) -> list[tuple[str, object]]:
        cls._cancel_timer(rule.container)
        cls._timers[rule.container] = asyncio.ensure_future(
            cls._dwell(rule.container, rule.dwell)
        )
        return [
            (f"{FEED_KEY}.{rule.container}", payload),
            (f"{REASON_KEY}.{rule.container}", RULE),
        ]

    # ── dwell / resting ────────────────────────────────────────────────────

    @classmethod
    async def _dwell(cls, container: str, seconds: float):
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        cls._timers.pop(container, None)
        try:
            await cls.apply_resting(container)
        except Exception:
            logger.exception("[automations] returning {} to resting failed", container)

    @classmethod
    def _cancel_timer(cls, container: str):
        task = cls._timers.pop(container, None)
        if task:
            task.cancel()

    @classmethod
    def pending(cls, container: str):
        """This container's running dwell/resume task, if any. Test seam."""
        return cls._timers.get(container)

    @classmethod
    async def apply_resting(cls, container: str):
        """Put this container's resting occupant up, or leave it empty.

        Both the return from a dwell and the boot state, because they are the same
        question: what does this container show when nothing else is up. A
        container a producer holds is left alone.
        """
        if container in cls._manual:
            return
        defs = Settings.Get("production.container_defs", {}) or {}
        def_ = defs.get(container) if isinstance(defs, dict) else None
        if not isinstance(def_, dict):
            return
        resting = _resting_of(def_)
        sb, team = _scope_of(def_)
        payload = resolve_content(resting, sb, team) if resting else None

        cls._writing.add(container)
        try:
            if payload:
                await State.SetBatch([
                    (f"{FEED_KEY}.{container}", payload),
                    (f"{REASON_KEY}.{container}", RESTING),
                ])
            else:
                # Nothing to rest on. An empty container is transparent, which is
                # the honest rendering of "nothing is up"; the reason still says
                # who decided that.
                if deep_get(State.state, f"{FEED_KEY}.{container}") is not None:
                    await State.UnsetBatch([f"{FEED_KEY}.{container}"])
                await State.SetBatch([(f"{REASON_KEY}.{container}", RESTING)])
            await State.Save()
        finally:
            cls._writing.discard(container)

    @classmethod
    async def settle_all(cls):
        """Bring every container to a defensible state at boot.

        state.json persists, so whatever was on air when the process died is
        still there — including a stat card whose dwell died with it. The mirrored
        reason is what tells them apart: a MANUAL feed is the producer's and is
        restored as a suspension, anything else is the engine's and settles back
        to resting.
        """
        defs = Settings.Get("production.container_defs", {}) or {}
        if not isinstance(defs, dict):
            return
        for container, def_ in defs.items():
            if not isinstance(def_, dict):
                continue
            live = deep_get(State.state, f"{FEED_KEY}.{container}")
            if live is not None and cls.reason(container) == MANUAL:
                cls._manual.add(container)
                continue
            if _resting_of(def_) or live is not None:
                await cls.apply_resting(container)

    # ── manual ─────────────────────────────────────────────────────────────

    @classmethod
    def _hand_back(cls, container: str):
        """A cleared feed ends the suspension and restores the resting state."""
        cls._manual.discard(container)
        cls._cancel_timer(container)
        if cls._started:
            cls._timers[container] = asyncio.ensure_future(cls._settle(container))

    @classmethod
    async def _settle(cls, container: str):
        cls._timers.pop(container, None)
        try:
            await cls.apply_resting(container)
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

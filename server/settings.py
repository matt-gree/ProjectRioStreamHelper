import ast
import asyncio
import copy
import importlib.util
import sys
import orjson
from pathlib import Path

from aiopath import AsyncPath
from loguru import logger
from server import socketio
from server.paths import user_data_dir
from server.utils import json
from server.utils.deep_dict import deep_set, deep_unset, deep_get


# ── The Event Header's two bands are ORDERED FIELD LISTS ──
#
# Each band was seven fixed positions with a boolean apiece — `showCompetition`,
# `showLocation`, … — and the ORDER lived in the overlay's own render call
# (`[fCompetition, fLocation, fDates]`). So a producer could hide the location
# but never put the dates first, and the only field they could actually write
# was the message.
#
# A band is a list now: `overlays.eventheader.bands.{header,footer}` is an
# ordered array of `{id, on, text}`, drawn left→right. `text` OVERRIDES the
# field's source ("Winners Final" over a start.gg round name), blank falls back
# to it, and `message` is simply the entry with no source — which is what it
# always was, spelled the same way as the rest instead of as a special key.
#
# Which band a field is in is which array holds it, so moving one across is the
# same edit as moving it along. The pairs below are the DEFAULT arrangement and
# the legacy switch each field's `on` migrates from; they are also the census of
# known fields, which is what `_eventheader_bands` heals against.
# The socials pair has no legacy switch behind it — it is newer than the
# switches — so it reads the default and starts on. That is safe rather than
# intrusive: a field with no source draws only its own text, and a band drops a
# field that resolves to nothing, so an unfilled handle is absent from the
# broadcast until a producer types one in.
EVENTHEADER_FIELDS = {
    "header": [("competition", "showCompetition"), ("location", "showLocation"),
               ("dates", "showDates")],
    "footer": [("message", "showMessage"), ("event", "showEvent"),
               ("phase", "showPhase"), ("round", "showRound"),
               ("twitter", "showTwitter"), ("youtube", "showYoutube")],
}


# The type size the Event Header's bands were composed at, mirrored by
# BASE_FONT_PX in public/layout/lib/eventheader-mount.js. Only the migration
# below reads it: the mount divides the stored px by the same number to get the
# `--font-scale` its band height, field gap and bar corner are stated in.
EVENTHEADER_BASE_FONT_PX = 34


# The font border's colour shipped at 90% opacity, which was never a decision.
# An outline is either drawn or it is not, and a tenth of the background bleeding
# through a stroke that is often 1px reads as a soft edge rather than a lighter
# one — the alpha is there to be turned DOWN deliberately, not to start turned
# down. Fully opaque now.
_LEGACY_STROKE_COLOR = "rgba(0, 0, 0, 0.9)"
_OPAQUE_STROKE_COLOR = "rgba(0, 0, 0, 1)"


def _adopt_opaque_stroke(overlays: dict) -> bool:
    """Carry a stored font-border colour still at the old default forward.

    Changing the default alone would reach NEW INSTALLS ONLY. `_deep_merge`
    writes the whole settings dict back, so a default is persisted the moment
    anything else is saved and from then on is indistinguishable from a value
    the producer chose (the same trap `loaded_server` is captured for) — every
    existing install would keep 90% and the new default would be invisible.

    Exact match only, and every namespace under `overlays`: the global, each
    element's pin, each per-board pin. A per-element pin is SEEDED FROM THE
    GLOBAL, so those hold the old default for the same reason the global does,
    and leaving them behind would make a pinned element the one place still
    drawing 90% after the bump.

    The cost is a producer who deliberately chose exactly 0.9, which the stored
    value cannot distinguish from the shipped one. They set it again.
    """
    changed = False

    def walk(node):
        nonlocal changed
        if not isinstance(node, dict):
            return
        if node.get("textStrokeColor") == _LEGACY_STROKE_COLOR:
            node["textStrokeColor"] = _OPAQUE_STROKE_COLOR
            changed = True
        for value in node.values():
            walk(value)

    walk(overlays)
    return changed


def _eventheader_font_px(ns: dict) -> bool:
    """The band type size, through both of its moves. True if changed.

    ``fontScale`` (% of a 34px base) became ``fontSize`` (px), and ``fontSize``
    then became ``headerFontSize`` + ``footerFontSize`` — the bands size
    independently, because the top strip names the competition and the bottom
    carries round and phase.

    A percentage of a number the producer never sees is a knob that can only be
    calibrated by eye — "as tall as the scoreboard's names" was reachable only
    by trial, and two elements set to the same size read 100 and 34. Everything
    still derives from the type size; only the unit the setting is stated in
    moved, so the conversion is exact and one-time.

    One-time because the legacy key is POPPED: its absence is the flag. A
    `fontSize` already present wins — a producer who set one after upgrading is
    not overwritten by a stale percentage left beside it.
    """
    changed = False

    # Step one: the percentage became a px size.
    if "fontScale" in ns:
        raw = ns.pop("fontScale")
        changed = True
        if "fontSize" not in ns:
            try:
                pct = float(raw)
            except (TypeError, ValueError):
                pct = None  # unreadable: dropped, and the 34px default stands
            if pct is not None:
                px = round(EVENTHEADER_BASE_FONT_PX * pct / 100)
                # The panel's own range, so a migrated value is one the control
                # can show.
                ns["fontSize"] = max(16, min(72, px))

    # Step two: the one size became one per band. Chained rather than branched,
    # so an install still on `fontScale` lands on the pair in a single boot
    # instead of needing two releases to get there.
    if "fontSize" in ns:
        size = ns.pop("fontSize")
        changed = True
        for key in ("headerFontSize", "footerFontSize"):
            # A size already set for a band wins: it is the newer statement.
            if key not in ns:
                ns[key] = size

    return changed


def _eventheader_bands(ns: dict) -> bool:
    """Bring ``overlays.eventheader`` up to the ordered-field model. True if changed.

    Runs on every Load, not once, because it does two jobs. The first is the
    one-time migration off the switches, flagged by `bands` being absent. The
    second is HEALING: a field in neither array is a field with no way back —
    unreachable on the panel and undrawable by the overlay — so a release that
    adds one (or a hand-edited settings.json that drops one) appends it to its
    default band rather than losing it silently. Both write the same shape, so
    there is one statement of what a band contains.
    """
    stored = ns.get("bands")
    stored = stored if isinstance(stored, dict) else {}
    bands: dict[str, list] = {}

    known = {fid for fields in EVENTHEADER_FIELDS.values() for fid, _ in fields}
    changed = False
    seen: set[str] = set()
    for band in EVENTHEADER_FIELDS:
        raw = stored.get(band)
        raw = raw if isinstance(raw, list) else []
        # A stored id keeps the place the producer put it; only its shape is
        # normalised, so an upgrade never re-sorts a band someone arranged. An
        # id that is a duplicate or no longer a field is dropped — it can name
        # no source and would draw nothing.
        kept = []
        for e in raw:
            fid = e.get("id") if isinstance(e, dict) else None
            if fid not in known or fid in seen:
                continue
            seen.add(fid)
            kept.append({"id": fid, "on": e.get("on", True) is not False,
                         "text": str(e.get("text") or "")})
        if kept != raw:
            changed = True
        bands[band] = kept

    for band, fields in EVENTHEADER_FIELDS.items():
        for fid, legacy_switch in fields:
            if fid in seen:
                continue
            seen.add(fid)
            # The legacy switch survives as the field's initial `on`; a switch
            # nobody ever touched defaults on, same as it did.
            bands[band].append({
                "id": fid,
                "on": ns.get(legacy_switch, True) is not False,
                # The banner line is the only legacy field with authored text,
                # and this is where it lands — the message entry's own override.
                "text": str(ns.get("message") or "") if fid == "message" else "",
            })
            changed = True

    if changed:
        ns["bands"] = bands
        for _, fields in EVENTHEADER_FIELDS.items():
            for _, legacy_switch in fields:
                ns.pop(legacy_switch, None)
        ns.pop("message", None)
    return changed


# The four containers (and the Roster + Stats pair's two rules) that fresh
# installs used to be seeded with. See `container_defs` in the defaults.
_SEEDED_CONTAINER_IDS = ("callout-stage", "split-screen", "roster-stats-1", "roster-stats-2")
_RETIRED_FLAG = "seeded_containers_retired"


def _retire_seeded_containers(production: dict) -> bool:
    """Remove the formerly seeded containers from an existing install, once.

    All four go whether or not the producer edited them — the decision was that
    a container is something a producer builds, not something the app hands
    them — and so does every rule aimed at one, seeded or producer-added, since
    a rule whose container is gone is inert and would revive the day the id is
    reused. The container's live feed and reason in State are swept at boot by
    `Automations.settle_all`, which drops any feed with no definition.

    Run-once, behind a flag rather than on every boot, because container ids are
    slugged from the NAME: a producer who later builds their own "Callout Stage"
    gets `callout-stage` back, and an unflagged sweep would delete it on every
    restart. The flag is written on fresh installs too, where there is nothing
    to remove, for the same reason.
    """
    if production.get(_RETIRED_FLAG):
        return False
    defs = production.get("container_defs")
    if isinstance(defs, dict):
        for cid in _SEEDED_CONTAINER_IDS:
            defs.pop(cid, None)
    rules = production.get("automations")
    if isinstance(rules, dict):
        for rid in [rid for rid, rule in rules.items()
                    if isinstance(rule, dict) and rule.get("container") in _SEEDED_CONTAINER_IDS]:
            rules.pop(rid)
    production[_RETIRED_FLAG] = True
    return True


# Settings no code reads any more. `_deep_merge` keeps whatever the file had,
# so a key the app stopped using stays in every settings.json forever unless it
# is named here. Dotted paths; an `overlays.{ns}.{key}` entry is also dropped
# from that namespace's per-board children (`overlays.{ns}.{N}.{key}`).
_RETIRED_SETTINGS = (
    # TournamentStreamHelper leftovers
    "hotkeys",
    "general.profanity_filter",
    "general.disable_autoupdate",
    "general.disable_overwrite",
    "general.control_score_from_stage_strike",
    "challonge",
    "ui.color_scheme",
    # 1.x game feeds and the old global pin
    "ongoing_games",
    "completed_games",
    "project_rio.pinned_hud_only",
    # overlay settings whose controls are gone
    "overlays.scene",
    "overlays.global.textShadowX",
    "overlays.global.textShadowY",
    "overlays.roster.portraitStyle",
    "overlays.scorecard.showBases",
    "overlays.scorecard.showRosters",
    "overlays.schedule.showCompleted",
)


def _drop_retired(settings: dict) -> bool:
    """Remove every `_RETIRED_SETTINGS` path, plus the 1.x board config once
    the binding migration no longer needs it. Returns True if anything went."""
    changed = False

    def drop(node, parts):
        nonlocal changed
        if not isinstance(node, dict):
            return
        head, rest = parts[0], parts[1:]
        if not rest:
            if head in node:
                node.pop(head)
                changed = True
            return
        drop(node.get(head), rest)

    for path in _RETIRED_SETTINGS:
        parts = path.split(".")
        drop(settings, parts)
        if parts[0] == "overlays" and len(parts) == 3:
            ns = (settings.get("overlays") or {}).get(parts[1])
            if isinstance(ns, dict):
                for key, child in ns.items():
                    if key.isdigit():
                        drop(child, parts[2:])

    boards = settings.get("scoreboards")
    if isinstance(boards, dict) and boards.get("binding_schema", 1) >= 2:
        for legacy in ("sources", "rotation"):
            if legacy in boards:
                boards.pop(legacy)
                changed = True
    return changed


def _load_freeze_version_module():
    """Load scripts/freeze-version.py by PATH, or None.

    The module lives outside the `server` package because it has to be
    runnable as a standalone build script too (Vite prebuild, PyInstaller
    hook, CI checks), and its filename's hyphen means it can never be a
    plain import. Loaded by file path so it resolves in dev *and* in
    PyInstaller bundles, where the layout is flattened.
    """
    candidates = [
        Path(__file__).resolve().parent.parent / "scripts" / "freeze-version.py",
        Path(getattr(sys, "_MEIPASS", "")) / "scripts" / "freeze-version.py"
            if getattr(sys, "_MEIPASS", None) else None,
    ]
    for path in filter(None, candidates):
        if not path.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("_freeze_version", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
            return mod
        except Exception as e:
            logger.warning("[Config] freeze-version load failed at {}: {}", path, e)
    return None


def _resolve_metadata() -> dict:
    """Name/description/authors, resolved by the same chain as the version.

    pyproject.toml in a source checkout, the frozen `_version.py` in a
    packaged build. Returns {} when neither is readable, which leaves
    `Config.config`'s own defaults in place.

    This exists because `pyproject.toml` is a BUILD file and is not bundled,
    so a frozen app had no source for it and silently served the defaults —
    `"authors": []` from every release, while a dev server served the real
    list off the same endpoint.
    """
    mod = _load_freeze_version_module()
    if mod is not None:
        try:
            meta = mod.resolve_metadata()
            if meta:
                return meta
        except Exception as e:
            logger.warning("[Config] metadata resolve failed: {}", e)

    # THE FROZEN PATH, and the one that actually runs in a release.
    #
    # `scripts/` is not in the bundle — nothing lists it in PRSH.spec's datas —
    # so `_load_freeze_version_module` returns None in every packaged build and
    # the branch above never fires there. The version survives that only
    # because `_resolve_version` carries this same direct read; metadata
    # without it went on serving `"authors": []` from the bundle after the
    # resolver was supposedly fixed. Read the generated file ourselves.
    #
    # Flat line scan + literal_eval rather than an import, matching
    # `_read_frozen_metadata` in freeze-version.py: a generated file must not
    # be able to execute anything, and this has to work whatever state the
    # package is in.
    frozen = Path(__file__).resolve().parent / "_version.py"
    if frozen.is_file():
        try:
            for line in frozen.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("METADATA") and "=" in line:
                    _, _, rhs = line.partition("=")
                    value = ast.literal_eval(rhs.strip())
                    if isinstance(value, dict) and value:
                        return value
        except (OSError, ValueError, SyntaxError) as e:
            logger.warning("[Config] frozen metadata read failed: {}", e)
    return {}


def _resolve_version() -> str:
    """Resolve app version via scripts/freeze-version.py."""
    candidates = [
        Path(__file__).resolve().parent.parent / "scripts" / "freeze-version.py",
        Path(getattr(sys, "_MEIPASS", "")) / "scripts" / "freeze-version.py"
            if getattr(sys, "_MEIPASS", None) else None,
    ]
    for path in filter(None, candidates):
        if not path.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("_freeze_version", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
            return mod.resolve_version()
        except Exception as e:
            logger.warning("[Config] freeze-version load failed at {}: {}", path, e)

    # Fallback: the resolver couldn't be loaded at all. Try the frozen
    # _version.py directly so a packaged build still shows something useful.
    frozen = Path(__file__).resolve().parent / "_version.py"
    if frozen.is_file():
        try:
            for line in frozen.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("VERSION") and "=" in line:
                    _, _, rhs = line.partition("=")
                    v = rhs.strip().strip('"').strip("'")
                    if v:
                        return v
        except OSError:
            pass
    return "0.0.0-dev"


# Settings keys whose raw values must never leave the server. Reads return a
# bool/sentinel; SocketIO broadcasts replace the value with the same sentinel.
# At-rest these are still plaintext in settings.json — encrypting the file
# doesn't defend against the LAN API surface, which is the actual exposure.
# Currently empty (the Challonge API key was the only member); the mechanism
# stays for the next secret-valued setting.
SECRET_KEYS = frozenset()

_REDACTED = "***"


def redact_value(key: str, value):
    """Redact a single setting value for wire output if its key is secret."""
    if key not in SECRET_KEYS:
        return value
    return _REDACTED if value else ""


def redact_settings(settings_dict: dict) -> dict:
    """Return a deep copy of settings with secret-key values redacted."""
    out = copy.deepcopy(settings_dict)
    for dotted in SECRET_KEYS:
        existing = deep_get(out, dotted, None)
        if existing is None:
            continue
        deep_set(out, dotted, _REDACTED if existing else "")
    return out


# Settings subtrees the PRODUCER owns outright, exempt from the defaults merge.
#
# The merge below exists so a new default KNOB reaches an existing user without
# migration code — it treats every default key as a value the app supplies and
# the file may override. That is exactly wrong for a producer-built COLLECTION,
# where the defaults are a one-time SEED and deleting an entry is a real edit:
# merging the seed back over the file resurrects every deleted container and
# rule on the next launch, and the producer has no way to make a deletion stick
# short of hand-editing a file the app then overwrites.
#
# So for these paths the stored map is authoritative the moment it exists: the
# seed lands only when the key is ABSENT (fresh install, or an upgrade from
# before the key existed), and after that the file is the whole truth — no
# resurrection, and no per-entry back-fill of a def the producer has edited.
#
# The cost is that a NEW seeded entry can never reach an existing user
# implicitly — it lands on fresh installs, or in an explicit one-time migration
# in Load() alongside the others there, which can seed a single id without
# touching anything the producer built. Cheap either way while 2.0.0 is
# unreleased, and the right trade regardless for content that sits in a live
# show: a producer who deleted a container did so on purpose.
#
# Both maps below seed `{}` today (nothing ships — see `container_defs`), which
# makes the exemption a no-op until something is seeded into them again; they
# stay listed so that seed cannot resurrect a deletion. `production.overrides`,
# `scoreboards.aliases` and friends are producer-owned in the same sense and
# were never seeded, so they are not listed.
_USER_OWNED_MAPS = frozenset({
    "production.container_defs",
    "production.automations",
})


def _deep_merge(defaults: dict, loaded: dict, path: str = "") -> dict:
    """Merge loaded settings on top of defaults.

    Loaded values take precedence, but any keys present in defaults
    that are missing from loaded are preserved. This ensures new
    default keys are automatically available after upgrades without
    needing explicit migration code.

    Exception: a path in `_USER_OWNED_MAPS` is replaced wholesale rather than
    merged, so a producer's deletion survives a restart. See that constant.
    """
    result = dict(defaults)
    for key, value in loaded.items():
        dotted = f"{path}.{key}" if path else key
        if dotted in _USER_OWNED_MAPS and isinstance(value, dict):
            result[key] = value
        elif key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value, dotted)
        else:
            result[key] = value
    return result


class Settings:
    # Bumped on every write (and after Load). Read-mostly consumers that would
    # otherwise re-normalize a settings subtree on the hot path cache against
    # this instead of subscribing — cheaper than a watcher list, and impossible
    # to leak. The first of them is the state write hook in server/automations.py.
    revision = 0
    # Write observers: `async (keys) -> None`, run after a write has landed and
    # been emitted. For the few server-side models that derive State from a
    # setting (today: server/league_logos.py, off a binding's `stats_tag`). An
    # observer that raises is logged and skipped — it must never lose a write.
    watchers: list = []
    settings = {
        "server": {
            # When False, bind to 127.0.0.1 (loopback only). When True, bind
            # to 0.0.0.0 so phones/tablets on the same WiFi can reach the UI
            # — but also exposes state and settings plaintext to anyone on
            # the network. Opt-in via Settings.
            "allow_lan": False,
            "port": 5260,
            "dev": True,
            "autostart": True
        },
        "general": {
            "disable_export": True,
        },
        "project_rio": {
            "hud_path": "",
            # When True, board 1 carries the local HUD transport (the local Rio
            # game auto-fills scoreboard 1). When False, board 1 behaves like any
            # API board. This is the single control for "is board 1 the HUD board"
            # — there is no per-board source selector. Toggled beside the HUD path.
            "hud_enabled": True
        },
        "postgame": {
            # Capture a finished game's box score as soon as Project Rio writes
            # its stat file, instead of waiting for the producer to press
            # Capture. The file landing IS the end-of-game signal for a local
            # board — see server/postgame/watch.py. Off leaves capture manual;
            # the button is on every board panel either way.
            "auto_capture": True,
        },
        "scoreboards": {
            "active": [1],
            "aliases": {},
            # Per-scoreboard binding: pool (membership: filters/scope/pinned/
            # excluded) + playback (mode/gameId/interval) + stats_tag.
            # Created/migrated in Load(); see server/bindings.py for the model.
            # The 1.x `sources` / `rotation` it migrates from are dropped by
            # `_drop_retired` once the migration has run.
            # Which `schedule.queues` entry each board takes its next fixture
            # from: {"2": "losers"}. Deliberately NOT part of `binding` — that
            # is pool + playback + stats_tag, "which GAMES fill this board",
            # where this is which running order of FIXTURES it draws from.
            # Absent (the normal case) means the first queue, so a single-queue
            # rig needs no configuration at all — see
            # `Schedule.queue_for_board`.
            "match_queue": {},
        },
        "obs": {
            # OBS WebSocket (obs-websocket v5, OBS 28+). The connection is made
            # from the browser (frontend) to localhost:4455, NOT from this
            # backend — so it reaches the OBS the producer is sitting at even in
            # dual-machine setups (OBS on the streaming PC, PRSH on the gaming
            # PC). Enable the server in OBS via Tools -> WebSocket Server Settings.
            "host": "127.0.0.1",
            "port": 4455,
            "password": "",
            "auto_connect": True,
            # Has a connection to OBS EVER succeeded on this install?
            #
            # Purely a presentation flag, and it exists because auto_connect is
            # on by default: OBS ships with its websocket server OFF, so the
            # very first launch always fails a connect and the console led with
            # a red "OBS connection error" — the app's alarm vocabulary spent on
            # the expected state of a machine nobody has set up yet. Before the
            # first success a failure is "not set up"; after it, a failure is a
            # real error, including for the common rig that never touches the
            # host, port or password and so would look unconfigured forever.
            #
            # Deliberately NOT part of the status machine (src/context/obs.jsx):
            # backoff, the catalog tier and useConsoleOffline all keep reading
            # the same 'error' they always did.
            "ever_connected": False,
        },
        "production": {
            # Producer page. Elements themselves are dev-defined in the
            # frontend; this only persists per-streamer choices. `overrides`
            # maps an element id -> the OBS source name the streamer picked as
            # a fed element's target shared source (instead of the default).
            "overrides": {},
            # Producer-built shared CONTAINERS. A container is one OBS browser
            # source that hosts whichever of its members the producer feeds it
            # (production.feed.container.{id} holds exactly one occupant), so
            # its members are by definition mutually exclusive — the roster IS
            # the membership relation, and nothing else stores it.
            #
            # `width`/`height` are the source's native pixel size: the size of
            # the LARGEST member, since smaller members center and are never
            # scaled (PRSH has no scaling system — OBS does placement). The
            # member picker is filtered to what fits, so a size mismatch is
            # unrepresentable rather than handled.
            #
            # Two optional fields exist for automation (server/automations.py)
            # and are absent until a producer sets them:
            #
            #   `resting`  the member this container returns to when nothing
            #              else is up — the steady state a rule's dwell expires
            #              back into. Absent/None means empty (transparent),
            #              which is the resting state of every container that
            #              only ever holds pushed content.
            #   `scope`    {"scoreboard": N, "team": T} — this container's frame
            #              of reference. It resolves `{sb}` in a rule's trigger
            #              and supplies the side for the content the engine
            #              feeds, which is what makes a mirrored pair of
            #              containers flash the batter on one and the pitcher on
            #              the other.
            #
            # NONE SHIP. A fresh install starts with no containers and no rules:
            # a container exists because a producer built one, from the Add
            # picker's + New, and until they do the catalog offers elements and
            # nothing else. Four used to be seeded (Callout Stage, Split-Screen
            # and the Roster + Stats pair, with the pair's two batter-card
            # rules); they read as part of the app rather than as something the
            # producer had made, and are removed from existing installs once by
            # `_retire_seeded_containers` below.
            #
            # Both maps stay in `_USER_OWNED_MAPS`, so a deletion is durable and
            # anything seeded here again would reach fresh installs only.
            "container_defs": {},
            # Container AUTOMATIONS — one rule per entry, interpreted by the
            # server-side engine in server/automations.py:
            #
            #   {"enabled": bool, "name": str, "container": id,
            #    "trigger": "score.{sb}.batter", "member": elementId,
            #    "guard": "content", "dwell": seconds}
            #
            # A rule watches one state key, and when it CHANGES (and the guard
            # resolves) it feeds `member` into `container` for `dwell` seconds
            # before returning to that container's resting occupant. `{sb}` in
            # the trigger resolves from the container's own scope, so the rule
            # itself is board-agnostic and reads the same on every board.
            #
            # A producer adds rules from the quick-add library (the templates
            # live with the console, src/routes/production/containers/automations.js — the
            # engine only interprets rules). The rule id is
            # `{container}:{template}`, which is `ruleIdFor` over there: two
            # containers running one canned rule is how a mirrored pair is
            # built, so the container has to be part of the id.
            "automations": {},
            # Hit-visualizer "spotlight": on Fire, cut to `scene`, play the
            # animation, then cut back to the previous program scene. `holdMs`
            # is extra time held on the landing before returning.
            "spotlight": {
                "enabled": False,
                "scene": "",
                "holdMs": 1500
            },
            # Confirm-to-live: element changes made on the Production page are
            # staged in the browser and only pushed to live state / OBS when
            # the producer commits (the hotkey or the Go Live button). Momentary
            # actions (scene switches, Take, replay/spotlight) stay immediate.
            "confirm": {
                "enabled": False,
                "hotkey": "F9"
            },
            # What the CONSOLE calls side 1 and side 2 — "numeric" (Side 1 /
            # Side 2), "lr" (Left / Right) or "tb" (Top / Bottom). Vocabulary
            # only: the model is `score.{N}.player.{T}` whatever this says, and
            # overlays never read it.
            #
            # Numeric is the default because it is the only one true in every
            # arrangement. Left/Right is a fact about ONE scene layout, and a
            # producer who stacks their sides vertically (or simply puts side 2
            # on the left) gets a board desk that lies to them about the thing
            # they opened it to check.
            #
            # Server settings rather than browser-local workspace state: it
            # describes how the broadcast is laid out, so a second producer on a
            # second machine must see the same words. Client:
            # src/routes/production/sides.js.
            "side_labels": "numeric"
        },
        "announcements": {
            "dismissed_ids": [],
            "check_for_updates": True,
        },
        "controller_overlay": {
            "port": 8069,
            "auto_start": False,
        },
        "overlays": {
            "schema_version": 5,
            "global": {
                "accentColor": "#f59e0b",
                "cardBg": "rgba(15, 15, 25, 0.88)",
                "textColor": "#ffffff",
                "borderRadius": 16,
                "borderWidth": 1,
                "borderColor": "rgba(255, 255, 255, 0.08)",
                # THREE TYPE ROLES, not one face (v5). The token layer
                # (public/layout/lib/rio-theme/tokens.css) has always split
                # broadcast type three ways — display for names and titles,
                # body for prose and meta, mono for tabular values — and every
                # theme SVG paints from those. The single `fontFamily` reached
                # only the four DOM-rendered elements, so setting it split the
                # show in half. These are the producer's end of the same three
                # roles, and the defaults ARE the token layer's, so nothing
                # moves until one is changed.
                "displayFont": "Rajdhani",
                "bodyFont": "Inter",
                "monoFont": "Chivo Mono",
                "showShadow": True,
                "cardShadowBlur": 16,
                "cardShadowColor": "rgba(0, 0, 0, 0.5)",
                "textShadowEnabled": False,
                "textShadowBlur": 4,
                "textShadowColor": "rgba(0, 0, 0, 0.8)",
                # Font border (text stroke). 0 = off, and there is no enable
                # flag: the width is the switch. Left global at 0, a producer
                # pins one on a single element from its Production stage panel
                # (overlays.{type}.textStrokeWidth), which is the shape this
                # feature is usually wanted in.
                "textStrokeWidth": 0,
                "textStrokeColor": "rgba(0, 0, 0, 1)",
                "showCaptains": True,
                "showLogo": True,
                "finalBadgeColor": None,
                # Controller-port palette (ports 1-4). GLOBAL, not per element:
                # the red that says "port 1" on the scoreboard says it on the
                # scorecard, the lower third and both callouts too.
                # None = unset, which is not "no colour" but "inherit" — the
                # active design package's own `portColors`, else the app's
                # built-in convention. See public/layout/lib/port-colors.js.
                "port0Color": None,
                "port1Color": None,
                "port2Color": None,
                "port3Color": None,
            },
            "presets": {},
            "scoreboard": {
                "showTeamLogos": True,
                "showGameMode": True,
                "showStats": True,
                "showRoster": True,
                "showBox": True,
            },
            "roster": {
                "showSuperstars": True,
                "showRoleIcon": True,
                "showTeamLogo": True,
            },
            "statsbar": {
                "transitionType": "fade",
                "statValueColor": None,
                "subtextColor": None,
            },
            "teamlogo": {},
            "ticker": {
                "tickerSpeed": 60,
                "tickerGap": 16,
            },
            "bracket": {
                "connectorColor": None,
                "activeColor": None,
                # Cap on how much the bracket scales UP to fill the OBS frame.
                # 1.0 = never enlarge past designed pixel sizes (small brackets
                # render at native size, centered in the source). 1.5 lets
                # small brackets grow a bit. >2.0 = "always fill the frame."
                "maxScale": 1.0,
            }
        },
        "lang": "en-US"
    }
    # Resolved lazily (first use, cached) so a PRSH_USER_DATA_DIR override is
    # honored and tests can inject a temp path by assigning this directly.
    _settings_out: AsyncPath | None = None
    _save_lock: asyncio.Lock = asyncio.Lock()

    @classmethod
    def _settings_file(cls) -> AsyncPath:
        if cls._settings_out is None:
            cls._settings_out = AsyncPath(str(user_data_dir() / 'settings.json'))
        return cls._settings_out

    @classmethod
    async def Save(cls):
        async with cls._save_lock:
            # Write to a sibling .tmp file then atomically rename so a kill
            # mid-write can't truncate settings.json and reset the user's
            # config to defaults on the next launch.
            tmp = AsyncPath(str(cls._settings_file()) + ".tmp")
            async with tmp.open(mode='wb') as f:
                content = await json.dumps(cls.settings)
                await f.write(content)
            await tmp.replace(cls._settings_file())

    @classmethod
    async def Load(cls) -> dict:
        loaded_server: dict = {}
        # Captured for the same reason as `loaded_server`: once `_deep_merge` has
        # run, a default is indistinguishable from a value the producer set to
        # the same thing. For the v5 type-role split: after `_deep_merge` the
        # three seeded faces are present on `global` whether or not the file
        # named them, so the only way to tell a producer's explicit `displayFont`
        # from the shipped one is to have looked before the merge.
        loaded_overlays: dict = {}
        file_existed = False
        try:
            async with cls._settings_file().open(mode='rb', encoding='utf-8') as f:
                loaded = await asyncio.to_thread(
                    orjson.loads,
                    await f.read()
                )
                file_existed = isinstance(loaded, dict)
                loaded_server = (loaded.get("server") or {}) if isinstance(loaded, dict) else {}
                loaded_overlays = (loaded.get("overlays") or {}) if isinstance(loaded, dict) else {}
                cls.settings = _deep_merge(cls.settings, loaded)
        except Exception:
            logger.debug("using default settings dict")

        # Migrate legacy `server.host` to `server.allow_lan`. Prior versions
        # defaulted host to "0.0.0.0"; on upgrade preserve LAN access for
        # users who already had it. New installs ship loopback-only.
        if "host" in loaded_server and "allow_lan" not in loaded_server:
            legacy_host = loaded_server.get("host")
            if legacy_host and legacy_host not in ("127.0.0.1", "localhost", "::1"):
                cls.settings["server"]["allow_lan"] = True
        cls.settings.get("server", {}).pop("host", None)
        if "host" in loaded_server:
            await cls.Save()

        # `overlays.stats` -> `overlays.statsbar`. The element was renamed when
        # the wide bar and the 2x2 card stopped sharing the ambiguous name
        # "Stats": the bar is `statsbar` (its own ?team= source, statsbar.svg)
        # and the card stays `statscard`. The namespace is the producer's
        # authored look — accent, card background, shadows — so it MOVES rather
        # than resetting to defaults. Merge-under, never overwrite: a producer
        # who has already configured the new key wins, which also makes this
        # idempotent across restarts.
        _overlays = cls.settings.get("overlays")
        if isinstance(_overlays, dict) and isinstance(_overlays.get("stats"), dict):
            legacy_stats = _overlays.pop("stats")
            current = _overlays.get("statsbar")
            _overlays["statsbar"] = {
                **legacy_stats,
                **(current if isinstance(current, dict) else {}),
            }
            await cls.Save()

        # `controller_overlay.display` is gone entirely.
        #
        # gc-overlay's appearance briefly had an app-wide copy here, with
        # per-element three-state pins over it. The second layer bought nothing:
        # a pin beats the global, so the moment an element was touched the global
        # stopped reaching it — invisibly, from a tab that could not show why.
        # `overlays.controller.*` is shared by both sides already, so one layer
        # is app-wide for every controller source anyway.
        #
        # Dropped rather than merged down: it never shipped, and a stale block in
        # a namespace the producer can read is one they will one day try to use.
        _co = cls.settings.get("controller_overlay")
        if isinstance(_co, dict) and "display" in _co:
            _co.pop("display", None)
            await cls.Save()

        # The controller element's own pins, from the same 1.4.0 change.
        #
        # `overlays.controller.idleFill` was a three-state select while the
        # setting was a switch; nothing reads it now, and a dead key in a
        # namespace the producer can see is a key they will one day try to use.
        #
        # `idleFillOpacity` is CLAMPED rather than reinterpreted. Out-of-range
        # values got here one way — a percentage typed into a 0..1 number field,
        # which is exactly why that control is a slider now — but 10 could mean
        # "10%" or "as solid as it goes", and the mount already clamps, so
        # storing what is actually being drawn is the reading that changes
        # nothing on air. The producer moves it with one drag either way.
        _pins = cls.settings.get("overlays", {}).get("controller")
        if isinstance(_pins, dict):
            _dirty = _pins.pop("idleFill", None) is not None

            # `labels`/`keyline` were three-state selects while there was an
            # app-wide layer to inherit from: 'inherit' | 'shown' | 'hidden'.
            # They are plain booleans now, and leaving the strings would be
            # SILENT and backwards — every one of them is truthy, so a producer
            # who had switched the letters off would find them back on with the
            # switch reading On, and the mount's `typeof === 'boolean'` guard
            # would quietly substitute the default.
            for _key in ("labels", "keyline"):
                _v = _pins.get(_key)
                if isinstance(_v, str):
                    if _v == "inherit":
                        # Inherited the app-wide value, which is gone. The
                        # default is what it resolved to for anyone who never
                        # touched that tab, and is gc-overlay's own.
                        _pins.pop(_key)
                    else:
                        _pins[_key] = _v == "shown"
                    _dirty = True

            _opacity = _pins.get("idleFillOpacity")
            if isinstance(_opacity, (int, float)) and not 0.0 <= _opacity <= 1.0:
                _pins["idleFillOpacity"] = min(1.0, max(0.0, float(_opacity)))
                _dirty = True
            if _dirty:
                await cls.Save()

        # Design "Looks" were renamed Presets (2026-09-18). The saved designs
        # always lived at `overlays.presets.*`; only the pointer to the applied
        # one carried the old word.
        _ov = cls.settings.get("overlays")
        if isinstance(_ov, dict) and "active_look" in _ov:
            _ov.setdefault("active_preset", _ov.get("active_look"))
            _ov.pop("active_look", None)
            await cls.Save()

        # One-time overlay schema migration to v2: keys that were previously
        # duplicated as per-layout overrides (showCaptains, showLogo, etc.)
        # have been promoted to globals. Strip stale per-layout copies so the
        # global value is the single source of truth. Layout-specific fields
        # (showElo, statValueColor, etc.) are preserved.
        overlays = cls.settings.get("overlays", {})
        if overlays.get("schema_version", 1) < 2:
            promoted_to_global = {
                "showCaptains", "showLogo", "showShadow", "showBackdropBlur",
                "finalBadgeColor", "accentColor", "textColor", "cardBg",
                "borderColor", "borderRadius", "borderWidth",
                "cardShadowBlur", "textShadowBlur",
            }
            for layout_type, layout_dict in list(overlays.items()):
                if layout_type in ("global", "presets", "schema_version"):
                    continue
                if not isinstance(layout_dict, dict):
                    continue
                for key in list(layout_dict.keys()):
                    if key in promoted_to_global:
                        layout_dict.pop(key, None)
            overlays["schema_version"] = 2
            await cls.Save()

        # v3: ELO's default flipped to off (it is a season-play number, and it
        # was holding the widest thirds of the completed-game row at every
        # tournament broadcast). The seeded `true` has to be CLEARED, not left,
        # or the new default never reaches anyone who already ran the app.
        #
        # Only the un-scoped leaf, which is the one the seed writes. A per-board
        # pin (overlays.scoreboard.{N}.showElo) is nothing but an explicit
        # choice — nothing seeds those — so those are left exactly as found.
        if overlays.get("schema_version", 1) < 3:
            sb_overlays = overlays.get("scoreboard")
            if isinstance(sb_overlays, dict) and sb_overlays.get("showElo") is True:
                sb_overlays.pop("showElo", None)
            overlays["schema_version"] = 3
            await cls.Save()

        # v4: the controller-port palette was promoted to a global. It was read
        # per layout (overlays.{type}.port{N}Color) by five mounts but had a UI
        # on exactly one of them — the Character Spotlight — so a producer who
        # recoloured port 1 there watched the scoreboard, scorecard and lower
        # third keep the old red. It is one palette: a port is a player's
        # identity across the whole broadcast, so it lives on the Design tab
        # next to the design package that can now declare its own (see
        # design_packages._port_colors).
        #
        # The spotlight's copy wins, being the only one anything ever wrote;
        # a hand-edited settings.json with a colour only under some other
        # namespace still carries it up rather than losing it.
        if overlays.get("schema_version", 1) < 4:
            port_keys = [f"port{i}Color" for i in range(4)]
            glob = overlays.setdefault("global", {})
            namespaces = ["postgamecallout"] + [
                n for n in overlays if n not in ("global", "presets", "schema_version", "postgamecallout")
            ]
            for name in namespaces:
                ns = overlays.get(name)
                if not isinstance(ns, dict):
                    continue
                for key in port_keys:
                    value = ns.pop(key, None)
                    if value and not glob.get(key):
                        glob[key] = value
            overlays["schema_version"] = 4
            await cls.Save()

        # v5: `fontFamily` became three TYPE ROLES — displayFont / bodyFont /
        # monoFont. The old key named one face for the whole broadcast but only
        # ever reached the four DOM-rendered elements (Event Header, Player
        # Name, and the two post-game callouts); every theme SVG paints from the
        # token layer's three roles and cleared the app font outright. So a
        # producer who set it watched four elements change typeface and the
        # other fourteen ignore them.
        #
        # A STORED VALUE GOES ONTO ALL THREE, not onto the role it most
        # resembles. Whatever it was, it is what those elements were ALREADY
        # drawing in, and the migration's job is that nothing on air moves: a
        # producer who set "Bebas Neue" wanted Bebas Neue, and spreading it
        # across the roles is the only reading under which their broadcast looks
        # tomorrow the way it looked today. They can then pull the roles apart,
        # which is the point of the feature. The DEFAULT is not carried up — an
        # unset `fontFamily` (or the seeded "Inter") is the absence of a choice,
        # and treating it as one would pin Inter over the token layer's Rajdhani
        # and Chivo Mono for everyone who never opened the Design tab.
        #
        # Per-element pins migrate the same way, under the same namespace, so an
        # element carrying its own font keeps carrying it.
        if overlays.get("schema_version", 1) < 5:
            # Defaults are merged into `settings` BEFORE migrations run, so the
            # global namespace already carries the three seeded faces by the time
            # this fires and `setdefault` would silently do nothing on the one
            # namespace that matters. `loaded_overlays` is the pre-merge file, so
            # a role the producer actually wrote is the only one kept.
            roles = ("displayFont", "bodyFont", "monoFont")

            def _split_roles(ns: dict, was: dict) -> None:
                chosen = ns.pop("fontFamily", None)
                if chosen and chosen != "Inter":
                    for role in roles:
                        if role not in was:
                            ns[role] = chosen
                # A per-BOARD pin nests one level further (overlays.scorecard.
                # {N}.fontFamily), which is the shape the scorecard stores under.
                for key, sub in ns.items():
                    if isinstance(sub, dict):
                        _split_roles(sub, was.get(key) or {})

            for name, ns in overlays.items():
                if name in ("presets", "schema_version") or not isinstance(ns, dict):
                    continue
                _split_roles(ns, loaded_overlays.get(name) or {})
            overlays["schema_version"] = 5
            await cls.Save()

        # Container membership moved ONTO the container. It used to live per
        # element (`production.containers.{elementId}` -> container id) with the
        # element's own layout stem as the implicit default; it is now the
        # roster on `production.container_defs.{id}`. Two places storing one
        # relationship is how these drift, so the old key is dropped rather than
        # translated — 2.0.0 has never shipped.
        production = cls.settings.setdefault("production", {})
        if "containers" in production:
            production.pop("containers", None)
            await cls.Save()

        # The containers fresh installs used to be seeded with — once.
        if _retire_seeded_containers(production):
            await cls.Save()

        # The combined Roster + Stats element is gone (a container resting on a
        # roster with a batter-change rule over it IS that element, built from
        # parts), so its settings namespace has nothing left that reads it. Its
        # look now lives under the two namespaces the parts already had —
        # overlays.roster.* for the roster, overlays.statscard.* for the card —
        # and there is no honest way to translate a third copy into either: the
        # producer configured them apart on purpose, and picking a winner would
        # silently repaint a card they had already themed. Dropped rather than
        # left to rot, on the same reasoning as `production.containers` above:
        # nothing reads it, and a settings file people hand-edit should not
        # carry a section that does nothing.
        if "rosterstats" in cls.settings.get("overlays", {}):
            cls.settings["overlays"].pop("rosterstats", None)
            await cls.Save()

        # The Event Header's bands became ordered field lists (see
        # EVENTHEADER_FIELDS above). Migrates off the switches once, and heals a
        # missing field on every boot after that.
        _eh_ns = cls.settings.setdefault("overlays", {}).setdefault("eventheader", {})
        # Two migrations over one namespace, deliberately not short-circuited:
        # `or` would skip the second whenever the first reported a change.
        _eh_changed = _eventheader_bands(_eh_ns)
        _eh_changed = _eventheader_font_px(_eh_ns) or _eh_changed
        # Every overlay namespace, not just the Event Header's — see the docstring.
        _eh_changed = _adopt_opaque_stroke(cls.settings.get("overlays", {})) or _eh_changed
        if _eh_changed:
            await cls.Save()

        # One-time binding migration: unify the per-scoreboard source-type enum
        # (manual | hud | live_game) + orthogonal rotation feed into a single
        # `scoreboards.binding.{N}` model. Presence of `binding` is the flag, so
        # this runs exactly once. See server/bindings.py.
        scoreboards = cls.settings.setdefault("scoreboards", {})
        if "binding" not in scoreboards:
            sources = scoreboards.get("sources", {}) or {}
            rotation = scoreboards.get("rotation", {}) or {}
            active = scoreboards.get("active", [1]) or [1]

            binding: dict = {}
            for sb in active:
                key = str(sb)
                src = sources.get(key) if isinstance(sources.get(key), dict) else {}
                stype = src.get("type", "manual")
                stats_tag = src.get("stats_tag")
                rot = rotation.get(key) if isinstance(rotation.get(key), dict) else {}
                rot_on = bool(rot.get("enabled")) and bool(rot.get("game_ids"))

                if stype == "hud":
                    # HUD folds to the global board-1 transport; the board's own
                    # binding becomes a plain single/manual.
                    binding[key] = {"kind": "single", "gameId": None,
                                    "pool": "both", "stats_tag": stats_tag}
                elif stype == "live_game":
                    binding[key] = {"kind": "single", "gameId": src.get("api_game_id"),
                                    "pool": "both", "stats_tag": stats_tag}
                elif rot_on:
                    # A manual board with a running feed becomes a set binding;
                    # the rotation.{N} runtime (game_ids/cached_games) is left in
                    # place for RotationManager to resume from.
                    binding[key] = {"kind": "set", "gameId": None,
                                    "pool": rot.get("source_pool", "both"),
                                    "stats_tag": stats_tag}
                else:
                    binding[key] = {"kind": "single", "gameId": None,
                                    "pool": "both", "stats_tag": stats_tag}

            scoreboards["binding"] = binding

            # HUD is now a global transport switch that defaults ON — board 1
            # auto-fills from the local Project Rio game whenever one is present.
            # An API-only / no-Rio user just sees an empty (editable) board 1, so
            # defaulting on is harmless and matches the common case. Only write it
            # when the user hasn't already made an explicit choice (key absent
            # from their file) so a deliberate off survives upgrades.
            pr = (loaded.get("project_rio") if file_existed and isinstance(loaded, dict) else {}) or {}
            if "hud_enabled" not in pr:
                cls.settings.setdefault("project_rio", {})["hud_enabled"] = True

            await cls.Save()

        # One-time pool+playback migration (schema v2, see
        # ~/.claude/plans/pool-playback-unification.md): collapses each
        # binding's flat `kind`/`gameId`/`pool` (single|set) into `pool`
        # (filters/scope/pinned/excluded) + `playback` (mode/gameId/interval).
        # Gated on `binding_schema` so it runs exactly once, whether the v1
        # migration above just ran in this same Load() call or ran in a prior
        # session. `scoreboards.rotation.{N}` is read here (for interval/
        # current_index/game_ids/filters) and then left in place, unused, as a
        # migration fallback for one release — same pattern as `sources`.
        if scoreboards.get("binding_schema", 1) < 2:
            binding = scoreboards.setdefault("binding", {})
            rotation = scoreboards.get("rotation", {}) or {}

            for key, b in list(binding.items()):
                if not isinstance(b, dict) or "playback" in b:
                    continue  # already v2-shaped (defensive; shouldn't happen)

                kind = b.get("kind", "single")
                stats_tag = b.get("stats_tag")
                rot = rotation.get(key) if isinstance(rotation.get(key), dict) else {}

                if kind == "set":
                    # The old model was fundamentally manual-curation: whatever
                    # the user had selected becomes `pinned` so nobody's
                    # existing rotation silently starts growing/shrinking after
                    # upgrade. The old filters (if any) carry over as a single
                    # filter chip, but auto-poll's additive-only semantics do
                    # NOT — the new pool recompute adds *and* removes, so
                    # carrying old filters straight into continuous membership
                    # would change what's on-screen without the user asking.
                    # The chip is present but inert until the user re-saves it
                    # (touches the pool via the new UI), which is an acceptable
                    # one-time speed bump for a semantics change this size.
                    rot_filters = rot.get("filters") or {}
                    chip = {
                        "id": 1,
                        "tag": list(rot_filters.get("tag") or []),
                        "username": list(rot_filters.get("username") or []),
                        "vs_username": list(rot_filters.get("vs_username") or []),
                        "limit_games": rot_filters.get("limit_games"),
                    }
                    pool = {
                        "filters": [chip] if rot_filters else [],
                        "scope": b.get("pool", "both"),
                        "pinned": list(rot.get("game_ids") or []),
                        "excluded": [],
                        "pinned_cache": {
                            str(g.get("game_id")): g
                            for g in (rot.get("cached_games") or [])
                            if g.get("game_id") is not None
                        },
                        # Static: old auto-poll was additive-only, this pool
                        # model adds *and* removes — don't silently change
                        # what's on-screen for an existing rotation.
                        "refresh_interval": 0,
                    }
                    playback = {
                        "mode": "rotate",
                        "gameId": None,
                        "interval": rot.get("interval", 30),
                        "current_index": rot.get("current_index", 0),
                        # Carry the legacy "was this rotation actively cycling"
                        # signal forward so a rotation that was running at
                        # upgrade time resumes on next launch instead of
                        # silently landing paused (`running` defaults False).
                        "running": bool(rot.get("enabled")),
                        "interrupt": None,
                    }
                else:
                    pool = {
                        "filters": [], "scope": "both", "pinned": [], "excluded": [],
                        "pinned_cache": {}, "refresh_interval": 60,
                    }
                    playback = {
                        "mode": "single",
                        "gameId": b.get("gameId"),
                        "interval": 30,
                        "current_index": 0,
                        "interrupt": None,
                    }

                binding[key] = {"pool": pool, "playback": playback, "stats_tag": stats_tag}

            scoreboards["binding_schema"] = 2
            await cls.Save()

        if _drop_retired(cls.settings):
            await cls.Save()

    @classmethod
    async def adopt_eventheader_message(cls, message: str) -> bool:
        """Take the Event Header's banner line over from ``tournamentInfo.message``.

        The message is the one field on that overlay no other surface reads, so
        it moved out of the shared event-fact namespace and onto the element —
        and then onto the message FIELD, whose `text` is now the one place the
        banner line lives (see EVENTHEADER_FIELDS). It writes there rather than
        to a flat `message` key, because Load() has already run and would leave
        a second copy nothing reads.

        This is the SETTINGS half only. The caller owns the State store and does
        the matching unset, because the dependency runs state → settings and
        must not be made to run both ways for one migration. Returns True when
        the state key is now redundant and can be dropped — including when the
        producer has already set a message here, since in that case theirs wins
        and the old copy is what would go stale.
        """
        message = (message or "").strip()
        if not message:
            return False
        ns = cls.settings.setdefault("overlays", {}).setdefault("eventheader", {})
        _eventheader_bands(ns)  # the entry has to exist before it can be filled
        entry = next(
            (e for band in ns["bands"].values() for e in band if e.get("id") == "message"),
            None,
        )
        if entry is None or entry.get("text"):
            return True
        entry["text"] = message
        await cls.Save()
        logger.info("[Settings] adopted tournamentInfo.message as the Event Header's message field")
        return True

    @classmethod
    async def _notify(cls, keys) -> None:
        for watcher in cls.watchers:
            try:
                await watcher(list(keys))
            except Exception:
                logger.exception("settings watcher errored")

    @classmethod
    async def Set(cls, key: str, value, session_id: str | None = None):
        deep_set(cls.settings, key, value)
        cls.revision += 1
        await asyncio.gather(
            socketio.emit('v1.settings.set', {
                "key": key,
                "value": redact_value(key, value),
                "sid": session_id
            }),
            cls.Save()
        )
        if cls.watchers:
            await cls._notify([key])

    @classmethod
    async def Unset(cls, key: str, session_id: str | None = None):
        deep_unset(cls.settings, key)
        cls.revision += 1
        await asyncio.gather(
            socketio.emit('v1.settings.unset', {
                "key": key,
                "sid": session_id
            }),
            cls.Save()
        )
        if cls.watchers:
            await cls._notify([key])

    @classmethod
    async def ApplyBatch(cls, sets, unsets=(), session_id: str | None = None):
        """Apply many settings writes as ONE commit.

        A design LOOK touches every global design key and every per-element
        style pin in the show — easily a hundred keys — and applied through
        `Set` that was a hundred `settings.json` rewrites in a row, with every
        overlay repainting between each one, so a look arrived on air in pieces.
        Here the dict is mutated first and written once.

        Consumers still receive ordinary per-key `v1.settings.set` / `unset`
        frames: every overlay and the app already handle those, and a new frame
        type would be a new thing for twenty consumers to get wrong. They land
        in one burst, and both runtimes coalesce a burst into one repaint (the
        app's rAF flush, OverlayBase's serialized render).

        `sets` is an iterable of (key, value); `unsets` of keys. Unsets run
        first, so a batch can clear a namespace and repopulate part of it.
        """
        sets = [(k, v) for k, v in sets if k]
        unsets = [k for k in unsets if k]
        if not sets and not unsets:
            return
        for key in unsets:
            deep_unset(cls.settings, key)
        for key, value in sets:
            deep_set(cls.settings, key, value)
        cls.revision += 1
        emits = [
            socketio.emit('v1.settings.unset', {"key": key, "sid": session_id})
            for key in unsets
        ] + [
            socketio.emit('v1.settings.set', {
                "key": key,
                "value": redact_value(key, value),
                "sid": session_id,
            })
            for key, value in sets
        ]
        await asyncio.gather(*emits, cls.Save())
        if cls.watchers:
            await cls._notify([*unsets, *(k for k, _ in sets)])

    @classmethod
    def Get(cls, key: str, default=None):
        return deep_get(cls.settings, key, default)

class Config:
    config = {
        "name": "ProjectRioStreamHelper",
        # Last-resort only: reached when neither pyproject nor a frozen
        # _version.py is readable. Says "unidentified build" rather than
        # naming a release that shipped years ago — the same hardcoded 1.0.0
        # that made the macOS bundle misreport itself for the whole of 2.x.
        # Matches FALLBACK_VERSION in scripts/freeze-version.py.
        "version": "0.0.0-dev",
        "description": "Tournament scoreboard helper and overlays for Mario Superstar Baseball via Project Rio",
        "authors": [],
        "server_url": "",
        # gc-overlay runs on every platform PRSH does as of gc-overlay 1.1.0
        # (two peer transports; see controller_overlay.py). Kept as a constant
        # so an older frontend build still reads a truthy value.
        "controller_overlay_supported": True,
    }

    @classmethod
    async def Load(cls) -> dict:
        # Name, description and authors follow the SAME chain as the version
        # (pyproject in a checkout, the frozen _version.py in a packaged
        # build) — see scripts/freeze-version.py. This used to read
        # pyproject.toml directly, which a frozen app has no copy of, so every
        # release served the defaults below and reported `"authors": []`.
        # Whatever the chain can't answer is simply left at its default.
        for key, value in (await asyncio.to_thread(_resolve_metadata)).items():
            if key in cls.config and value:
                cls.config[key] = value

        cls.config["version"] = await asyncio.to_thread(_resolve_version)
        return cls.config
    
    @classmethod
    async def SetServerURL(cls, url: str):
        cls.config["server_url"] = url
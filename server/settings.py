import asyncio
import copy
import importlib.util
import platform
import sys
import tomllib
import orjson
from pathlib import Path

from aiopath import AsyncPath
from loguru import logger
from server import socketio
from server.paths import app_root, user_data_dir
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
EVENTHEADER_FIELDS = {
    "header": [("competition", "showCompetition"), ("location", "showLocation"),
               ("dates", "showDates")],
    "footer": [("message", "showMessage"), ("event", "showEvent"),
               ("phase", "showPhase"), ("round", "showRound")],
}


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


def _resolve_version() -> str:
    """Resolve app version via scripts/freeze-version.py.

    Used by Config.Load(). The freeze-version module lives outside the
    `server` package because it has to be runnable as a standalone build
    script too (Vite prebuild, PyInstaller hook, CI checks). We import it
    by file path so the import works in dev *and* in PyInstaller bundles
    where the layout is flattened.
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
# Only maps with a non-empty seed are listed. `production.overrides`,
# `scoreboards.aliases` and friends are producer-owned in the same sense, but
# their default is `{}` — merging nothing under a loaded map is a no-op, so
# listing them would assert intent without changing behavior.
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
            "profanity_filter": True,
            "disable_autoupdate": False,
            "disable_overwrite": False
        },
        "hotkeys": {
            "load_set": None,
            "team1_score_up": None,
            "team1_score_down": None,
            "team2_score_up": None,
            "team2_score_down": None,
            "reset_scores": None,
            "swap_teams": None
        },
        "project_rio": {
            "hud_path": "",
            # When True, board 1 carries the local HUD transport (the local Rio
            # game auto-fills scoreboard 1). When False, board 1 behaves like any
            # API board. This is the single control for "is board 1 the HUD board"
            # — there is no per-board source selector. Toggled beside the HUD path.
            "hud_enabled": True,
            "pinned_player": "",
            "pinned_side": "Team 1",
            "pinned_hud_only": False
        },
        "postgame": {
            # Capture a finished game's box score as soon as Project Rio writes
            # its stat file, instead of waiting for the producer to press
            # Capture. The file landing IS the end-of-game signal for a local
            # board — see server/postgame_watch.py. Off leaves capture manual;
            # the button is on every board panel either way.
            "auto_capture": True,
        },
        "scoreboards": {
            "active": [1],
            "aliases": {},
            # Per-scoreboard binding: pool (membership: filters/scope/pinned/
            # excluded) + playback (mode/gameId/interval) + stats_tag.
            # Created/migrated in Load(); see server/bindings.py for the model
            # and ~/.claude/plans/pool-playback-unification.md for the design.
            # `sources` and `rotation` are retained read-only for one release
            # as migration fallbacks and are no longer written.
            "sources": {
                "1": {"type": "manual", "api_game_id": None}
            },
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
            "auto_connect": True
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
            # SEEDED, NOT DEFAULTED. This map is in `_USER_OWNED_MAPS`, so it
            # is written once into a settings file that lacks the key and is
            # never merged over again: a container the producer deletes stays
            # deleted, and one they edit keeps their fields rather than having
            # the seed's grafted back. Adding an entry here therefore reaches
            # new installs only; a settings file that already has this key needs
            # a one-time migration in Load() to pick it up.
            #
            # These three are seeded so a fresh install has the containers the
            # app already shipped with. Both non-full-canvas ones were sized
            # smaller than the element they host and worked only because those
            # two mounts happen to reflow — seeded here at their member's real
            # native size (stats-feed 325x120 -> 452x118, split-screen
            # 960x1080 -> 1280x720) rather than grandfathered.
            "container_defs": {
                "callout-stage": {
                    "name": "Callout Stage",
                    "width": 1920,
                    "height": 1080,
                    "members": ["postgamecallout", "postgamevs"],
                },
                # 325x120 is the FED stats bar's native size (stats-mount.js
                # REF_W/REF_H). The standalone stats.html card is 452x118 and is
                # a different layout entirely — seeding that number gave this
                # container a size its only member did not fit (120 > 118), which
                # `fitsContainer` would have filtered out of its own member
                # picker. containers.test.jsx pins the pair now.
                "stats-feed": {
                    "name": "Stats Bar",
                    "width": 325,
                    "height": 120,
                    "members": ["stats"],
                },
                # The hit visualizer is both: it owns a dedicated source AND can
                # occupy a container, which is why a roster is a list of members
                # rather than a list of fed elements.
                "split-screen": {
                    "name": "Split-Screen",
                    "width": 1280,
                    "height": 720,
                    "members": ["hitvisualizer"],
                },
                # The mirrored pair that REPLACED the Roster + Stats element:
                # one container per side, each resting on that side's roster,
                # each able to flash that side's stat card over it. 452x240 was
                # that element's own stage — the roster (452x140) centers inside
                # it, and the card (380x240) fills its height now that it carries
                # two optional caption bands.
                #
                # Seeded because they are a MIGRATION, not a new feature: the
                # element they replace is gone, so a producer replaces two
                # browser-source URLs and gets what they had — which is only
                # true if the FLIP comes with them. The two rules that do it are
                # seeded below, in `automations`.
                #
                # Scope is board 1 / left and board 1 / right. A rig running
                # more boards re-points the Board picker on each container's
                # stage; there is no seeding a pair per board without inventing
                # a show structure nobody asked for.
                "roster-stats-1": {
                    "name": "Roster + Stats — Left",
                    "width": 452,
                    "height": 240,
                    "members": ["roster", "statscard"],
                    "resting": "roster",
                    "scope": {"scoreboard": 1, "team": 1},
                },
                "roster-stats-2": {
                    "name": "Roster + Stats — Right",
                    "width": 452,
                    "height": 240,
                    "members": ["roster", "statscard"],
                    "resting": "roster",
                    "scope": {"scoreboard": 1, "team": 2},
                },
            },
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
            # live with the console, src/routes/production/automations.js — the
            # engine only interprets rules). The rule id is
            # `{container}:{template}`, which is `ruleIdFor` over there: two
            # containers running one canned rule is exactly how the mirrored pair
            # below is built, so the container has to be part of the id.
            #
            # Only the pair is seeded, and only because it is a MIGRATION. The
            # flip WAS the Roster + Stats element — that element is deleted, so
            # shipping its containers without its rule would hand a producer two
            # sources that rest on a roster and never flash, which is a worse
            # version of what they had. Everything else in the library stays
            # opt-in. A rule that misbehaves on air is suspended with the switch
            # on its container's stage panel, and either disposal survives a
            # restart: this map is in `_USER_OWNED_MAPS` alongside the container
            # defs above, so `enabled: false` persists as a value and a DELETED
            # rule stays deleted rather than being merged back from here.
            "automations": {
                "roster-stats-1:batter-card": {
                    "enabled": True,
                    "template": "batter-card",
                    "name": "Batter change → stat card",
                    "container": "roster-stats-1",
                    "member": "statscard",
                    "trigger": "score.{sb}.batter",
                    "guard": "content",
                    "dwell": 7,
                },
                # Same rule, other scope. `{sb}` and the SIDE both resolve from
                # the container, which is why the mirror is one rule twice and
                # not two rules: side 1 shows the batter while it is batting,
                # side 2 shows the pitcher it is facing.
                "roster-stats-2:batter-card": {
                    "enabled": True,
                    "template": "batter-card",
                    "name": "Batter change → stat card",
                    "container": "roster-stats-2",
                    "member": "statscard",
                    "trigger": "score.{sb}.batter",
                    "guard": "content",
                    "dwell": 7,
                },
            },
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
            }
        },
        "announcements": {
            "dismissed_ids": [],
            "check_for_updates": True,
        },
        "controller_overlay": {
            "path": "",
            "port": 8069,
            "controller": 1,
            "auto_start": False
        },
        "overlays": {
            "schema_version": 4,
            "global": {
                "accentColor": "#f59e0b",
                "cardBg": "rgba(15, 15, 25, 0.88)",
                "textColor": "#ffffff",
                "borderRadius": 16,
                "borderWidth": 1,
                "borderColor": "rgba(255, 255, 255, 0.08)",
                "fontFamily": "Inter",
                "showShadow": True,
                "cardShadowBlur": 16,
                "cardShadowColor": "rgba(0, 0, 0, 0.5)",
                "textShadowEnabled": False,
                "textShadowBlur": 4,
                "textShadowColor": "rgba(0, 0, 0, 0.8)",
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
                # ELO off: a one-game rating swing is a season-play number, and
                # it was taking the two widest thirds of the completed-game row
                # at every tournament and league broadcast to say it. Producers
                # running ranked ladder play turn it on.
                "showElo": False,
                "showTeamLogos": True,
                "showGameMode": True,
            },
            "roster": {
                "showSuperstars": True,
                "showRoleIcon": True,
                "showTeamLogo": True,
            },
            "stats": {
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
        file_existed = False
        try:
            async with cls._settings_file().open(mode='rb', encoding='utf-8') as f:
                loaded = await asyncio.to_thread(
                    orjson.loads,
                    await f.read()
                )
                file_existed = isinstance(loaded, dict)
                loaded_server = (loaded.get("server") or {}) if isinstance(loaded, dict) else {}
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

        # Container membership moved ONTO the container. It used to live per
        # element (`production.containers.{elementId}` -> container id) with the
        # element's own layout stem as the implicit default; it is now the
        # roster on `production.container_defs.{id}`. Two places storing one
        # relationship is how these drift, so the old key is dropped rather than
        # translated — 2.0.0 has never shipped, and the seeded defs above
        # reproduce every pairing the defaults ever had.
        production = cls.settings.setdefault("production", {})
        if "containers" in production:
            production.pop("containers", None)
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
        if _eventheader_bands(
            cls.settings.setdefault("overlays", {}).setdefault("eventheader", {})
        ):
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

    @classmethod
    def Get(cls, key: str, default=None):
        return deep_get(cls.settings, key, default)

class Config:
    config = {
        "name": "ProjectRioStreamHelper",
        "version": "1.0.0",
        "description": "Tournament scoreboard helper and overlays for Mario Superstar Baseball via Project Rio",
        "authors": [],
        "server_url": "",
        # gc-overlay (controller input display) only works on macOS. The
        # frontend reads this to hide the feature's UI elsewhere; the build
        # only bundles gc-overlay in macOS builds. See controller_overlay.py.
        "controller_overlay_supported": platform.system() == "Darwin",
    }

    @classmethod
    async def Load(cls) -> dict:
        # Read non-version metadata from pyproject.toml (name, description,
        # authors). Version is resolved separately via scripts/freeze-version.py
        # so it stays anchored to the git tag (or the frozen _version.py
        # generated at build time) rather than a hand-edited file. See
        # scripts/freeze-version.py for the resolution chain.
        try:
            text = await asyncio.to_thread(
                (app_root() / 'pyproject.toml').read_text, encoding='utf-8'
            )
            context = tomllib.loads(text)["tool"]["poetry"]
            cls.config["name"] = context["name"]
            cls.config["description"] = context["description"]
            cls.config["authors"] = context["authors"]
        except Exception:
            pass  # frozen build or missing file; hardcoded defaults used

        cls.config["version"] = await asyncio.to_thread(_resolve_version)
        return cls.config
    
    @classmethod
    async def SetServerURL(cls, url: str):
        cls.config["server_url"] = url
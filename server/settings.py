import asyncio
import copy
import orjson

from aiopath import AsyncPath
from loguru import logger
from server import socketio
from server.paths import user_data_dir
from server.settings_migrations import _eventheader_bands, run_migrations
from server.utils import json
from server.utils.deep_dict import deep_set, deep_unset, deep_get
from server.version import FALLBACK_VERSION, resolve_metadata, resolve_version


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
# in server/settings_migrations.py, which can seed a single id without
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
        """Read settings.json over the defaults, then migrate and heal it.

        Every migration lives in server/settings_migrations.py. They are handed
        the file as it was BEFORE the merge too, because afterwards a default
        is indistinguishable from a value the producer set to the same thing.
        """
        loaded: dict | None = None
        try:
            async with cls._settings_file().open(mode='rb', encoding='utf-8') as f:
                raw = await asyncio.to_thread(orjson.loads, await f.read())
            if isinstance(raw, dict):
                loaded = raw
                cls.settings = _deep_merge(cls.settings, raw)
        except Exception:
            logger.debug("using default settings dict")

        if run_migrations(cls.settings, loaded):
            await cls.Save()

    @classmethod
    async def adopt_eventheader_message(cls, message: str) -> bool:
        """Take the Event Header's banner line over from ``tournamentInfo.message``.

        The message is the one field on that overlay no other surface reads, so
        it moved out of the shared event-fact namespace and onto the element —
        and then onto the message FIELD, whose `text` is now the one place the
        banner line lives (see EVENTHEADER_FIELDS, server/settings_migrations.py). It writes there rather than
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
        "version": FALLBACK_VERSION,
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
        # build) — see server/version.py. This used to read
        # pyproject.toml directly, which a frozen app has no copy of, so every
        # release served the defaults below and reported `"authors": []`.
        # Whatever the chain can't answer is simply left at its default.
        for key, value in (await asyncio.to_thread(resolve_metadata)).items():
            if key in cls.config and value:
                cls.config[key] = value

        cls.config["version"] = await asyncio.to_thread(resolve_version)
        return cls.config
    
    @classmethod
    async def SetServerURL(cls, url: str):
        cls.config["server_url"] = url
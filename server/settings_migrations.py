"""Everything `Settings.Load` does to a settings dict after merging defaults.

One-time migrations (each gated on its own flag or on the shape it migrates
from) and every-boot heals, run in a fixed order by `run_migrations`. A new
migration is a function here and an entry in `MIGRATIONS` — never a block
inside `Load`.
"""
import copy

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

# ── The migrations Load runs, in order ──
#
# Each takes the merged settings dict and the file as it was BEFORE the merge
# (`loaded`, None when there was no readable file) and returns True if it
# changed anything. The pre-merge file matters to more than one of them: once
# `_deep_merge` has run, a default is indistinguishable from a value the
# producer set to the same thing, so "did the producer write this?" can only be
# asked of `loaded`.
#
# ORDER IS PART OF THE CONTRACT. The binding v1 → v2 pair runs in sequence in
# one boot; the board-1 heal needs the v2 shape; `_drop_retired` goes last
# because it drops the 1.x config the binding migration reads.


def _pre(loaded: dict | None, key: str) -> dict:
    value = (loaded or {}).get(key)
    return value if isinstance(value, dict) else {}


def _server_host_to_allow_lan(settings: dict, loaded: dict | None) -> bool:
    """Migrate legacy `server.host` to `server.allow_lan`. Prior versions
    defaulted host to "0.0.0.0"; on upgrade preserve LAN access for users who
    already had it. New installs ship loopback-only."""
    loaded_server = _pre(loaded, "server")
    if "host" in loaded_server and "allow_lan" not in loaded_server:
        legacy_host = loaded_server.get("host")
        if legacy_host and legacy_host not in ("127.0.0.1", "localhost", "::1"):
            settings["server"]["allow_lan"] = True
    settings.get("server", {}).pop("host", None)
    return "host" in loaded_server


def _stats_to_statsbar(settings: dict, loaded: dict | None) -> bool:
    """`overlays.stats` -> `overlays.statsbar`.

    The element was renamed when the wide bar and the 2x2 card stopped sharing
    the ambiguous name "Stats": the bar is `statsbar` (its own ?team= source,
    statsbar.svg) and the card stays `statscard`. The namespace is the
    producer's authored look — accent, card background, shadows — so it MOVES
    rather than resetting to defaults. Merge-under, never overwrite: a producer
    who has already configured the new key wins, which also makes this
    idempotent across restarts.
    """
    overlays = settings.get("overlays")
    if not (isinstance(overlays, dict) and isinstance(overlays.get("stats"), dict)):
        return False
    legacy_stats = overlays.pop("stats")
    current = overlays.get("statsbar")
    overlays["statsbar"] = {**legacy_stats, **(current if isinstance(current, dict) else {})}
    return True


def _controller_overlay_block(settings: dict, loaded: dict | None) -> bool:
    """`controller_overlay.display` goes; `controller_overlay.port` becomes a record.

    gc-overlay's appearance briefly had an app-wide copy at `display`, with
    per-element three-state pins over it. The second layer bought nothing: a
    pin beats the global, so the moment an element was touched the global
    stopped reaching it — invisibly, from a tab that could not show why.
    `overlays.controller.*` is shared by both sides already, so one layer is
    app-wide for every controller source anyway. Dropped rather than merged
    down: it never shipped, and a stale block in a namespace the producer can
    read is one they will one day try to use.

    `port` is no longer a setting (gc-overlay sits behind PRSH's /gc/ proxy and
    picks its own port), but it is still a RECORD: the port every pre-proxy
    Controller source in OBS was built against. Kept as `legacy_port` so the
    console can recognise exactly those sources and the address repair can move
    them onto /gc/.
    """
    co = settings.get("controller_overlay")
    if not isinstance(co, dict):
        return False
    changed = False
    if "display" in co:
        co.pop("display", None)
        changed = True
    if "port" in co:
        co["legacy_port"] = co.pop("port")
        changed = True
    return changed


def _controller_pins(settings: dict, loaded: dict | None) -> bool:
    """The controller element's own pins, from the same 1.4.0 change.

    `overlays.controller.idleFill` was a three-state select while the setting
    was a switch; nothing reads it now, and a dead key in a namespace the
    producer can see is a key they will one day try to use.

    `idleFillOpacity` is CLAMPED rather than reinterpreted. Out-of-range values
    got here one way — a percentage typed into a 0..1 number field, which is
    exactly why that control is a slider now — but 10 could mean "10%" or "as
    solid as it goes", and the mount already clamps, so storing what is
    actually being drawn is the reading that changes nothing on air.
    """
    pins = settings.get("overlays", {}).get("controller")
    if not isinstance(pins, dict):
        return False
    dirty = pins.pop("idleFill", None) is not None

    # `labels`/`keyline` were three-state selects while there was an app-wide
    # layer to inherit from: 'inherit' | 'shown' | 'hidden'. They are plain
    # booleans now, and leaving the strings would be SILENT and backwards —
    # every one of them is truthy, so a producer who had switched the letters
    # off would find them back on with the switch reading On, and the mount's
    # `typeof === 'boolean'` guard would quietly substitute the default.
    for key in ("labels", "keyline"):
        v = pins.get(key)
        if isinstance(v, str):
            if v == "inherit":
                # Inherited the app-wide value, which is gone. The default is
                # what it resolved to for anyone who never touched that tab,
                # and is gc-overlay's own.
                pins.pop(key)
            else:
                pins[key] = v == "shown"
            dirty = True

    opacity = pins.get("idleFillOpacity")
    if isinstance(opacity, (int, float)) and not 0.0 <= opacity <= 1.0:
        pins["idleFillOpacity"] = min(1.0, max(0.0, float(opacity)))
        dirty = True
    return dirty


def _active_look_to_preset(settings: dict, loaded: dict | None) -> bool:
    """Design "Looks" were renamed Presets (2026-09-18). The saved designs
    always lived at `overlays.presets.*`; only the pointer to the applied one
    carried the old word."""
    ov = settings.get("overlays")
    if not (isinstance(ov, dict) and "active_look" in ov):
        return False
    ov.setdefault("active_preset", ov.get("active_look"))
    ov.pop("active_look", None)
    return True


def _overlay_schema_v2(settings: dict, loaded: dict | None) -> bool:
    """Keys that were previously duplicated as per-layout overrides
    (showCaptains, showLogo, etc.) have been promoted to globals. Strip stale
    per-layout copies so the global value is the single source of truth.
    Layout-specific fields (statValueColor, etc.) are preserved."""
    overlays = settings.get("overlays", {})
    if overlays.get("schema_version", 1) >= 2:
        return False
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
    return True


def _overlay_schema_v3(settings: dict, loaded: dict | None) -> bool:
    """ELO's default flipped to off (it is a season-play number, and it was
    holding the widest thirds of the completed-game row at every tournament
    broadcast). The seeded `true` has to be CLEARED, not left, or the new
    default never reaches anyone who already ran the app.

    Only the un-scoped leaf, which is the one the seed writes. A per-board pin
    (overlays.scoreboard.{N}.showElo) is nothing but an explicit choice —
    nothing seeds those — so those are left exactly as found.
    """
    overlays = settings.get("overlays", {})
    if overlays.get("schema_version", 1) >= 3:
        return False
    sb_overlays = overlays.get("scoreboard")
    if isinstance(sb_overlays, dict) and sb_overlays.get("showElo") is True:
        sb_overlays.pop("showElo", None)
    overlays["schema_version"] = 3
    return True


def _overlay_schema_v4(settings: dict, loaded: dict | None) -> bool:
    """The controller-port palette was promoted to a global.

    It was read per layout (overlays.{type}.port{N}Color) by five mounts but had
    a UI on exactly one of them — the Character Spotlight — so a producer who
    recoloured port 1 there watched the scoreboard, scorecard and lower third
    keep the old red. It is one palette: a port is a player's identity across
    the whole broadcast, so it lives on the Design tab next to the design
    package that can now declare its own (see design_packages._port_colors).

    The spotlight's copy wins, being the only one anything ever wrote; a
    hand-edited settings.json with a colour only under some other namespace
    still carries it up rather than losing it.
    """
    overlays = settings.get("overlays", {})
    if overlays.get("schema_version", 1) >= 4:
        return False
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
    return True


def _overlay_schema_v5(settings: dict, loaded: dict | None) -> bool:
    """`fontFamily` became three TYPE ROLES — displayFont / bodyFont / monoFont.

    The old key named one face for the whole broadcast but only ever reached
    the four DOM-rendered elements (Event Header, Player Name, and the two
    post-game callouts); every theme SVG paints from the token layer's three
    roles and cleared the app font outright. So a producer who set it watched
    four elements change typeface and the other fourteen ignore them.

    A STORED VALUE GOES ONTO ALL THREE, not onto the role it most resembles.
    Whatever it was, it is what those elements were ALREADY drawing in, and the
    migration's job is that nothing on air moves: a producer who set "Bebas
    Neue" wanted Bebas Neue, and spreading it across the roles is the only
    reading under which their broadcast looks tomorrow the way it looked today.
    They can then pull the roles apart, which is the point of the feature. The
    DEFAULT is not carried up — an unset `fontFamily` (or the seeded "Inter") is
    the absence of a choice, and treating it as one would pin Inter over the
    token layer's Rajdhani and Chivo Mono for everyone who never opened the
    Design tab.

    Per-element pins migrate the same way, under the same namespace, so an
    element carrying its own font keeps carrying it.
    """
    overlays = settings.get("overlays", {})
    if overlays.get("schema_version", 1) >= 5:
        return False
    # Defaults are merged into `settings` BEFORE migrations run, so the global
    # namespace already carries the three seeded faces by the time this fires
    # and `setdefault` would silently do nothing on the one namespace that
    # matters. The pre-merge file is the only place a role the producer
    # actually wrote can be told from a seeded one.
    loaded_overlays = _pre(loaded, "overlays")
    roles = ("displayFont", "bodyFont", "monoFont")

    def split_roles(ns: dict, was: dict) -> None:
        chosen = ns.pop("fontFamily", None)
        if chosen and chosen != "Inter":
            for role in roles:
                if role not in was:
                    ns[role] = chosen
        # A per-BOARD pin nests one level further (overlays.scorecard.
        # {N}.fontFamily), which is the shape the scorecard stores under.
        for key, sub in ns.items():
            if isinstance(sub, dict):
                split_roles(sub, was.get(key) or {})

    for name, ns in overlays.items():
        if name in ("presets", "schema_version") or not isinstance(ns, dict):
            continue
        split_roles(ns, loaded_overlays.get(name) or {})
    overlays["schema_version"] = 5
    return True


def _container_membership(settings: dict, loaded: dict | None) -> bool:
    """Container membership moved ONTO the container, and the seeded ones go.

    It used to live per element (`production.containers.{elementId}` ->
    container id) with the element's own layout stem as the implicit default;
    it is now the roster on `production.container_defs.{id}`. Two places
    storing one relationship is how these drift, so the old key is dropped
    rather than translated — 2.0.0 had never shipped.
    """
    production = settings.setdefault("production", {})
    changed = production.pop("containers", None) is not None
    return _retire_seeded_containers(production) or changed


def _drop_rosterstats(settings: dict, loaded: dict | None) -> bool:
    """The combined Roster + Stats element is gone.

    A container resting on a roster with a batter-change rule over it IS that
    element, built from parts, so its settings namespace has nothing left that
    reads it. Its look now lives under the two namespaces the parts already had
    — overlays.roster.* and overlays.statscard.* — and there is no honest way
    to translate a third copy into either: the producer configured them apart
    on purpose, and picking a winner would silently repaint a card they had
    already themed.
    """
    return settings.get("overlays", {}).pop("rosterstats", None) is not None


def _eventheader_and_stroke(settings: dict, loaded: dict | None) -> bool:
    """The Event Header's bands (migrate once, heal every boot), its type size,
    and the font border's opacity across every overlay namespace."""
    ns = settings.setdefault("overlays", {}).setdefault("eventheader", {})
    # Not short-circuited: `or` would skip a later step whenever an earlier one
    # reported a change.
    changed = _eventheader_bands(ns)
    changed = _eventheader_font_px(ns) or changed
    return _adopt_opaque_stroke(settings.get("overlays", {})) or changed


def _binding_v1(settings: dict, loaded: dict | None) -> bool:
    """Unify the per-scoreboard source-type enum (manual | hud | live_game) +
    orthogonal rotation feed into a single `scoreboards.binding.{N}` model.
    Presence of `binding` is the flag, so this runs exactly once. See
    server/bindings.py."""
    scoreboards = settings.setdefault("scoreboards", {})
    if "binding" in scoreboards:
        return False
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
            # A manual board with a running feed becomes a set binding; the
            # rotation.{N} runtime (game_ids/cached_games) is left in place for
            # the v2 migration below to read.
            binding[key] = {"kind": "set", "gameId": None,
                            "pool": rot.get("source_pool", "both"),
                            "stats_tag": stats_tag}
        else:
            binding[key] = {"kind": "single", "gameId": None,
                            "pool": "both", "stats_tag": stats_tag}

    scoreboards["binding"] = binding

    # HUD is now a global transport switch that defaults ON — board 1
    # auto-fills from the local Project Rio game whenever one is present. An
    # API-only / no-Rio user just sees an empty (editable) board 1, so
    # defaulting on is harmless and matches the common case. Only write it when
    # the user hasn't already made an explicit choice (key absent from their
    # file) so a deliberate off survives upgrades.
    if "hud_enabled" not in _pre(loaded, "project_rio"):
        settings.setdefault("project_rio", {})["hud_enabled"] = True
    return True


def _binding_v2(settings: dict, loaded: dict | None) -> bool:
    """Collapse each binding's flat `kind`/`gameId`/`pool` (single|set) into
    `pool` (filters/scope/pinned/excluded) + `playback` (mode/gameId/interval).

    Gated on `binding_schema` so it runs exactly once, whether the v1 migration
    above just ran in this same boot or in a prior session.
    `scoreboards.rotation.{N}` is read here (for interval/current_index/
    game_ids/filters) and then dropped by `_drop_retired`.
    """
    scoreboards = settings.setdefault("scoreboards", {})
    if scoreboards.get("binding_schema", 1) >= 2:
        return False
    binding = scoreboards.setdefault("binding", {})
    rotation = scoreboards.get("rotation", {}) or {}

    for key, b in list(binding.items()):
        if not isinstance(b, dict) or "playback" in b:
            continue  # already v2-shaped (defensive; shouldn't happen)

        kind = b.get("kind", "single")
        stats_tag = b.get("stats_tag")
        rot = rotation.get(key) if isinstance(rotation.get(key), dict) else {}

        if kind == "set":
            # The old model was fundamentally manual-curation: whatever the
            # user had selected becomes `pinned` so nobody's existing rotation
            # silently starts growing/shrinking after upgrade. The old filters
            # (if any) carry over as a single filter chip, but auto-poll's
            # additive-only semantics do NOT — the new pool recompute adds *and*
            # removes, so carrying old filters straight into continuous
            # membership would change what's on-screen without the user asking.
            # The chip is present but inert until the user re-saves it.
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
                # Static: old auto-poll was additive-only, this pool model adds
                # *and* removes — don't silently change what's on-screen for an
                # existing rotation.
                "refresh_interval": 0,
            }
            playback = {
                "mode": "rotate",
                "gameId": None,
                "interval": rot.get("interval", 30),
                "current_index": rot.get("current_index", 0),
                # Carry the legacy "was this rotation actively cycling" signal
                # forward so a rotation that was running at upgrade time resumes
                # on next launch instead of silently landing paused (`running`
                # defaults False).
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
    return True


def _heal_board_1(settings: dict, loaded: dict | None) -> bool:
    """BOARD 1 ALWAYS EXISTS: a layout with no `?scoreboard=` reads it, and it
    is the only board the HUD can feed. `remove_scoreboard` refuses it now, but
    an install that removed it before that guard is healed here. The binding is
    only seeded when absent; the others' ids are untouched."""
    scoreboards = settings.setdefault("scoreboards", {})
    active = scoreboards.get("active")
    if not (isinstance(active, list) and 1 not in active):
        return False
    from server.bindings import DEFAULT_BINDING  # bindings imports settings
    scoreboards["active"] = sorted([1, *active])
    scoreboards.setdefault("binding", {}).setdefault("1", copy.deepcopy(DEFAULT_BINDING))
    return True


def _retired(settings: dict, loaded: dict | None) -> bool:
    return _drop_retired(settings)


MIGRATIONS = (
    _server_host_to_allow_lan,
    _stats_to_statsbar,
    _controller_overlay_block,
    _controller_pins,
    _active_look_to_preset,
    _overlay_schema_v2,
    _overlay_schema_v3,
    _overlay_schema_v4,
    _overlay_schema_v5,
    _container_membership,
    _drop_rosterstats,
    _eventheader_and_stroke,
    _binding_v1,
    _binding_v2,
    _heal_board_1,
    _retired,
)


def run_migrations(settings: dict, loaded: dict | None) -> bool:
    """Run every migration in order over the merged `settings`. True if any
    changed something, so the caller writes the file once."""
    changed = False
    for migrate in MIGRATIONS:
        # Never short-circuit: every migration runs on every boot.
        changed = migrate(settings, loaded) or changed
    return changed

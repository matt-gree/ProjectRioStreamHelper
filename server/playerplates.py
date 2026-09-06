"""Player Plates element — the two-player name/sub-plate band.

A sibling of the Commentary desk (``server/commentary.py``): its own object
(``playerplates.*`` in State), a **resolve-by-copy** projector, and the same
plate + sub-plate convention. Where Commentary is a variable-count caster row,
Player Plates is a fixed *two-player* band.

**Each plate is shown by its own ``visible`` flag and nothing else** — the same
per-slot switch Commentary uses. There was also a band-wide ``mode``
(``both | p1 | p2``) saying which plates were included, which is the very same
fact twice: hiding side 2 and picking ``p1`` put the identical picture on air,
and the two could contradict each other (``p1`` with side 1 hidden drew nothing,
and the authoring panel dropped the excluded side's block, stranding its eye).
A legacy ``mode`` is folded onto the flags once, in ``normalize_config``, and
then forgotten. What the mode still decided on its own is now read off the flags:

- both plates shown — the pair takes OPPOSITE anchors, side 1 at its own
  ``location`` (coerced to left|right) and side 2 at the other one. Derived from
  side 1 alone so the two can never collide on one anchor, whatever is stored.
  This is how the plates get swapped: put side 1 on the right and side 2 follows.
- one plate shown — it sits at its own ``location`` (left | center | right), the
  middle one being reachable only here, since a pair has no room for it.

The anchoring follows the flags, not the *resolved* plates: a plate whose
partner is on but nameless stays at its pinned anchor rather than sliding to the
lone plate's position mid-broadcast.

Each plate's content comes from one of two SOURCES, and **both resolve against
the address book** — the source says only where the PERSON comes from:

- ``match``  — the bound ``match.{M}`` fixture's side names the participant.
  Re-projects when the match changes and at startup, exactly like the
  Match/Commentary projectors.
- ``manual`` — the producer picks the participant directly (``participantId``),
  the same pick a Commentary slot takes. A raw typed ``name`` is the escape
  hatch for someone not in the book (``ParticipantPicker``'s "use without
  saving"), and it is the ONE case with nothing to resolve — so it is also the
  one case that carries a typed ``subLabel``/``subValue`` instead of a
  ``subField``. The sub-plate offers what the name can resolve.

Resolving a manual plate through the registry is what puts it in
``Participants.reproject_dependents()``'s blast radius: a mid-broadcast name or
pronoun fix in the Address Book now re-flows onto a manual plate, which typed
text could never do.

The authored config lives at ``playerplates.config``; the projector writes the
display-only per-side keys the overlay reads (``playerplates.{1,2}.*``). The
participant registry stays OUT of the broadcast — only the resolved name +
chosen field value go on the wire (same contract as Commentary). Placement is
fully resolved here: each side's projected ``location`` and ``active`` already
fold in what the other side is doing, so the overlay positions purely from
``location`` and shows purely from ``active``.
"""
# Reuse the Commentary sub-plate field vocabulary + resolvers so the two
# elements offer/resolve address-book fields identically (single source of truth).
from server.commentary import SUBFIELD_LABELS, _resolve_name, _resolve_sub
from server.match import Match
from server.participants import Participants
from server.state import State
from server.utils.projection import run_startup_projection

SOURCES = ("match", "manual")
LOCATIONS = ("left", "center", "right")

# Every projected key the projector owns for one side. A projection ALWAYS writes
# the full set (resolved value or blank) so re-projection is deterministic and an
# emptied/inactive side blanks exactly what it set — no stale plate left on air.
_BLANK_SIDE = {
    "name": "",
    "subField": "",
    "subLabel": "",
    "subValue": "",
    "visible": False,
    "subVisible": False,
    "location": "left",
    "active": False,
}


def _norm_location(v, default):
    return v if v in LOCATIONS else default


def _normalize_side(raw, default_location) -> dict:
    """Coerce one authored side into the stored shape (drops unknown subFields)."""
    raw = raw if isinstance(raw, dict) else {}
    sub = raw.get("subField") or ""
    if sub not in SUBFIELD_LABELS:
        sub = ""
    return {
        # A manual plate's person. `name` beside it is the raw escape hatch, used
        # only while no participant is picked (never both).
        "participantId": raw.get("participantId") or None,
        "name": (raw.get("name") or "").strip(),
        "subField": sub,
        "subLabel": (raw.get("subLabel") or "").strip(),
        "subValue": (raw.get("subValue") or "").strip(),
        "visible": bool(raw.get("visible", True)),
        "subVisible": bool(raw.get("subVisible", True)),
        "location": _norm_location(raw.get("location"), default_location),
    }


def _norm_match_id(v):
    if isinstance(v, int):
        return v
    if isinstance(v, str) and v.isdigit():
        return int(v)
    return None


def normalize_config(raw) -> dict:
    """Coerce an authored config payload into the stored shape.

    Also folds a legacy band-wide ``mode`` onto the per-side ``visible`` flags:
    ``p1``/``p2`` excluded the other side, which is what hiding it means now.
    Idempotent, and it runs on the raw stored config on every projection, so a
    config written before the collapse keeps its picture until the next edit
    saves the folded shape.
    """
    raw = raw if isinstance(raw, dict) else {}
    source = raw.get("source")
    if source not in SOURCES:
        source = "match"
    sides = raw.get("sides") or {}
    s1 = _normalize_side(sides.get("1") or sides.get(1), "left")
    s2 = _normalize_side(sides.get("2") or sides.get(2), "right")
    legacy_mode = raw.get("mode")
    if legacy_mode == "p1":
        s2["visible"] = False
    elif legacy_mode == "p2":
        s1["visible"] = False
    return {
        "source": source,
        "matchId": _norm_match_id(raw.get("matchId")),
        "sides": {"1": s1, "2": s2},
    }


class PlayerPlates:
    """Reads/writes ``playerplates.*`` through State and projects the two plates.

    Stateless singleton (mirrors State/Settings/Match/Commentary): all data lives
    in the State store; these classmethods are the projection + lifecycle logic.
    """

    @classmethod
    def config(cls) -> dict:
        c = State.state.get("playerplates", {}) or {}
        cfg = c.get("config")
        return cfg if isinstance(cfg, dict) else {}

    @classmethod
    def _side_person(cls, cfg: dict, t: int) -> tuple[dict | None, str]:
        """(address-book row | None, fallback name) for side ``t``.

        The fallback is the name to show when no row resolves — a fixture's raw
        rioName, or a manual plate's typed escape-hatch name.
        """
        side = cfg["sides"][str(t)]
        if cfg["source"] == "match":
            m = cfg.get("matchId")
            if m is None:
                # No fixture picked: the panel says "No name from match", so the
                # band must agree. It used to fall through to the typed manual
                # fields here, putting a leftover name on air under a source the
                # producer had just pointed away from it.
                return None, ""
            players = Match.get(m).get("player") or {}
            p = players.get(str(t)) or players.get(t) or {}
            rio = Match._participant_rioname(p)
            pid = p.get("participantId")
            row = Participants.Get(pid) if pid else None
            if not row and rio:
                row = Participants.MatchByRioName(rio)
            return row, rio or ""

        pid = side["participantId"]
        return (Participants.Get(pid) if pid else None), side["name"]

    @classmethod
    def _resolve_side(cls, cfg: dict, t: int) -> tuple[str, str, str]:
        """(name, subLabel, subValue) for side ``t`` under the config's source."""
        side = cfg["sides"][str(t)]
        row, fallback = cls._side_person(cfg, t)
        name = _resolve_name(row) or fallback or ""

        # A raw typed manual name has no row behind it, so there is no field to
        # resolve — that plate (and only that plate) carries a typed sub-plate.
        # Keyed on the PICK, not on whether the row resolved: a fixture naming
        # someone who isn't in the book yet must still blank its sub-plate rather
        # than inherit whatever was typed on the band before.
        if cfg["source"] == "manual" and not side["participantId"]:
            return name, side["subLabel"], side["subValue"]

        sub_field = side["subField"]
        if not sub_field:
            return name, "", ""
        return name, SUBFIELD_LABELS.get(sub_field, ""), _resolve_sub(row, sub_field)

    @classmethod
    def _project_entries(cls) -> list[tuple]:
        cfg = normalize_config(cls.config())
        entries: list[tuple] = [("playerplates.source", cfg["source"])]
        # A PAIR takes opposite anchors; a lone plate sits where its side says.
        # Read off the `visible` FLAGS, not off what resolved: a plate whose
        # partner is on but nameless keeps its anchor instead of gliding across
        # mid-air.
        paired = all(cfg["sides"][str(t)]["visible"] for t in (1, 2))
        # Side 1's choice decides the ORDER and side 2 mirrors it — one bit, read
        # off one side, so two stored locations can never sit on one anchor (a
        # lone plate parked at `center` and then re-paired is the ordinary way
        # that happens). `location` carries this; there is no separate swap flag
        # to disagree with it.
        pair_anchor = {1: "left", 2: "right"}
        if cfg["sides"]["1"]["location"] == "right":
            pair_anchor = {1: "right", 2: "left"}
        for t in (1, 2):
            base = f"playerplates.{t}"
            side = cfg["sides"][str(t)]
            name, sub_label, sub_value = cls._resolve_side(cfg, t)
            vals = dict(_BLANK_SIDE)
            vals["name"] = name
            vals["subField"] = side["subField"]
            vals["subLabel"] = sub_label
            vals["subValue"] = sub_value
            vals["visible"] = bool(side["visible"])
            vals["subVisible"] = bool(side["subVisible"])
            # Resolved here so the overlay positions from `location` alone.
            vals["location"] = pair_anchor[t] if paired else side["location"]
            # A side shows only when it's toggled on AND it actually resolved a
            # name — so an empty side never flashes a bare plate.
            vals["active"] = bool(side["visible"] and name)
            entries.extend((f"{base}.{k}", v) for k, v in vals.items())
        return entries

    @classmethod
    async def set_config(cls, raw) -> dict:
        """Replace the authored config and re-project. Returns the normalized config."""
        cfg = normalize_config(raw)
        await State.Set("playerplates.config", cfg)
        await cls.project()
        return cfg

    @classmethod
    async def point_at_match(cls, m) -> dict:
        """Re-point the band at match ``m`` (source ``match``), preserving the
        producer's per-side sub-field / visibility / location choices.

        Used by the primary-match auto-prep (see ``Match.prepare_primary_surfaces``)
        so setting the primary match's players populates the plates without wiping
        the producer's authored plate options.
        """
        cfg = dict(cls.config() or {})
        cfg["source"] = "match"
        cfg["matchId"] = m
        return await cls.set_config(cfg)

    @classmethod
    async def project(cls) -> None:
        """Resolve the config against the registry and write the overlay keys."""
        await State.SetBatch(cls._project_entries())
        # `playerplates.mode` was a projected key until the band-wide mode was
        # folded onto the per-side `visible` flags. The projector no longer owns
        # it, so a state persisted before that (and its stream-label .txt) would
        # keep a value nothing writes — drop it the first time we project over one.
        if "mode" in (State.state.get("playerplates") or {}):
            await State.Unset("playerplates.mode")
        await State.Save()

    @classmethod
    async def project_all(cls) -> None:
        """Startup hook — re-resolve the persisted config against the current
        registry/matches. Logs and no-ops on failure; never blocks boot."""
        await run_startup_projection("PlayerPlates", cls.project())

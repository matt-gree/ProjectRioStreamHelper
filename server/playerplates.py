"""Player Plates element — the two-player name/sub-plate band.

A sibling of the Commentary desk (``server/commentary.py``): its own object
(``playerplates.*`` in State), a **resolve-by-copy** projector, and the same
plate + sub-plate convention. Where Commentary is a variable-count caster row,
Player Plates is a fixed *two-player* band with three display MODES:

- ``both`` — both plates at once, side 1 anchored LEFT, side 2 anchored RIGHT.
- ``p1``   — only side 1, at its own ``location`` (left | center | right).
- ``p2``   — only side 2, at its own ``location``.

Each plate's content comes from one of two SOURCES:

- ``match``  — resolved from a bound ``match.{M}`` fixture (participant → name;
  a chosen address-book ``subField`` → the sub-plate). Re-projects when the
  match changes and at startup, exactly like the Match/Commentary projectors.
- ``manual`` — the producer types the name and (optionally) a sub label/value.

The authored config lives at ``playerplates.config``; the projector writes the
display-only keys the overlay reads (``playerplates.mode`` + per-side
``playerplates.{1,2}.*``). The participant registry stays OUT of the broadcast —
only the resolved name + chosen field value go on the wire (same contract as
Commentary). ``mode`` is fully resolved here: each side's projected ``location``
and ``active`` already account for the mode, so the overlay positions purely
from ``location`` and shows purely from ``active``.
"""
# Reuse the Commentary sub-plate field vocabulary + resolvers so the two
# elements offer/resolve address-book fields identically (single source of truth).
from server.commentary import SUBFIELD_LABELS, _resolve_name, _resolve_sub
from server.match import Match
from server.participants import Participants
from server.state import State
from server.utils.projection import run_startup_projection

MODES = ("both", "p1", "p2")
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
    """Coerce an authored config payload into the stored shape."""
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("mode")
    if mode not in MODES:
        mode = "both"
    source = raw.get("source")
    if source not in SOURCES:
        source = "match"
    sides = raw.get("sides") or {}
    return {
        "mode": mode,
        "source": source,
        "matchId": _norm_match_id(raw.get("matchId")),
        "sides": {
            "1": _normalize_side(sides.get("1") or sides.get(1), "left"),
            "2": _normalize_side(sides.get("2") or sides.get(2), "right"),
        },
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
    def _resolve_side(cls, cfg: dict, t: int) -> tuple[str, str, str]:
        """(name, subLabel, subValue) for side ``t`` under the config's source."""
        side = cfg["sides"][str(t)]
        if cfg["source"] == "manual" or cfg.get("matchId") is None:
            # Manual (or match source with no match picked): use the typed fields.
            return side["name"], side["subLabel"], side["subValue"]

        # Match source: resolve the bound fixture's side to a participant row.
        m = cfg["matchId"]
        players = Match.get(m).get("player") or {}
        p = players.get(str(t)) or players.get(t) or {}
        rio = Match._participant_rioname(p)
        pid = p.get("participantId")
        row = Participants.Get(pid) if pid else None
        if not row and rio:
            row = Participants.MatchByRioName(rio)
        name = _resolve_name(row) or rio or ""
        sub_field = side["subField"]
        if not sub_field:
            return name, "", ""
        return name, SUBFIELD_LABELS.get(sub_field, ""), _resolve_sub(row, sub_field)

    @classmethod
    def _project_entries(cls) -> list[tuple]:
        cfg = normalize_config(cls.config())
        mode = cfg["mode"]
        entries: list[tuple] = [
            ("playerplates.mode", mode),
            ("playerplates.source", cfg["source"]),
        ]
        for t in (1, 2):
            base = f"playerplates.{t}"
            side = cfg["sides"][str(t)]
            name, sub_label, sub_value = cls._resolve_side(cfg, t)
            included = mode == "both" or (mode == "p1" and t == 1) or (mode == "p2" and t == 2)
            vals = dict(_BLANK_SIDE)
            vals["name"] = name
            vals["subField"] = side["subField"]
            vals["subLabel"] = sub_label
            vals["subValue"] = sub_value
            vals["visible"] = bool(side["visible"])
            vals["subVisible"] = bool(side["subVisible"])
            # In `both` mode the two plates are pinned LEFT/RIGHT; single modes use
            # the side's own chosen location. Resolved here so the overlay never
            # has to know the mode — it positions from `location` alone.
            vals["location"] = ("left" if t == 1 else "right") if mode == "both" else side["location"]
            # A side shows only when the mode includes it, it's toggled on, and it
            # actually resolved a name — so an empty side never flashes a bare plate.
            vals["active"] = bool(included and side["visible"] and name)
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
        producer's per-side sub-field / visibility / location / mode choices.

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
        await State.Save()

    @classmethod
    async def project_all(cls) -> None:
        """Startup hook — re-resolve the persisted config against the current
        registry/matches. Logs and no-ops on failure; never blocks boot."""
        await run_startup_projection("PlayerPlates", cls.project())

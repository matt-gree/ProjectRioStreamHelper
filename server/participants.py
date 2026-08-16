"""Participant registry — the streamer's persistent local "address book".

Phase 1 of the producer-2.0 rework. A small *local working set* of people the
streamer actually uses (NOT a tournament roster, NOT the ~10k Project Rio user
list). Providers (start.gg now, Rio search later) become optional *sources* that
upsert rows on top; manual entry is the floor. HUD is a source too — it MATCHES
incoming rioNames against existing rows and resurfaces their enrichment, but it
never auto-creates a row (create-on-enrich).

Design notes:
- Own file `user_data/participants.json` + this class-level singleton, mirroring
  the `Settings` pattern (atomic write, load-on-startup, in-memory dict).
- Stays OUT of the State broadcast. Overlays never read the directory; instead,
  picking a row copies its `display.*` fields into the existing
  `score.{N}.player.{T}.*` keys overlays already read (resolve-by-copy).
- The single source both the REST API and `server/rio/provider.py` call. The
  provider reads the in-memory dict directly (no HTTP, no file IO on the hot
  path).
- `identities.rioName` is the join key today, shaped so a stable Rio account id
  graduates to the primary key later.
"""
import asyncio
import copy
import secrets
import time

from aiopath import AsyncPath
from loguru import logger

from server.paths import user_data_dir
from server.utils import json


SCHEMA_VERSION = 1

# The canonical shape of a participant's display block. Resolver maps these to
# score.player.* keys (see RESOLVE_MAP in the provider/PlayerSlot). Kept here so
# Create() can normalize partial input into a full row.
_DISPLAY_DEFAULTS = {
    "tag": "",            # → score.player.name
    "prefix": "",         # → score.player.team   (sponsor/prefix)
    "fullName": "",       # → score.player.full_name (commentary real_name maps here too)
    "pronoun": "",        # → score.player.pronoun
    "country": "",        # → score.player.state? no — country → score.player.country
    "state": "",          # → score.player.state
    "twitter": "",        # → score.player.twitter
    "youtube": "",        # → score.player.youtube
    "mainCharacter": "",  # no scoreboard target; used by player views/elements
}

_IDENTITY_DEFAULTS = {
    "rioName": "",        # join key (future: stable Rio account id)
    "startgg": None,      # { userSlug, gamerTag } when imported; else None
}


def _new_id() -> str:
    """Stable primary key for now: ``p_`` + short random hex."""
    return "p_" + secrets.token_hex(3)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _merge_block(defaults: dict, partial) -> dict:
    """Return defaults overlaid with any matching keys from partial."""
    out = dict(defaults)
    if isinstance(partial, dict):
        for k, v in partial.items():
            if k in out:
                out[k] = v
    return out


class Participants:
    participants: dict[str, dict] = {}
    _out = AsyncPath(str(user_data_dir() / "participants.json"))
    _save_lock: asyncio.Lock = asyncio.Lock()

    # ----- persistence -----------------------------------------------------

    @classmethod
    async def Save(cls):
        async with cls._save_lock:
            # Write to a sibling .tmp then atomically rename so a kill mid-write
            # can't truncate participants.json (same guard as Settings.Save()).
            payload = {"version": SCHEMA_VERSION, "participants": cls.participants}
            tmp = AsyncPath(str(cls._out) + ".tmp")
            async with tmp.open(mode="wb") as f:
                await f.write(await json.dumps(payload))
            await tmp.replace(cls._out)

    @classmethod
    async def Load(cls):
        try:
            async with cls._out.open(mode="rb") as f:
                raw = await f.read()
            data = await json.loads(raw)
            loaded = data.get("participants") if isinstance(data, dict) else None
            if isinstance(loaded, dict):
                # Normalize each row so older/partial files gain new default keys.
                cls.participants = {
                    pid: cls._normalize(row, pid)
                    for pid, row in loaded.items()
                    if isinstance(row, dict)
                }
        except FileNotFoundError:
            logger.debug("[Participants] no participants.json; starting empty")
        except Exception as e:
            logger.warning("[Participants] load failed, starting empty: {}", e)

    @classmethod
    def _normalize(cls, row: dict, pid: str) -> dict:
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        return {
            "id": row.get("id") or pid,
            "identities": _merge_block(_IDENTITY_DEFAULTS, row.get("identities")),
            "display": _merge_block(_DISPLAY_DEFAULTS, row.get("display")),
            "meta": {
                "createdAt": meta.get("createdAt") or _now(),
                "updatedAt": meta.get("updatedAt") or _now(),
                "source": meta.get("source") or "manual",
            },
        }

    # ----- reprojection ----------------------------------------------------

    @classmethod
    async def reproject_dependents(cls) -> None:
        """Re-resolve every surface that COPIED a row out of this registry.

        The projectors are resolve-by-copy: they read a participant once and
        write the result into the keys overlays render, so an overlay never
        re-resolves. That is the whole point — and it means the copies go stale
        the moment the book changes underneath them. Each projector re-projects
        when its OWN config changes and at boot, but nothing re-projected when
        the thing they all resolve AGAINST changed, so a producer fixing a
        caster's name mid-broadcast saw the Address Book update and the overlay
        keep the old name until the next launch.

        This is the one statement of "who read the book". A new projector that
        resolves `Participants.Get` belongs in this list in the same change, or
        it inherits exactly that bug.

        Imported locally: `match` and the rest import this module, so a
        top-level import here is a cycle. Each is guarded on its own — one bad
        persisted record must not stop the others re-resolving, the same
        contract `project_all` has at boot.
        """
        from server.commentary import Commentary
        from server.match import Match
        from server.organizers import Organizers
        from server.playerplates import PlayerPlates
        from server.utils.projection import run_startup_projection

        await run_startup_projection("Participants→Match", Match.project_all())
        await run_startup_projection("Participants→Commentary", Commentary.project())
        await run_startup_projection("Participants→PlayerPlates", PlayerPlates.project())
        await run_startup_projection("Participants→Organizers", Organizers.project())
        # The head-to-head band is a FETCHED artifact (its games come from the
        # Rio API), so it has no boot re-projection to borrow. Only its per-side
        # tag comes from the book, and the payload remembers its match — so
        # re-resolve just the tags rather than re-running the fetch.
        from server.matchup import Matchup

        await run_startup_projection("Participants→Matchup", Matchup.refresh_tags())

    # ----- CRUD ------------------------------------------------------------

    @classmethod
    def List(cls) -> list[dict]:
        return list(cls.participants.values())

    @classmethod
    def Get(cls, pid: str) -> dict | None:
        return cls.participants.get(pid)

    @classmethod
    async def Create(cls, partial: dict | None = None) -> dict:
        partial = partial or {}
        pid = _new_id()
        while pid in cls.participants:
            pid = _new_id()
        now = _now()
        row = {
            "id": pid,
            "identities": _merge_block(_IDENTITY_DEFAULTS, partial.get("identities")),
            "display": _merge_block(_DISPLAY_DEFAULTS, partial.get("display")),
            "meta": {
                "createdAt": now,
                "updatedAt": now,
                "source": (partial.get("meta") or {}).get("source", "manual"),
            },
        }
        cls.participants[pid] = row
        await cls.Save()
        # A NEW row matters too: the resolvers fall back to a rioName lookup
        # (`MatchByRioName`), so adding the player who is on air right now is
        # what makes their plate stop showing a bare Rio username.
        await cls.reproject_dependents()
        return row

    @classmethod
    async def Update(cls, pid: str, partial: dict | None = None) -> dict | None:
        row = cls.participants.get(pid)
        if row is None:
            return None
        partial = partial or {}
        if isinstance(partial.get("identities"), dict):
            row["identities"].update(
                {k: v for k, v in partial["identities"].items() if k in _IDENTITY_DEFAULTS}
            )
        if isinstance(partial.get("display"), dict):
            row["display"].update(
                {k: v for k, v in partial["display"].items() if k in _DISPLAY_DEFAULTS}
            )
        row["meta"]["updatedAt"] = _now()
        await cls.Save()
        # The edit is the whole point of this call — a name or pronoun a
        # projector already copied. Re-resolve before returning so the overlay
        # matches the book the producer just corrected.
        await cls.reproject_dependents()
        return row

    @classmethod
    async def Delete(cls, pid: str) -> bool:
        existed = cls.participants.pop(pid, None) is not None
        if existed:
            await cls.Save()
            # A deleted row is still copied into every projection that resolved
            # it. Re-resolving blanks those fields (the projectors write their
            # full key set, value or ""), which is the honest answer — the
            # alternative is an overlay naming someone no longer in the book.
            await cls.reproject_dependents()
        return existed

    # ----- backup / restore (manual import + export) -----------------------

    @classmethod
    def Export(cls) -> dict:
        """Full address-book snapshot in the on-disk backup shape. What the
        manual "Export" download serializes; round-trips through ImportRows."""
        # Deep-copy so a caller can't mutate the live registry through the
        # returned snapshot (the HTTP path serializes immediately, but callers
        # in-process shouldn't alias internal rows).
        return {
            "version": SCHEMA_VERSION,
            "exportedAt": _now(),
            "participants": copy.deepcopy(cls.List()),
        }

    @classmethod
    async def ImportRows(cls, rows, replace: bool = False) -> dict:
        """Bulk import full participant rows (the Export backup format).

        - ``replace=True`` wipes the registry first, then loads the rows exactly
          (a clean restore).
        - Otherwise MERGE: match each incoming row against the existing book by
          start.gg userId, then by rioName. On a match, non-empty incoming
          fields win (a restore refreshes a row without dropping local-only
          fields); no match creates a new row. Never destructive in merge mode.

        Ids are regenerated on collision so an import can't clobber an unrelated
        local row that happens to share an id. Returns a small summary.
        """
        if not isinstance(rows, list):
            return {"imported": 0, "created": 0, "updated": 0}
        if replace:
            cls.participants = {}

        created = updated = 0
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            incoming = cls._normalize(raw, raw.get("id") or _new_id())

            match = None
            if not replace:
                sg = incoming["identities"].get("startgg")
                sg_uid = sg.get("userId") if isinstance(sg, dict) else None
                rio = incoming["identities"].get("rioName")
                match = (cls.MatchByStartGG(sg_uid) if sg_uid else None) \
                    or (cls.MatchByRioName(rio) if rio else None)

            if match is not None:
                # Display refreshes from the backup (incoming non-empty wins),
                # but identities only FILL EMPTY — never rewrite the rioName join
                # key or an existing start.gg link that identifies this person.
                for k, v in incoming["display"].items():
                    if v:
                        match["display"][k] = v
                for k, v in incoming["identities"].items():
                    if v and not match["identities"].get(k):
                        match["identities"][k] = v
                match["meta"]["updatedAt"] = _now()
                updated += 1
            else:
                pid = incoming["id"]
                while pid in cls.participants:
                    pid = _new_id()
                incoming["id"] = pid
                cls.participants[pid] = incoming
                created += 1

        await cls.Save()
        # ONCE, after the whole batch — a restore can rewrite hundreds of rows,
        # and each projector writes its full key set, so per-row fan-out would
        # be that many full re-projections for one import. `replace=True` makes
        # this mandatory rather than nice: it wipes the book, so every copy in
        # every projection is resolved against a registry that no longer exists.
        await cls.reproject_dependents()
        return {"imported": created + updated, "created": created, "updated": updated}

    # ----- matching (the resurface loop) -----------------------------------

    @classmethod
    def MatchByRioName(cls, rio_name: str) -> dict | None:
        """Case-insensitive exact match on identities.rioName. Read off the
        in-memory dict — safe to call on the HUD hot path (no IO)."""
        if not rio_name:
            return None
        needle = rio_name.strip().casefold()
        if not needle:
            return None
        for row in cls.participants.values():
            existing = (row.get("identities") or {}).get("rioName") or ""
            if existing.strip().casefold() == needle:
                return row
        return None

    @classmethod
    def MatchByStartGG(cls, user_id) -> dict | None:
        """Exact match on identities.startgg.userId. The de-dupe key for
        imports — stable across name changes and re-imports. None when the
        user_id is falsy or no row carries it."""
        if user_id in (None, ""):
            return None
        for row in cls.participants.values():
            sg = (row.get("identities") or {}).get("startgg")
            if isinstance(sg, dict) and sg.get("userId") == user_id:
                return row
        return None

    # ----- provider import (start.gg) --------------------------------------

    @classmethod
    async def UpsertFromStartGG(cls, player: dict) -> dict:
        """Import one parsed start.gg player into the registry.

        De-dupe order (D2): start.gg userId first, then gamerTag against an
        existing rioName (player-only entrant with no start.gg account).
        - Found  → fill only EMPTY display fields, stamp the startgg identity.
          Never clobbers a manual edit (re-import enriches, doesn't overwrite).
        - Missing → Create a new row with meta.source="startgg". rioName stays
          EMPTY until the user maps it.
        Returns the row.
        """
        player = player or {}
        user_id = player.get("userId")
        gamer_tag = player.get("gamerTag") or ""

        # start.gg → display field map (rioName intentionally excluded).
        sg_to_display = {
            "gamerTag": "tag",
            "prefix": "prefix",
            "full_name": "fullName",
            "pronoun": "pronoun",
            "country": "country",
            "state": "state",
            "twitter": "twitter",
        }

        startgg_identity = {
            "userId": user_id,
            "slug": player.get("userSlug") or "",
            "gamerTag": gamer_tag,
        }

        row = cls.MatchByStartGG(user_id) or cls.MatchByRioName(gamer_tag)

        if row is not None:
            display = row["display"]
            for src, dst in sg_to_display.items():
                val = player.get(src)
                if val and not display.get(dst):
                    display[dst] = val
            row["identities"]["startgg"] = startgg_identity
            row["meta"]["updatedAt"] = _now()
            await cls.Save()
            return row

        new_display = {}
        for src, dst in sg_to_display.items():
            val = player.get(src)
            if val:
                new_display[dst] = val
        return await cls.Create({
            "identities": {"startgg": startgg_identity},
            "display": new_display,
            "meta": {"source": "startgg"},
        })

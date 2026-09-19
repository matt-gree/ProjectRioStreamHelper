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

SEVERAL BOOKS, ONE REGISTRY (schema v2). A row belongs to exactly one BOOK
(`row.book`); `main` is the book every install has and the one a row lands in
when nothing says otherwise. Any other book may name a LEAGUE — the Rio game
modes its games are played in (`book.modes`) — and each person in it may carry
a LOGO (`row.logo`, their team's art). A book is the unit a producer SHARES: its
export carries the people and their logo files, so a league's book travels
whole.

There are NO TEAMS. A first cut had them (`book.teams` + `row.team`), and in
the league this is for every team is one manager, so a team was only ever a
second name for a person — asked for on every logo, and drawn in exactly one
place, the Player Name tag line, which the league row's own sponsor `prefix`
already fills in a league game. `_adopt_team_logos` moves an old book's team
logos onto their players at load.

Lookup order is the part to keep straight:
  - `MatchByRioName(name)` with no book prefers `main`, then any other book —
    so someone kept only in a league book still resurfaces everywhere;
  - a board whose game is in a league's mode asks THAT book first
    (`resolve_for_mode`), which is what lets a league's own spelling of a name
    win in its own games;
  - a LOGO only ever comes from the book of the league being played. The same
    person in another league's book is not wearing that league's logo here.
The logo is put on air by `server/league_logos.py` (a State write hook), not by
the resurface map: it is a fact about (person, league), not about the person.
"""
import asyncio
import base64
import copy
import io
import json as json_std
import re
import secrets
import shutil
import time
import zipfile
from pathlib import Path

from aiopath import AsyncPath
from loguru import logger

from server.paths import user_data_dir
from server.utils import json


SCHEMA_VERSION = 2

# The book every install has. Undeletable, un-leagued by default, and where a
# row with no (or an unknown) book lands — which is also every v1 row.
MAIN_BOOK = "main"

# What a league logo may be. The same set the tournament logo takes
# (server/api/v1/branding.py), keyed by extension because the bytes are also
# what an EXPORT carries as a data URI.
LOGO_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}
# The console scales a raster logo to 1024 px before sending it
# (src/lib/image.js), so this only catches what skipped that — an SVG, or a
# client that doesn't — and is generous for the same reason.
LOGO_MAX_BYTES = 10 * 1024 * 1024

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
}

_IDENTITY_DEFAULTS = {
    "rioName": "",        # join key (future: stable Rio account id)
    "startgg": None,      # { userSlug, gamerTag } when imported; else None
}

# Production preferences — how PRSH treats this person, as opposed to what it
# DISPLAYS about them. Deliberately not in `display`: that block is the
# resolve-by-copy payload projectors write into `score.player.*`, and a value no
# overlay ever draws does not belong in it.
#
# `side` is the old global "Player Lock", moved onto the person because that is
# what it was always a fact about — one app-wide pinned player was an
# implementation ceiling, not a decision. `None` = no preference; 1 or 2 name a
# side in the usual vocabulary (never left/right — see the glossary).
_PREFS_DEFAULTS = {
    "side": None,         # 1 | 2 | None — the side cascade's `pin` layer
}


def _clean_side(value):
    """A stored side is 1, 2, or nothing. Anything else — a legacy "Team 1"
    string, a 0 from a form, junk from a hand-edited backup — is no preference,
    because a pin that half-parses would silently orient a broadcast."""
    try:
        side = int(value)
    except (TypeError, ValueError):
        return None
    return side if side in (1, 2) else None


def _clean_prefs(prefs: dict) -> dict:
    """Normalize a prefs block. One field today, so this is a thin wrapper — but
    it is the single gate every write path goes through (`_normalize`, `Create`,
    `Update`), which is what keeps an unparseable side out of the cascade."""
    out = dict(prefs)
    out["side"] = _clean_side(out.get("side"))
    return out


def _rio_key(name) -> str:
    """Canonical lookup form for a rioName.

    One statement of the rule the two match functions used to spell inline, so
    the index and its readers cannot drift into disagreeing about whether
    " Alice " is Alice.
    """
    return (name or "").strip().casefold()


def _new_id(prefix: str = "p_") -> str:
    """Stable primary key for now: ``p_`` + short random hex."""
    return prefix + secrets.token_hex(3)


def _mode_key(mode) -> str:
    return (mode or "").strip().casefold() if isinstance(mode, str) else ""


def _clean_modes(modes) -> list[str]:
    """A book's league modes: trimmed, de-duplicated (case-insensitively), in
    the order given. Anything that is not a list of strings is no league."""
    if not isinstance(modes, list):
        return []
    out, seen = [], set()
    for m in modes:
        if not isinstance(m, str):
            continue
        k = _mode_key(m)
        if k and k not in seen:
            seen.add(k)
            out.append(m.strip())
    return out


def _normalize_book(bid: str, raw) -> dict:
    """A book is `name` · `modes` · `community`. `modes` are Rio game-mode NAMES
    (what `score.{N}.game_mode` and a binding's `stats_tag` hold) — names rather
    than tag-set ids because a book is shared between machines and the name is
    what a producer recognises in the picker."""
    raw = raw if isinstance(raw, dict) else {}
    return {
        "id": bid,
        "name": str(raw.get("name") or ("Address Book" if bid == MAIN_BOOK else "Untitled book")),
        "modes": _clean_modes(raw.get("modes")),
        # The Rio community this book was pulled from, "" = none. Remembered so
        # the book can be re-pulled when the league signs someone new.
        "community": str(raw.get("community") or ""),
    }


_DATA_URI = re.compile(r"^data:([\w/+.-]+);base64,(.*)$", re.S)


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


def _book_of(row: dict) -> str:
    """The book a row belongs to. A row written before books existed — or by a
    fixture that never heard of them — is a `main` row."""
    return row.get("book") or MAIN_BOOK


class Participants:
    participants: dict[str, dict] = {}
    books: dict[str, dict] = {MAIN_BOOK: _normalize_book(MAIN_BOOK, {})}
    _out = AsyncPath(str(user_data_dir() / "participants.json"))
    # League logos live beside the tournament logo so the `/branding/` static
    # mount (and its no-cache header, server/http_cache.py) serves them as-is:
    # /branding/leagues/{book}/{file}.
    _logos_dir: Path = user_data_dir() / "branding" / "leagues"
    _save_lock: asyncio.Lock = asyncio.Lock()

    # ----- join-key indexes ------------------------------------------------
    #
    # WHY THESE EXIST. `MatchByRioName` was a linear scan that lowercased every
    # row as it went, and `PreferredSide` — the `pin` layer of the side cascade —
    # calls it PER HUD FRAME, per side, per board. That is fine at the couple of
    # dozen rows a producer types by hand and is a different function entirely at
    # the thousands a community import lands, which is the scale this registry is
    # about to be asked to hold. CLAUDE.md already states the rule ("use indexed
    # lookups instead of O(n) scans"); this is that rule applied to the one
    # resolver on the hot path. The same scan is also the inner loop of
    # `ImportRows`' merge, which made a large import O(incoming x existing).
    #
    # FIRST WINS on a duplicate key, because that is what the scan did: it walked
    # `participants.values()` in insertion order and returned the first match. A
    # book can hold two rows with one rioName (nothing forbids it), so the tie
    # break is behaviour, not an implementation detail — hence `setdefault`.
    #
    # They are a pure function of `participants`, so anything that mutates that
    # dict must call `_index_row` or `_reindex`. Single-row edits take the full
    # rebuild: they already pay `Save()` plus a `reproject_dependents()` fan-out,
    # so an O(n) walk is lost in the noise and "rebuild it all" cannot be wrong.
    _by_rio: dict[str, str] = {}
    _by_startgg: dict = {}
    # (book, rio key) → pid. The same person may sit in several books; within
    # one book the first row still wins, for the same reason as `_by_rio`.
    _by_book_rio: dict[tuple[str, str], str] = {}

    @classmethod
    def _index_row(cls, row: dict) -> None:
        """Add one row's join keys. Additive only — see `_reindex` to rebuild."""
        pid = row.get("id")
        if not pid:
            return
        ids = row.get("identities") or {}
        key = _rio_key(ids.get("rioName"))
        if key:
            book = _book_of(row)
            cls._by_book_rio.setdefault((book, key), pid)
            # The book-less lookup PREFERS main: a row in `main` displaces a
            # league row that was indexed first, never the other way round.
            held = cls._by_rio.get(key)
            if held is None:
                cls._by_rio[key] = pid
            elif book == MAIN_BOOK and _book_of(cls.participants.get(held) or {}) != MAIN_BOOK:
                cls._by_rio[key] = pid
        sg = ids.get("startgg")
        if isinstance(sg, dict):
            uid = sg.get("userId")
            if uid not in (None, ""):
                try:
                    cls._by_startgg.setdefault(uid, pid)
                except TypeError:
                    # An unhashable userId is a corrupt record, not a reason to
                    # fail the load that is rebuilding the whole index.
                    logger.warning(
                        "[Participants] row {} has an unusable start.gg userId", pid
                    )

    @classmethod
    def _reindex(cls) -> None:
        """Rebuild both indexes from `participants`.

        Public to the test suite and to any fixture that writes the registry
        directly: an index this class did not build is an index nobody updated.
        """
        cls._by_rio = {}
        cls._by_startgg = {}
        cls._by_book_rio = {}
        for row in cls.participants.values():
            cls._index_row(row)

    # ----- persistence -----------------------------------------------------

    @classmethod
    async def Save(cls):
        async with cls._save_lock:
            # Write to a sibling .tmp then atomically rename so a kill mid-write
            # can't truncate participants.json (same guard as Settings.Save()).
            payload = {
                "version": SCHEMA_VERSION,
                "books": cls.books,
                "participants": cls.participants,
            }
            tmp = AsyncPath(str(cls._out) + ".tmp")
            async with tmp.open(mode="wb") as f:
                await f.write(await json.dumps(payload))
            await tmp.replace(cls._out)

    @classmethod
    async def Load(cls):
        migrated = False
        try:
            async with cls._out.open(mode="rb") as f:
                raw = await f.read()
            data = await json.loads(raw)
            books = data.get("books") if isinstance(data, dict) else None
            # A v1 file has no books: everyone in it is a `main` row, which is
            # exactly what `_normalize` makes of a row with no book.
            cls.books = {
                bid: _normalize_book(bid, b)
                for bid, b in (books.items() if isinstance(books, dict) else [])
                if isinstance(bid, str)
            }
            cls._ensure_main()
            loaded = data.get("participants") if isinstance(data, dict) else None
            if isinstance(loaded, dict) and isinstance(books, dict):
                migrated = cls._adopt_team_logos(books, loaded)
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
        # Outside the try: a partial or failed load still has to leave the
        # indexes describing whatever `participants` actually holds.
        cls._ensure_main()
        cls._reindex()
        if migrated:
            await cls.Save()

    @classmethod
    def _clean_book(cls, book) -> str:
        """An unknown book is `main` — where a row with nowhere else to be lands."""
        return book if isinstance(book, str) and book in cls.books else MAIN_BOOK

    @classmethod
    def _ensure_main(cls) -> None:
        if MAIN_BOOK not in cls.books:
            cls.books = {MAIN_BOOK: _normalize_book(MAIN_BOOK, {}), **cls.books}

    @classmethod
    def _adopt_team_logos(cls, raw_books: dict, raw_rows: dict) -> bool:
        """Move a pre-2026-09-18 book's TEAM logos onto the players who held
        them, in place, before the rows are normalized. Each team's file is
        renamed to its player's (`{pid}.{ext}`); a team nobody held has no one
        to go to, and its file is deleted with it. Returns True when anything
        moved, so the load saves the new shape once."""
        moved = False
        for bid, book in raw_books.items():
            teams = book.get("teams") if isinstance(book, dict) else None
            if not isinstance(teams, dict) or not teams:
                continue
            folder = cls._logos_dir / bid
            kept: set[str] = set()
            for pid, row in raw_rows.items():
                if not isinstance(row, dict) or (row.get("book") or MAIN_BOOK) != bid:
                    continue
                team = teams.get(row.pop("team", None) or "")
                src = folder / team["logo"] if isinstance(team, dict) and team.get("logo") else None
                if src is None or not src.is_file() or row.get("logo"):
                    continue
                dst = folder / f"{pid}{src.suffix.lower()}"
                shutil.copyfile(src, dst)
                row["logo"] = dst.name
                row["logoRev"] = int(team.get("logoRev") or 0) + 1
                kept.add(dst.name)
            if folder.is_dir():
                for f in folder.iterdir():
                    if f.is_file() and f.name not in kept and not f.name.startswith("p_"):
                        f.unlink(missing_ok=True)
            book.pop("teams", None)
            moved = True
        if moved:
            logger.info("[Participants] moved league team logos onto their players")
        return moved

    @classmethod
    def _normalize(cls, row: dict, pid: str) -> dict:
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        try:
            logo_rev = int(row.get("logoRev") or 0)
        except (TypeError, ValueError):
            logo_rev = 0
        return {
            "id": row.get("id") or pid,
            "book": cls._clean_book(row.get("book")),
            # This person's logo in THIS book's league — a file name under the
            # book's logo folder, "" = none. Only a league book's rows use it.
            "logo": row.get("logo") if isinstance(row.get("logo"), str) else "",
            "logoRev": logo_rev,
            "identities": _merge_block(_IDENTITY_DEFAULTS, row.get("identities")),
            "display": _merge_block(_DISPLAY_DEFAULTS, row.get("display")),
            "prefs": _clean_prefs(_merge_block(_PREFS_DEFAULTS, row.get("prefs"))),
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
        # A league logo is resolved per write by a State hook, which only fires
        # when a board's player or mode changes — a logo swapped or a person
        # added to a league book changes neither. Settle every board.
        from server.league_logos import LeagueLogos

        await run_startup_projection("Participants→LeagueLogos", LeagueLogos.project_all())

    # ----- CRUD ------------------------------------------------------------

    @classmethod
    def List(cls) -> list[dict]:
        return list(cls.participants.values())

    @classmethod
    def Get(cls, pid: str) -> dict | None:
        return cls.participants.get(pid)

    @classmethod
    async def Create(cls, partial: dict | None = None, *, reproject: bool = True) -> dict:
        """Add a row. ``reproject=False`` is for a caller that fans out once
        for a whole batch itself (the start.gg import)."""
        partial = partial or {}
        pid = _new_id()
        while pid in cls.participants:
            pid = _new_id()
        now = _now()
        row = {
            "id": pid,
            "book": cls._clean_book(partial.get("book")),
            "logo": "",
            "logoRev": 0,
            "identities": _merge_block(_IDENTITY_DEFAULTS, partial.get("identities")),
            "display": _merge_block(_DISPLAY_DEFAULTS, partial.get("display")),
            "prefs": _clean_prefs(_merge_block(_PREFS_DEFAULTS, partial.get("prefs"))),
            "meta": {
                "createdAt": now,
                "updatedAt": now,
                "source": (partial.get("meta") or {}).get("source", "manual"),
            },
        }
        cls.participants[pid] = row
        cls._index_row(row)
        await cls.Save()
        # A NEW row matters too: the resolvers fall back to a rioName lookup
        # (`MatchByRioName`), so adding the player who is on air right now is
        # what makes their plate stop showing a bare Rio username.
        if reproject:
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
        if isinstance(partial.get("prefs"), dict):
            row.setdefault("prefs", dict(_PREFS_DEFAULTS)).update(
                {k: v for k, v in partial["prefs"].items() if k in _PREFS_DEFAULTS}
            )
            row["prefs"] = _clean_prefs(row["prefs"])
        # Moving a row to another book takes its logo file along: the file
        # lives in its book's folder.
        if "book" in partial:
            book = cls._clean_book(partial.get("book"))
            if book != _book_of(row) and row.get("logo"):
                src = cls._logos_dir / _book_of(row) / row["logo"]
                if src.is_file():
                    (cls._logos_dir / book).mkdir(parents=True, exist_ok=True)
                    src.replace(cls._logos_dir / book / row["logo"])
            row["book"] = book
        row["meta"]["updatedAt"] = _now()
        # An edit can MOVE a join key (a corrected rioName, a newly linked
        # start.gg account), which is the one mutation that has to drop an old
        # entry as well as add a new one — so this rebuilds rather than adds.
        cls._reindex()
        await cls.Save()
        # The edit is the whole point of this call — a name or pronoun a
        # projector already copied. Re-resolve before returning so the overlay
        # matches the book the producer just corrected.
        await cls.reproject_dependents()
        return row

    @classmethod
    async def Delete(cls, pid: str) -> bool:
        row = cls.participants.pop(pid, None)
        existed = row is not None
        if existed:
            cls._remove_logo_file(row)
            cls._reindex()
            await cls.Save()
            # A deleted row is still copied into every projection that resolved
            # it. Re-resolving blanks those fields (the projectors write their
            # full key set, value or ""), which is the honest answer — the
            # alternative is an overlay naming someone no longer in the book.
            await cls.reproject_dependents()
        return existed

    # ----- books & logos ---------------------------------------------------

    @classmethod
    def ListBooks(cls) -> list[dict]:
        """Every book, `main` first, with a people `count`."""
        cls._ensure_main()
        out = []
        for bid, book in cls.books.items():
            b = copy.deepcopy(book)
            b["count"] = sum(1 for r in cls.participants.values() if _book_of(r) == bid)
            out.append(b)
        out.sort(key=lambda b: b["id"] != MAIN_BOOK)
        return out

    @classmethod
    async def CreateBook(cls, partial: dict | None = None) -> dict:
        partial = partial or {}
        bid = _new_id("b_")
        while bid in cls.books:
            bid = _new_id("b_")
        cls.books[bid] = _normalize_book(bid, {
            "name": (partial.get("name") or "").strip() or "Untitled book",
            "modes": partial.get("modes"),
        })
        await cls.Save()
        return cls.books[bid]

    @classmethod
    async def UpdateBook(cls, bid: str, partial: dict | None = None) -> dict | None:
        book = cls.books.get(bid)
        if book is None:
            return None
        partial = partial or {}
        if "name" in partial:
            name = str(partial.get("name") or "").strip()
            if name:
                book["name"] = name
        if "modes" in partial:
            book["modes"] = _clean_modes(partial.get("modes"))
        await cls.Save()
        # A new league link changes which boards this book's logos reach.
        await cls.reproject_dependents()
        return book

    @classmethod
    async def DeleteBook(cls, bid: str) -> bool:
        """Remove a book, its people and its logos. `main` is not removable —
        it is where every row with nowhere else to be lands."""
        if bid == MAIN_BOOK or bid not in cls.books:
            return False
        cls.books.pop(bid)
        cls.participants = {
            pid: r for pid, r in cls.participants.items() if _book_of(r) != bid
        }
        cls._reindex()
        d = cls._logos_dir / bid
        if d.is_dir():
            for f in d.iterdir():
                f.unlink(missing_ok=True)
            d.rmdir()
        await cls.Save()
        await cls.reproject_dependents()
        return True

    @classmethod
    def _remove_logo_file(cls, row: dict) -> None:
        if row.get("logo"):
            (cls._logos_dir / _book_of(row) / row["logo"]).unlink(missing_ok=True)

    @classmethod
    def _write_logo(cls, row: dict, data: bytes, ext: str) -> None:
        """Store a person's logo as `{pid}.{ext}` in their book's folder — one
        file per person, so a new upload in another format removes the old."""
        d = cls._logos_dir / _book_of(row)
        d.mkdir(parents=True, exist_ok=True)
        name = f"{row['id']}.{ext}"
        if row.get("logo") and row["logo"] != name:
            cls._remove_logo_file(row)
        (d / name).write_bytes(data)
        row["logo"] = name
        row["logoRev"] = int(row.get("logoRev") or 0) + 1

    @classmethod
    async def SetLogo(cls, pid: str, data: bytes | None, content_type: str = "") -> dict | None:
        """Replace (or with no data, remove) a person's logo. Raises ValueError
        on a type or size the overlays cannot be trusted to draw."""
        row = cls.participants.get(pid)
        if row is None:
            return None
        if data is None:
            cls._remove_logo_file(row)
            row["logo"] = ""
            row["logoRev"] = int(row.get("logoRev") or 0) + 1
        else:
            ext = LOGO_TYPES.get(content_type)
            if not ext:
                raise ValueError(f"Unsupported logo type: {content_type or 'unknown'}")
            if len(data) > LOGO_MAX_BYTES:
                raise ValueError(f"Logo too large ({len(data)} bytes). Max is {LOGO_MAX_BYTES}.")
            cls._write_logo(row, data, ext)
        row["meta"]["updatedAt"] = _now()
        await cls.Save()
        await cls.reproject_dependents()
        return row

    @staticmethod
    def logo_url(row: dict | None) -> str:
        """Server-relative URL of a person's logo, "" when they have none. The
        rev in the query string is what makes a replaced file refetch on air."""
        if not row or not row.get("logo"):
            return ""
        return f"/branding/leagues/{_book_of(row)}/{row['logo']}?v={int(row.get('logoRev') or 0)}"

    @classmethod
    async def AddPlayers(cls, bid: str, usernames, community: str = "", modes=None) -> dict | None:
        """Add Rio users to a book by name — the Rio-community pull.

        Additive and idempotent: someone already in the book is left exactly as
        the producer has them, so a re-pull only brings in who is new. A new
        row copies what the MAIN book already knows about that person (tag,
        socials, pronouns) rather than starting them bare, and never a logo —
        a logo belongs to its league's book. A book with no league yet takes the
        community's game modes; one that has them keeps the producer's choice.
        """
        book = cls.books.get(bid)
        if book is None:
            return None
        added = kept = 0
        now = _now()
        for name in usernames if isinstance(usernames, list) else []:
            if not isinstance(name, str) or not name.strip():
                continue
            name = name.strip()
            if cls.MatchByRioName(name, book=bid) is not None:
                kept += 1
                continue
            known = cls.MatchByRioName(name, book=MAIN_BOOK) or {}
            pid = _new_id()
            while pid in cls.participants:
                pid = _new_id()
            display = _merge_block(_DISPLAY_DEFAULTS, known.get("display"))
            display["tag"] = display.get("tag") or name
            row = {
                "id": pid, "book": bid, "logo": "", "logoRev": 0,
                "identities": {**_IDENTITY_DEFAULTS, "rioName": name},
                "display": display,
                "prefs": _clean_prefs(_merge_block(_PREFS_DEFAULTS, known.get("prefs"))),
                "meta": {"createdAt": now, "updatedAt": now, "source": "rio"},
            }
            cls.participants[pid] = row
            cls._index_row(row)
            added += 1
        if community:
            book["community"] = community
        if not book["modes"] and modes:
            book["modes"] = _clean_modes(list(modes))
        await cls.Save()
        await cls.reproject_dependents()
        return {"added": added, "kept": kept, "modes": list(book["modes"])}

    # ----- leagues (which book a game is played in) ------------------------

    @classmethod
    def book_for_mode(cls, mode) -> dict | None:
        """The book whose league includes this game mode, or None. `main` never
        answers — a league is something a producer links a book TO. When two
        books claim one mode the older book wins, so the answer never depends
        on dict order the producer cannot see."""
        key = _mode_key(mode)
        if not key:
            return None
        for bid, book in cls.books.items():
            if bid == MAIN_BOOK:
                continue
            if any(_mode_key(m) == key for m in book.get("modes") or []):
                return book
        return None

    @classmethod
    def league_logo(cls, mode, rio_name) -> tuple[dict | None, str]:
        """(book, logo URL) for this person in the league this mode belongs
        to. The book is None when the mode is no league's; the URL is "" when
        the person has no logo in it (or is not in its book at all)."""
        book = cls.book_for_mode(mode)
        if book is None:
            return None, ""
        row = cls.MatchByRioName(rio_name, book=book["id"]) if rio_name else None
        return book, cls.logo_url(row)

    @classmethod
    def resolve_for_mode(cls, rio_name, mode) -> dict | None:
        """The row to resurface for a player in a game of `mode`: the league's
        own row when the game is in a league and it has one, the ordinary
        lookup otherwise."""
        book = cls.book_for_mode(mode)
        if book is not None:
            row = cls.MatchByRioName(rio_name, book=book["id"])
            if row is not None:
                return row
        return cls.MatchByRioName(rio_name)

    # ----- backup / restore / sharing --------------------------------------
    #
    # A SHARED BOOK IS A ZIP: `book.json` beside a `logos/` folder of real image
    # files, which each row's `logo` names by path. Logos used to ride inside
    # the JSON as base64 data URIs — one file, but a third bigger, unreadable,
    # and impossible to fix one logo in without a script. A zip keeps the
    # one-file hand-off and gives the logos back their file-ness: unzip it,
    # swap a PNG, zip it back. A data URI still reads, and so does a book from
    # when logos hung off TEAMS (`_legacy_team_logos`), so an old file opens.

    # What a shared zip may hold before it is refused unread: the JSON is text
    # about people (a few KB per hundred rows), the logos are capped one by one.
    ZIP_JSON_MAX = 20 * 1024 * 1024
    ZIP_MAX_MEMBERS = 1000

    @classmethod
    def Export(cls, bid: str = MAIN_BOOK, logo_paths: dict | None = None) -> dict | None:
        """One book as data: its league and its people.

        A row's `logo` is the path its file has INSIDE A SHARED ZIP
        (`logo_paths`, filled in by `ExportZip`), or "" — never a file name in
        this machine's user_data, which would mean nothing on another one. The
        `participants` key keeps the v1 shape, so an old build can still
        restore the people from a new file.
        """
        book = cls.books.get(bid)
        if book is None:
            return None
        logo_paths = logo_paths or {}
        rows = []
        for r in cls.participants.values():
            if _book_of(r) != bid:
                continue
            # Deep-copied so an in-process caller cannot mutate the live
            # registry through the snapshot.
            row = copy.deepcopy(r)
            row["logo"] = logo_paths.get(r["id"], "")
            row.pop("logoRev", None)
            rows.append(row)
        return {
            "version": SCHEMA_VERSION,
            "kind": "prsh-address-book",
            "exportedAt": _now(),
            "book": {
                "name": book["name"],
                "modes": list(book["modes"]),
                "community": book.get("community", ""),
            },
            "participants": rows,
        }

    @classmethod
    def ExportZip(cls, bid: str) -> bytes | None:
        """The shareable file: `book.json` + `logos/{player}.{ext}`. Logo files
        are named for their PLAYER, not their id, so the unzipped folder reads
        as what it is."""
        book = cls.books.get(bid)
        if book is None:
            return None
        paths: dict[str, str] = {}
        files: dict[str, bytes] = {}
        for row in cls.participants.values():
            if _book_of(row) != bid or not row.get("logo"):
                continue
            src = cls._logos_dir / bid / row["logo"]
            if not src.is_file():
                continue
            who = (row["display"].get("tag") or row["identities"].get("rioName") or "").casefold()
            stem = re.sub(r"[^a-z0-9]+", "-", who).strip("-") or row["id"]
            name = f"logos/{stem}{src.suffix.lower()}"
            n = 2
            while name in files:
                name = f"logos/{stem}-{n}{src.suffix.lower()}"
                n += 1
            paths[row["id"]] = name
            files[name] = src.read_bytes()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("book.json", json_std.dumps(cls.Export(bid, paths), indent=2, ensure_ascii=False))
            for name, data in files.items():
                # PNG/JPEG/WebP are already compressed; deflating them again is
                # wasted time for no bytes.
                z.writestr(name, data, compress_type=zipfile.ZIP_STORED)
        return buf.getvalue()

    @classmethod
    def ReadZip(cls, data: bytes) -> tuple[dict, dict[str, bytes]]:
        """Open a shared book zip: (`book.json` as a dict, {logo path: bytes}).

        Nothing is extracted to disk and no member is read by a path the zip
        chose — only `book.json` and the logo paths it names, each checked
        against its size cap BEFORE it is decompressed (a zip states what a
        member will inflate to, which is what stops a zip bomb). Raises
        ValueError on anything that is not a shared book."""
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError("Not a zip file")
        with z:
            infos = {i.filename: i for i in z.infolist()}
            if len(infos) > cls.ZIP_MAX_MEMBERS:
                raise ValueError("Too many files in this zip")
            info = infos.get("book.json")
            if info is None:
                raise ValueError("No book.json in this zip")
            if info.file_size > cls.ZIP_JSON_MAX:
                raise ValueError("book.json is too large")
            try:
                payload = json_std.loads(z.read(info).decode("utf-8"))
            except Exception:
                raise ValueError("book.json is not valid JSON")
            if not isinstance(payload, dict):
                raise ValueError("book.json is not an address book")
            named = [r.get("logo") for r in payload.get("participants") or [] if isinstance(r, dict)]
            meta = payload.get("book") if isinstance(payload.get("book"), dict) else {}
            named += [t.get("logo") for t in meta.get("teams") or [] if isinstance(t, dict)]
            files: dict[str, bytes] = {}
            for path in named:
                if not isinstance(path, str) or path.startswith("data:") or path in files:
                    continue
                member = infos.get(path)
                if member is None or member.file_size > LOGO_MAX_BYTES:
                    continue
                files[path] = z.read(member)
        return payload, files

    @classmethod
    def _logo_from(cls, value, files: dict | None) -> tuple[bytes, str] | None:
        """A logo as an export states it — a path into the zip, or (a book
        shared as JSON before zips) an inline data URI. (bytes, ext) or None."""
        value = str(value or "")
        if files and value in files:
            ext = Path(value).suffix.lstrip(".").lower()
            ext = "jpg" if ext == "jpeg" else ext
            return (files[value], ext) if ext in LOGO_TYPES.values() else None
        m = _DATA_URI.match(value)
        ext = LOGO_TYPES.get(m.group(1)) if m else None
        if not ext:
            return None
        try:
            return base64.b64decode(m.group(2), validate=False), ext
        except Exception:
            return None

    @staticmethod
    def _legacy_team_logos(teams) -> dict:
        """{team id: logo} from a book file written while logos hung off TEAMS,
        so each row's old `team` still finds its logo."""
        if not isinstance(teams, list):
            return {}
        return {
            t["id"]: t["logo"] for t in teams
            if isinstance(t, dict) and t.get("id") is not None and t.get("logo")
        }

    @classmethod
    async def ImportAsNewBook(cls, payload: dict, files: dict | None = None) -> dict:
        """Create a new book from a shared export and load it. A file with no
        `book` block (a v1 people-only backup) still makes a book — named for
        what it is, with no league."""
        meta = payload.get("book") if isinstance(payload.get("book"), dict) else {}
        book = await cls.CreateBook({
            "name": meta.get("name") or "Imported book",
            "modes": meta.get("modes"),
        })
        if isinstance(meta.get("community"), str):
            book["community"] = meta["community"]
        result = await cls.ImportRows(
            payload.get("participants") or [], book=book["id"], teams=meta.get("teams"), files=files,
        )
        return {**result, "book": book["id"]}

    @classmethod
    async def ImportRows(cls, rows, replace: bool = False, book: str = MAIN_BOOK, teams=None,
                         files: dict | None = None) -> dict:
        """Bulk import full participant rows (the Export backup format) into ONE
        book — `main` unless named.

        - ``replace=True`` wipes that book's people first, then loads the rows
          exactly (a clean restore). Other books are untouched.
        - Otherwise MERGE: match each incoming row against the same book by
          start.gg userId, then by rioName. On a match, non-empty incoming
          fields win (a restore refreshes a row without dropping local-only
          fields); no match creates a new row. Never destructive in merge mode.

        A row's logo is read from ``files`` (a shared zip's contents) or an
        inline data URI; ``teams`` is an OLD file's team list, consulted only to
        find the logo a row's `team` pointed at.

        Ids are regenerated on collision so an import can't clobber an unrelated
        local row that happens to share an id. Returns a small summary.
        """
        if not isinstance(rows, list):
            return {"imported": 0, "created": 0, "updated": 0}
        if book not in cls.books:
            book = MAIN_BOOK
        legacy = cls._legacy_team_logos(teams)
        if replace:
            for r in cls.participants.values():
                if _book_of(r) == book:
                    cls._remove_logo_file(r)
            cls.participants = {
                pid: r for pid, r in cls.participants.items() if _book_of(r) != book
            }
            cls._reindex()

        created = updated = 0
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            logo = cls._logo_from(raw.get("logo") or legacy.get(raw.get("team")), files)
            incoming = cls._normalize(
                {**raw, "book": book, "logo": "", "logoRev": 0},
                raw.get("id") or _new_id(),
            )

            match = None
            if not replace:
                sg = incoming["identities"].get("startgg")
                sg_uid = sg.get("userId") if isinstance(sg, dict) else None
                rio = incoming["identities"].get("rioName")
                by_sg = cls.MatchByStartGG(sg_uid) if sg_uid else None
                if by_sg is not None and _book_of(by_sg) != book:
                    by_sg = None
                match = by_sg or (cls.MatchByRioName(rio, book=book) if rio else None)

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
                # Prefs refresh like display (incoming non-empty wins) rather
                # than fill-empty like identities: a backup's pin is the
                # producer's own most recent answer, and `None` — no preference
                # — is the empty value that defers to what is already here.
                for k, v in (incoming.get("prefs") or {}).items():
                    if v is not None:
                        match.setdefault("prefs", dict(_PREFS_DEFAULTS))[k] = v
                match["meta"]["updatedAt"] = _now()
                # Identities here only FILL EMPTY, so a matched row can gain a
                # join key it did not have. Additive, so no rebuild.
                cls._index_row(match)
                target = match
                updated += 1
            else:
                pid = incoming["id"]
                while pid in cls.participants:
                    pid = _new_id()
                incoming["id"] = pid
                cls.participants[pid] = incoming
                # Indexed inside the loop, not after it: the next row's de-dupe
                # runs `MatchByRioName` against this one, so a batch containing
                # the same person twice has to see the first copy.
                cls._index_row(incoming)
                target = incoming
                created += 1
            # A logo is display-like: the file's answer wins when it has one.
            if logo and logo[0] and len(logo[0]) <= LOGO_MAX_BYTES:
                cls._write_logo(target, *logo)

        await cls.Save()
        # ONCE, after the whole batch — a restore can rewrite hundreds of rows,
        # and each projector writes its full key set, so per-row fan-out would
        # be that many full re-projections for one import. `replace=True` makes
        # this mandatory rather than nice: it wipes the book, so every copy in
        # every projection is resolved against a registry that no longer exists.
        await cls.reproject_dependents()
        return {"imported": created + updated, "created": created, "updated": updated}

    # ----- production preferences ------------------------------------------

    @classmethod
    def PreferredSide(cls, rio_name: str) -> int | None:
        """The side this person is pinned to (1 or 2), or None for no pin.

        The `pin` layer of the side cascade reads this per HUD frame, so it goes
        through `MatchByRioName` — an in-memory scan with no IO, already blessed
        for the hot path by the resolvers that call it.
        """
        if not rio_name:
            return None
        row = cls.MatchByRioName(rio_name)
        if row is None:
            return None
        return _clean_side((row.get("prefs") or {}).get("side"))

    @classmethod
    async def adopt_legacy_pin(cls) -> bool:
        """One-shot migration of the old app-wide Player Lock onto the person.

        `project_rio.{pinned_player,pinned_side}` was a single global pair: one
        username, one side, for the whole app. It is now `prefs.side` on a
        participant, which is where the fact always lived — so this reads the
        settings pair once, writes it onto that person (adding them to the book
        if the producer never did), and clears the keys so it cannot run twice.

        Called from the lifespan, the one place both stores are in memory —
        same seam, and for the same reason, as `adopt_eventheader_message`.
        Returns True when it migrated something.
        """
        from server.settings import Settings

        pinned = (Settings.Get("project_rio.pinned_player", "") or "").strip()
        if not pinned:
            return False
        # The legacy value is the literal label "Team 1"/"Team 2" — two server
        # readers compared against that string, so the stored form is a label,
        # not a number (see the sides note in CLAUDE.md).
        side = 2 if Settings.Get("project_rio.pinned_side", "Team 1") == "Team 2" else 1

        row = cls.MatchByRioName(pinned)
        if row is None:
            row = await cls.Create({
                "identities": {"rioName": pinned},
                "display": {"tag": pinned},
                "prefs": {"side": side},
            })
        else:
            row.setdefault("prefs", dict(_PREFS_DEFAULTS))["side"] = side
            await cls.Save()

        await Settings.Set("project_rio.pinned_player", "")
        await Settings.Set("project_rio.pinned_side", "")
        logger.info(
            "[Participants] migrated the global Player Lock onto {} (side {})",
            pinned, side,
        )
        return True

    # ----- matching (the resurface loop) -----------------------------------

    @classmethod
    def MatchByRioName(cls, rio_name: str, book: str | None = None) -> dict | None:
        """Case-insensitive exact match on identities.rioName.

        A dict hit off `_by_rio` — this is the resolver the side cascade's `pin`
        layer runs per HUD frame, so it must not walk the book. Duplicate
        rioNames resolve to the earliest row, which is what the scan this
        replaced returned.

        With no `book`, a `main` row wins over any other book's; with one, only
        that book is asked.
        """
        key = _rio_key(rio_name)
        if not key:
            return None
        pid = cls._by_book_rio.get((book, key)) if book else cls._by_rio.get(key)
        return cls.participants.get(pid) if pid else None

    @classmethod
    def MatchByStartGG(cls, user_id) -> dict | None:
        """Exact match on identities.startgg.userId. The de-dupe key for
        imports — stable across name changes and re-imports. None when the
        user_id is falsy or no row carries it.

        A dict hit, like `MatchByRioName`: this one is the inner loop of the
        import merge, where the scan made a large import quadratic. Dict lookup
        agrees with the `==` the scan used for every hashable key.
        """
        if user_id in (None, ""):
            return None
        try:
            pid = cls._by_startgg.get(user_id)
        except TypeError:
            return None
        return cls.participants.get(pid) if pid else None

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
        Returns the row. Does NOT re-project: an event import calls this once
        per entrant and fans out once for the batch (``import_startgg``).
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

        # An event import fills the MAIN book: a league's book is curated (and
        # shared), so a bracket load must not reach into it.
        row = cls.MatchByStartGG(user_id)
        if row is not None and _book_of(row) != MAIN_BOOK:
            row = None
        row = row or cls.MatchByRioName(gamer_tag, book=MAIN_BOOK)

        if row is not None:
            display = row["display"]
            for src, dst in sg_to_display.items():
                val = player.get(src)
                if val and not display.get(dst):
                    display[dst] = val
            row["identities"]["startgg"] = startgg_identity
            row["meta"]["updatedAt"] = _now()
            # A row that had no start.gg link now has one, and this runs once
            # per entrant in an event import — additive, so index rather than
            # rebuild.
            cls._index_row(row)
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
        }, reproject=False)

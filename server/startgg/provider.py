"""start.gg public GraphQL API client and state provider.

Uses the unauthenticated start.gg/api/-/gql endpoint with browser-like
headers (same approach as upstream TournamentStreamHelper).
"""

import asyncio
from datetime import datetime, timezone
import re

import httpx
from loguru import logger

from server.state import State
from server.startgg import bracket_cache
from server.startgg.parsers import (
    deep as _deep,
    parse_entrant,
    parse_set,
    parse_set_full,
)
from server.startgg.queries import (
    TOURNAMENT_DATA_QUERY,
    TOURNAMENT_PHASES_QUERY,
    SETS_QUERY,
    SET_QUERY,
    ENTRANTS_QUERY,
    BRACKET_SETS_QUERY,
)


def auto_fill_entries(fields: dict[str, str], *, skip_blank: bool = False) -> list[tuple]:
    """Write start.gg-derived ``tournamentInfo`` fields without eating an edit.

    THE AUTO-FILL CONTRACT, stated once so every writer obeys it: a field is
    overwritten only while it is still EMPTY or still equal to the value we last
    filled it with (recorded per field in ``tournamentInfo._auto``). A producer
    who types over it owns it from then on, and re-blanking it re-enables the
    auto-fill.

    Two callers, and the second is why this is a function. `_load_event` brings
    back five fields once per EVENT. `apply_startgg_set` brings back a sixth —
    `phase` — once per SET, from a different path that skipped the record
    entirely and wrote unconditionally: a hand-typed "Season 9 Week 2" was
    protected against a detail-less set and destroyed by a detailed one, on every
    fixture load, silently.

    `skip_blank` is the one real difference between them. A tournament load
    reports every field it has, so a blank there is information — the event has
    no address — and clears. A set reports its phase only sometimes, so a blank
    there means "this set didn't say", and clearing would be the bug the old
    guard was written to avoid.

    The record is MERGED, never replaced: a field this call doesn't mention keeps
    what it was filled with, so reloading an event can't make the phase written
    by a set load look producer-typed.
    """
    info = State.state.get("tournamentInfo", {}) or {}
    auto = dict(info.get("_auto") or {})
    entries: list[tuple] = []
    for field, new_val in fields.items():
        new_val = (new_val or "").strip()
        if skip_blank and not new_val:
            continue
        current = info.get(field, "")
        untouched = current in ("", None) or current == auto.get(field)
        auto[field] = new_val
        if untouched and current != new_val:
            entries.append((f"tournamentInfo.{field}", new_val))
    if not entries and auto == (info.get("_auto") or {}):
        return []
    return entries + [("tournamentInfo._auto", auto)]


_API_URL = "https://www.start.gg/api/-/gql"
_HEADERS = {
    "client-version": "20",
    "Content-Type": "application/json",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}
_MAX_RETRIES = 3
_TIMEOUT = 20.0

# start.gg set states: 1=created, 2=active, 3=completed, 6=called
_ACTIVE_STATES = [1, 6, 2]
_ALL_STATES = [1, 6, 2, 3]


class StartGGProvider:
    """Singleton provider for start.gg tournament data."""

    _client: httpx.AsyncClient | None = None
    _event_slug: str | None = None
    _event_url: str | None = None
    _tournament_data: dict | None = None
    _bracket_cache: dict[int, dict] = {}  # phase_group_id -> parsed bracket dict
    # Created lazily so it binds to the RUNNING event loop, matching
    # `RioGameDataProvider._lock` and `PostGame._lock`. Built eagerly at class
    # definition this bound to whichever loop first contended for it — harmless
    # in the app (one long-lived loop) and latent in tests only because
    # `asyncio.Lock.acquire` returns early when uncontended and never asks for
    # the loop. The first test to actually contend would have got "attached to
    # a different loop" from a line nowhere near the cause.
    _load_lock: asyncio.Lock | None = None
    _restore_task: asyncio.Task | None = None
    _prefetch_task: asyncio.Task | None = None
    # Cap concurrency against the unauthenticated start.gg endpoint —
    # tournaments with many pools can have 20+ phase groups.
    _PREFETCH_CONCURRENCY = 3

    # ── lifecycle ──────────────────────────────────────────────

    @classmethod
    async def Start(cls):
        cls._client = httpx.AsyncClient(
            headers=_HEADERS,
            timeout=_TIMEOUT,
            follow_redirects=True,
        )
        # Restore event slug from persisted state so GetPhases() works after restart
        bracket_link = State.state.get("tournamentInfo", {}).get("bracket_link", "")
        if bracket_link and "start.gg" in bracket_link:
            slug = cls._parse_slug(bracket_link)
            if slug:
                cls._event_slug = slug
                cls._event_url = bracket_link
                logger.info("[startgg] restored event slug from state: {}", slug)
                # Background refresh — same pattern as RotationManager: don't
                # block startup, just shoot the API to update tournament data.
                cls._restore_task = asyncio.create_task(cls._background_refresh(bracket_link))

    @classmethod
    async def _background_refresh(cls, url: str):
        try:
            await cls.LoadEvent(url)
            logger.info("[startgg] background-refreshed tournament data on startup")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[startgg] background refresh failed")

    @classmethod
    async def Stop(cls):
        for attr in ("_restore_task", "_prefetch_task"):
            t = getattr(cls, attr)
            if t and not t.done():
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
                setattr(cls, attr, None)
        if cls._client:
            await cls._client.aclose()
            cls._client = None

    @classmethod
    async def Clear(cls):
        """Clear cached tournament data and the persisted bracket link."""
        cls._event_slug = None
        cls._event_url = None
        cls._tournament_data = None
        cls._bracket_cache = {}
        await State.SetBatch([
            ("tournamentInfo.bracket_link", ""),
            ("tournamentInfo.name", ""),
            ("tournamentInfo.event_name", ""),
            ("tournamentInfo.location", ""),
            ("tournamentInfo.date", ""),
            ("tournamentInfo.entrants", ""),
            # Reset the auto-fill record so the next load fills fields fresh.
            ("tournamentInfo._auto", {}),
        ])
        await State.Save()

    # ── core query method ──────────────────────────────────────

    @classmethod
    async def _query(cls, operation: str, query: str, variables: dict) -> dict:
        if cls._client is None:
            await cls.Start()

        payload = {
            "operationName": operation,
            "variables": variables,
            "query": query,
        }

        last_err = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                resp = await cls._client.post(_API_URL, json=payload)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                last_err = e
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(1.0 * attempt)
                    logger.warning(
                        "[startgg] query {} attempt {}/{} failed: {}",
                        operation, attempt, _MAX_RETRIES, e,
                    )

        logger.error("[startgg] query {} failed after {} retries: {}", operation, _MAX_RETRIES, last_err)
        return {}

    # ── URL parsing ────────────────────────────────────────────

    @staticmethod
    def _parse_slug(url: str) -> str | None:
        """Extract the canonical event slug from a start.gg URL.

        Handles:
          https://www.start.gg/tournament/foo/event/bar
          https://www.start.gg/tournament/foo/event/bar/overview  (trailing path stripped)
          https://start.gg/tournament/foo/event/bar
          tournament/foo/event/bar  (slug only)

        Returns the canonical "tournament/<slug>/event/<slug>" form, or None
        if the URL doesn't contain an /event/<name> segment.
        """
        m = re.search(r"tournament/([^/?#]+)/event/([^/?#]+)", url)
        if m:
            return f"tournament/{m.group(1)}/event/{m.group(2)}"
        return None

    @staticmethod
    def _has_tournament_only(url: str) -> bool:
        """True if the URL points at a tournament but has no /event/<name>."""
        return bool(re.search(r"(?:start\.gg/|^)tournament/[^/?#]+(?:/|$|\?|#)", url)) \
            and not re.search(r"tournament/[^/?#]+/event/", url)

    # ── public methods ─────────────────────────────────────────

    @classmethod
    def _lock(cls) -> asyncio.Lock:
        if cls._load_lock is None:
            cls._load_lock = asyncio.Lock()
        return cls._load_lock

    @classmethod
    async def LoadEvent(cls, url: str) -> dict:
        """Load tournament + event data from a start.gg URL and write to State."""
        async with cls._lock():
            return await cls._load_event_impl(url)

    @classmethod
    async def _load_event_impl(cls, url: str) -> dict:
        slug = cls._parse_slug(url)
        if not slug:
            if cls._has_tournament_only(url):
                return {"error": "start.gg URL is missing the event. Use a link like .../tournament/<name>/event/<event-name>"}
            return {"error": "Could not parse start.gg URL"}

        canonical_url = f"https://www.start.gg/{slug}"
        # Only invalidate caches when the event actually changes.
        if cls._event_slug != slug:
            cls._bracket_cache = {}
        cls._event_slug = slug
        cls._event_url = canonical_url

        data = await cls._query(
            "TournamentDataQuery",
            TOURNAMENT_DATA_QUERY,
            {"eventSlug": slug},
        )

        event = _deep(data, "data.event", {})
        if not event:
            cls._event_slug = None
            return {"error": "Event not found"}

        tournament = event.get("tournament", {}) or {}

        # Format date from unix timestamp
        start_ts = tournament.get("startAt")
        date_str = ""
        if start_ts:
            date_str = datetime.fromtimestamp(start_ts, tz=timezone.utc).strftime("%Y-%m-%d")

        result = {
            "tournamentName": tournament.get("name", ""),
            "eventName": event.get("name", ""),
            "numEntrants": event.get("numEntrants", 0),
            "address": tournament.get("venueAddress", ""),
            "shortLink": tournament.get("shortSlug", ""),
            "startAt": tournament.get("startAt", ""),
            "endAt": tournament.get("endAt", ""),
            "isOnline": event.get("isOnline", False),
        }

        cls._tournament_data = result

        # Write to State (same keys tournament_info.jsx subscribes to). A load may
        # be a first load or a *refresh* of an already-loaded event, and the
        # producer may have hand-edited some Info fields in between — the auto-fill
        # record is what preserves those edits (see auto_fill_entries, which the
        # per-set `phase` write shares).
        entries = auto_fill_entries({
            "name": result["tournamentName"],
            "event_name": result["eventName"],
            "location": result["address"] or ("Online" if result["isOnline"] else ""),
            "date": date_str,
            "entrants": str(result["numEntrants"]),
        })
        # Identity/derived fields always track start.gg (never producer-edited).
        entries.append(("tournamentInfo.bracket_link", canonical_url))

        await State.SetBatch(entries)
        await State.Save()

        # Warm the bracket cache in the background so phase-switching in the
        # Bracket tab is instant. Fire-and-forget — the user gets tournament
        # info immediately; brackets fill in as the prefetch completes.
        cls._start_prefetch(slug)

        return result

    @classmethod
    def _start_prefetch(cls, slug: str):
        """(Re)start the bracket-prefetch background task for the given slug."""
        if cls._prefetch_task and not cls._prefetch_task.done():
            cls._prefetch_task.cancel()
        cls._prefetch_task = asyncio.create_task(
            cls._prefetch_brackets(slug),
            name=f"startgg-prefetch-{slug}",
        )

    @classmethod
    async def _prefetch_brackets(cls, slug: str):
        """Walk every phase group of the loaded event and warm _bracket_cache.

        Bounded concurrency keeps us polite to the public start.gg endpoint.
        Bails out cleanly if the event changes mid-prefetch.
        """
        try:
            phases = await cls.GetPhases()
            if cls._event_slug != slug:
                return  # event changed while we were fetching phases

            phase_group_ids = [
                pg["id"] for phase in phases
                for pg in phase.get("phaseGroups", [])
                if pg.get("id") is not None
            ]
            if not phase_group_ids:
                return

            sem = asyncio.Semaphore(cls._PREFETCH_CONCURRENCY)

            async def fetch_one(pgid):
                async with sem:
                    if cls._event_slug != slug:
                        return
                    await cls.GetBracketData(pgid)

            results = await asyncio.gather(
                *[fetch_one(pgid) for pgid in phase_group_ids],
                return_exceptions=True,
            )
            errs = [r for r in results if isinstance(r, Exception)
                    and not isinstance(r, asyncio.CancelledError)]
            if errs:
                logger.warning(
                    "[startgg] bracket prefetch: {}/{} pools failed",
                    len(errs), len(phase_group_ids),
                )
            else:
                logger.info(
                    "[startgg] prefetched {} bracket(s)", len(phase_group_ids)
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[startgg] bracket prefetch failed")

    @classmethod
    async def GetPhases(cls) -> list:
        """Get phases and phase groups for the currently loaded event."""
        if not cls._event_slug:
            return []

        data = await cls._query(
            "TournamentPhasesQuery",
            TOURNAMENT_PHASES_QUERY,
            {"eventSlug": cls._event_slug},
        )

        phases_raw = _deep(data, "data.event.phases", [])
        if not phases_raw:
            return []

        phases = []
        for p in phases_raw:
            groups = []
            for g in _deep(p, "phaseGroups.nodes", []):
                groups.append({
                    "id": g.get("id"),
                    "displayIdentifier": g.get("displayIdentifier"),
                    "bracketType": g.get("bracketType"),
                })
            phases.append({
                "id": p.get("id"),
                "name": p.get("name"),
                "phaseGroups": groups,
            })
        return phases

    @classmethod
    async def GetSets(
        cls,
        page: int = 1,
        phase_id: int | None = None,
        phase_group_id: int | None = None,
        include_finished: bool = False,
    ) -> dict:
        """Get paginated sets for the current event.

        When the bracket cache has data for the requested phase_group_id, we
        reshape it into the /sets response format instead of hitting start.gg
        again — SETS_QUERY and BRACKET_SETS_QUERY return overlapping data, and
        the prefetch downloads it eagerly. Falls back to a live query when the
        cache misses (e.g. phase_id-only filter, prefetch hasn't finished).
        """
        if not cls._event_slug:
            return {"sets": [], "pageInfo": {"page": 1, "totalPages": 0}}

        if phase_group_id and phase_group_id in cls._bracket_cache:
            return bracket_cache.sets_from_cache(
                cls._bracket_cache[phase_group_id], page, include_finished,
            )

        states = _ALL_STATES if include_finished else _ACTIVE_STATES
        filters = {"state": states, "hideEmpty": True}
        if phase_group_id:
            filters["phaseGroupIds"] = [phase_group_id]
        elif phase_id:
            filters["phaseIds"] = [phase_id]

        data = await cls._query(
            "EventMatchListQuery",
            SETS_QUERY,
            {
                "eventSlug": cls._event_slug,
                "page": page,
                "perPage": 64,
                "filters": filters,
            },
        )

        sets_data = _deep(data, "data.event.sets", {})
        raw_sets = _deep(sets_data, "nodes", [])
        page_info = _deep(sets_data, "pageInfo", {"page": 1, "totalPages": 0})

        parsed = [parse_set(s) for s in (raw_sets or [])]

        return {
            "sets": parsed,
            "pageInfo": {
                "page": page_info.get("page", 1),
                "totalPages": page_info.get("totalPages", 0),
                "total": page_info.get("total", 0),
            },
        }

    @classmethod
    async def GetSet(cls, set_id) -> dict:
        """Get a single set by ID with full player detail.

        Accepts numeric ids (real sets, fetched with full user/profile detail via
        SetQuery) and synthetic ``preview_<phaseGroupId>_<round>_<idx>`` ids that
        start.gg hands out for an *unseeded* phase. Preview ids aren't resolvable
        through SetQuery, so we resolve them from the phase group's set list — it
        already carries entrant names, seeds and start.gg player ids, enough to
        seat a match ahead of the bracket being seeded.
        """
        if isinstance(set_id, str) and not set_id.lstrip("-").isdigit():
            return await cls._resolve_preview_set(set_id)

        data = await cls._query(
            "SetQuery",
            SET_QUERY,
            {"id": set_id},
        )

        raw = _deep(data, "data.set")
        if not raw:
            return {"error": "Set not found"}

        return parse_set_full(raw)

    @classmethod
    async def _resolve_preview_set(cls, set_id: str) -> dict:
        """Resolve a synthetic preview set id from its phase group's set list."""
        m = re.match(r"preview_(\d+)_", set_id)
        if not m:
            return {"error": "Set not found"}
        phase_group_id = int(m.group(1))
        listing = await cls.GetSets(
            phase_group_id=phase_group_id, include_finished=True,
        )
        for s in listing.get("sets", []):
            if str(s.get("id")) == str(set_id):
                return s
        return {"error": "Set not found"}

    @classmethod
    async def GetEntrants(cls, page: int = 1) -> dict:
        """Get paginated entrants for the current event."""
        if not cls._event_slug:
            return {"entrants": [], "pageInfo": {"page": 1, "totalPages": 0}}

        data = await cls._query(
            "EventEntrantsListQuery",
            ENTRANTS_QUERY,
            {"eventSlug": cls._event_slug, "page": page},
        )

        entrants_data = _deep(data, "data.event.entrants", {})
        raw = _deep(entrants_data, "nodes", [])
        page_info = _deep(entrants_data, "pageInfo", {"page": 1, "totalPages": 0})

        parsed = [parse_entrant(e) for e in (raw or [])]

        return {
            "entrants": parsed,
            "pageInfo": {
                "page": page_info.get("page", 1),
                "totalPages": page_info.get("totalPages", 0),
                "total": page_info.get("total", 0),
            },
        }

    # ── bracket data ────────────────────────────────────────────

    @classmethod
    async def GetBracketData(cls, phase_group_id: int) -> dict:
        """Fetch all sets for a phase group and structure them as bracket data.

        Returns a dict with:
          - type: bracket type (DOUBLE_ELIMINATION, SINGLE_ELIMINATION, ROUND_ROBIN)
          - phaseName: phase name + pool identifier
          - winnersRounds: {roundNum: {name, sets}} for positive rounds
          - losersRounds: {roundNum: {name, sets}} for negative rounds
          - grandFinals: list of GF sets (round numbers after last winners round)
          - players: {entrantId: {name, seed, prefix}}

        Cached per phase_group_id within the loaded event. Cache is invalidated
        on Clear() or when the event slug changes.
        """
        # Cache hit — instant phase-switching for previously-viewed brackets.
        cached = cls._bracket_cache.get(phase_group_id)
        if cached is not None:
            return cached

        # Fetch page 1 to discover total_pages, then fan out the rest in
        # parallel with asyncio.gather. For a 3-page bracket this turns
        # ~3× round-trip latency into ~2×.
        first = await cls._query(
            "BracketSetsQuery",
            BRACKET_SETS_QUERY,
            {"phaseGroupId": phase_group_id, "page": 1, "perPage": 64},
        )
        pg = _deep(first, "data.phaseGroup", {})
        if not pg:
            return {"error": "Phase group not found"}

        bracket_type = pg.get("bracketType", "DOUBLE_ELIMINATION")
        phase_name = _deep(pg, "phase.name", "")
        group_count = _deep(pg, "phase.groupCount", 0) or 0
        display_id = pg.get("displayIdentifier", "")
        total_pages = _deep(pg, "sets.pageInfo.totalPages", 1) or 1

        all_sets = list(_deep(pg, "sets.nodes", []) or [])

        if total_pages > 1:
            rest = await asyncio.gather(*[
                cls._query(
                    "BracketSetsQuery",
                    BRACKET_SETS_QUERY,
                    {"phaseGroupId": phase_group_id, "page": p, "perPage": 64},
                )
                for p in range(2, total_pages + 1)
            ])
            for page_data in rest:
                nodes = _deep(page_data, "data.phaseGroup.sets.nodes", [])
                all_sets.extend(nodes or [])

        # Build phase label
        label = phase_name
        if group_count > 1 and display_id:
            label = f"{phase_name} - Pool {display_id}"

        result = bracket_cache.structure_bracket(
            phase_group_id, bracket_type, label, all_sets,
        )
        cls._bracket_cache[phase_group_id] = result
        return result

    @classmethod
    async def LoadBracket(cls, phase_group_id: int) -> dict:
        """Fetch bracket data and write it to State for OBS overlays."""
        bracket_data = await cls.GetBracketData(phase_group_id)
        if "error" in bracket_data:
            return bracket_data

        # Write entire bracket structure to State
        await State.Set("bracket", bracket_data)
        await State.Save()

        return bracket_data

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
from server.startgg.queries import (
    TOURNAMENT_DATA_QUERY,
    TOURNAMENT_PHASES_QUERY,
    SETS_QUERY,
    SET_QUERY,
    ENTRANTS_QUERY,
    ENTRANT_QUERY,
    BRACKET_SETS_QUERY,
)

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


def _deep(obj, path, default=None):
    """Synchronous deep-get for parsing GraphQL responses."""
    for key in path.split("."):
        if not isinstance(obj, dict):
            return default
        obj = obj.get(key, default)
    return obj


class StartGGProvider:
    """Singleton provider for start.gg tournament data."""

    _client: httpx.AsyncClient | None = None
    _event_slug: str | None = None
    _event_url: str | None = None
    _tournament_data: dict | None = None
    _bracket_cache: dict[int, dict] = {}  # phase_group_id -> parsed bracket dict
    _load_lock: asyncio.Lock = asyncio.Lock()
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
    async def LoadEvent(cls, url: str) -> dict:
        """Load tournament + event data from a start.gg URL and write to State."""
        async with cls._load_lock:
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
        # producer may have hand-edited some Info fields in between. Preserve those
        # edits: only overwrite a field when it's still empty or untouched since the
        # last auto-fill (tracked in tournamentInfo._auto). start.gg's value always
        # updates the auto-record, so re-blanking a field re-enables auto-fill.
        info = State.state.get("tournamentInfo", {}) or {}
        prev_auto = info.get("_auto", {}) or {}
        new_auto: dict[str, str] = {}
        entries = []

        def merge(field: str, new_val: str):
            new_auto[field] = new_val
            current = info.get(field, "")
            untouched = current in ("", None) or current == prev_auto.get(field)
            if untouched and current != new_val:
                entries.append((f"tournamentInfo.{field}", new_val))

        merge("name", result["tournamentName"])
        merge("event_name", result["eventName"])
        merge("location", result["address"] or ("Online" if result["isOnline"] else ""))
        merge("date", date_str)
        merge("entrants", str(result["numEntrants"]))
        # Identity/derived fields always track start.gg (never producer-edited).
        entries.append(("tournamentInfo.bracket_link", canonical_url))
        entries.append(("tournamentInfo._auto", new_auto))

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
            return cls._sets_from_bracket_cache(
                phase_group_id, page, include_finished,
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

        parsed = [cls._parse_set(s) for s in (raw_sets or [])]

        return {
            "sets": parsed,
            "pageInfo": {
                "page": page_info.get("page", 1),
                "totalPages": page_info.get("totalPages", 0),
                "total": page_info.get("total", 0),
            },
        }

    @classmethod
    def _sets_from_bracket_cache(
        cls,
        phase_group_id: int,
        page: int,
        include_finished: bool,
    ) -> dict:
        """Reshape cached bracket data into the paginated /sets response shape.

        The bracket cache stores sets organized by round (winners/losers/GF)
        with players in a separate lookup. /sets wants a flat list with
        per-set p1_name/p2_name/seeds. We flatten, look up player names, and
        apply the same filtering and pagination the API path would.
        """
        cached = cls._bracket_cache[phase_group_id]
        bracket_type = cached.get("type", "")
        phase_label = cached.get("phaseName", "")
        players = cached.get("players", {}) or {}

        # Walk every round bucket. Losers rounds were stored as abs(round_num)
        # so we re-flip the sign to preserve winners-vs-losers info downstream.
        flat: list[tuple[int, dict]] = []
        for r, round_data in (cached.get("winnersRounds") or {}).items():
            rn = int(r)
            for s in round_data.get("sets", []) or []:
                flat.append((rn, s))
        for r, round_data in (cached.get("losersRounds") or {}).items():
            rn = -int(r)
            for s in round_data.get("sets", []) or []:
                flat.append((rn, s))
        # Grand finals come after winners; use a large positive sentinel so
        # they sort last among positive rounds.
        for s in cached.get("grandFinals") or []:
            flat.append((9999, s))

        if not include_finished:
            flat = [(rn, s) for (rn, s) in flat
                    if s.get("state") != "completed"]

        # Sort: live/called first, then pending, then complete; tie-break by
        # round magnitude so earlier rounds appear first within a state group.
        state_order = {"active": 0, "called": 0, "created": 1, "completed": 2}
        flat.sort(key=lambda rs: (state_order.get(rs[1].get("state"), 9), abs(rs[0])))

        def _cache_players(pdict: dict) -> list[dict]:
            """One side's player list from the bracket cache's lookup (name only —
            no start.gg player id here, but enough to seat a match by name)."""
            if not pdict:
                return []
            return [{
                "gamerTag": pdict.get("name", ""),
                "prefix": pdict.get("prefix", "") or "",
                "playerId": None,
            }]

        parsed: list[dict] = []
        for rn, s in flat:
            p1 = players.get(str(s.get("entrant1Id") or ""), {}) or {}
            p2 = players.get(str(s.get("entrant2Id") or ""), {}) or {}
            parsed.append({
                "id": s.get("id"),
                "team1score": s.get("score1"),
                "team2score": s.get("score2"),
                "round_name": s.get("roundName", ""),
                "round": rn,
                "tournament_phase": phase_label,
                "bracket_type": bracket_type,
                "p1_name": p1.get("name", ""),
                "p2_name": p2.get("name", ""),
                "p1_seed": p1.get("seed"),
                "p2_seed": p2.get("seed"),
                "state": s.get("state", ""),
                # Consumable shape (mirrors _parse_set_full) so a set fetched from
                # the cache can seat a match directly — needed for preview sets.
                "entrants": [_cache_players(p1), _cache_players(p2)],
                "seeds": [p1.get("seed"), p2.get("seed")],
                "entrant_ids": [s.get("entrant1Id"), s.get("entrant2Id")],
                "totalGames": s.get("totalGames"),
            })

        per_page = 64
        total = len(parsed)
        total_pages = max(1, (total + per_page - 1) // per_page)
        start = max(0, (page - 1) * per_page)
        page_items = parsed[start:start + per_page]

        return {
            "sets": page_items,
            "pageInfo": {
                "page": page,
                "totalPages": total_pages,
                "total": total,
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

        return cls._parse_set_full(raw)

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
    async def GetEntrant(cls, entrant_id: int) -> dict | None:
        """Fetch a single entrant by ID with full user profile data."""
        data = await cls._query(
            "EntrantQuery",
            ENTRANT_QUERY,
            {"id": entrant_id},
        )
        raw = _deep(data, "data.entrant")
        if not raw:
            return None
        return cls._parse_entrant(raw)

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

        parsed = [cls._parse_entrant(e) for e in (raw or [])]

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
        phase_label = phase_name
        if group_count > 1 and display_id:
            phase_label = f"{phase_name} - Pool {display_id}"

        # Build player lookup and organize sets by round
        players = {}
        rounds_map = {}  # round_number -> list of sets

        for raw in all_sets:
            round_num = raw.get("round", 0)
            if round_num not in rounds_map:
                rounds_map[round_num] = {
                    "name": raw.get("fullRoundText", f"Round {round_num}"),
                    "sets": [],
                }

            slots = raw.get("slots", [])
            entrant1 = _deep(slots[0], "entrant") if len(slots) > 0 else None
            entrant2 = _deep(slots[1], "entrant") if len(slots) > 1 else None

            # Track players
            for entrant in [entrant1, entrant2]:
                if entrant and entrant.get("id"):
                    eid = str(entrant["id"])
                    if eid not in players:
                        participants = entrant.get("participants", []) or []
                        p = participants[0].get("player", {}) if participants else {}
                        players[eid] = {
                            "name": p.get("gamerTag") or entrant.get("name", ""),
                            "seed": entrant.get("initialSeedNum"),
                            "prefix": p.get("prefix", "") or "",
                        }

            # Score handling (same W/L logic as _parse_set)
            p1_slot = slots[0] if len(slots) > 0 else {}
            p2_slot = slots[1] if len(slots) > 1 else {}
            score1 = raw.get("entrant1Score")
            score2 = raw.get("entrant2Score")
            p1_placement = _deep(p1_slot, "standing.placement")
            p2_placement = _deep(p2_slot, "standing.placement")
            p1_standing_score = _deep(p1_slot, "standing.stats.score.value")
            p2_standing_score = _deep(p2_slot, "standing.stats.score.value")

            if score1 is None and score2 is None and p1_placement is not None:
                score1 = "W" if p1_placement == 1 else "L" if p1_placement == 2 else None
                score2 = "W" if p2_placement == 1 else "L" if p2_placement == 2 else None
            elif score1 is None and p1_standing_score is not None:
                score1 = p1_standing_score
                score2 = p2_standing_score

            # State
            state_map = {1: "created", 2: "active", 3: "completed", 6: "called"}

            set_data = {
                "id": raw.get("id"),
                "identifier": raw.get("identifier", ""),
                "entrant1Id": str(entrant1["id"]) if entrant1 and entrant1.get("id") else None,
                "entrant2Id": str(entrant2["id"]) if entrant2 and entrant2.get("id") else None,
                "score1": score1,
                "score2": score2,
                "totalGames": raw.get("totalGames"),
                "state": state_map.get(raw.get("state"), str(raw.get("state", ""))),
                "completed": raw.get("state") == 3,
                "roundName": raw.get("fullRoundText", ""),
            }
            rounds_map[round_num]["sets"].append(set_data)

        # Separate into winners, losers, and grand finals
        winners_rounds = {}
        losers_rounds = {}
        grand_finals = []

        if bracket_type == "DOUBLE_ELIMINATION":
            # Positive rounds = winners, negative = losers
            # The highest positive rounds may be Grand Finals
            positive_rounds = sorted([r for r in rounds_map if r > 0])
            negative_rounds = sorted([r for r in rounds_map if r < 0], key=lambda x: abs(x))

            # In double-elim, grand finals are typically the last 1-2 positive rounds
            # after the main winners bracket. Detect by round name containing "Grand Final"
            for r in positive_rounds:
                round_data = rounds_map[r]
                is_gf = any("Grand Final" in s.get("roundName", "") for s in round_data["sets"])
                if is_gf:
                    grand_finals.extend(round_data["sets"])
                else:
                    winners_rounds[r] = round_data

            for r in negative_rounds:
                losers_rounds[abs(r)] = rounds_map[r]
        elif bracket_type == "SINGLE_ELIMINATION":
            for r in sorted(rounds_map.keys()):
                if r > 0:
                    winners_rounds[r] = rounds_map[r]
        else:
            # Round robin or other — just put everything in winners
            for r in sorted(rounds_map.keys()):
                winners_rounds[r] = rounds_map[r]

        result = {
            "type": bracket_type,
            "phaseName": phase_label,
            "phaseGroupId": phase_group_id,
            "winnersRounds": winners_rounds,
            "losersRounds": losers_rounds,
            "grandFinals": grand_finals,
            "players": players,
        }

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

    # ── parsing helpers ────────────────────────────────────────

    @staticmethod
    def _parse_set(raw: dict) -> dict:
        """Parse a set from the paginated sets query (minimal player detail)."""
        slots = raw.get("slots", [])
        p1 = slots[0] if len(slots) > 0 else {}
        p2 = slots[1] if len(slots) > 1 else {}

        phase_name = _deep(raw, "phaseGroup.phase.name", "")
        group_count = _deep(raw, "phaseGroup.phase.groupCount", 0) or 0
        if group_count > 1:
            display_id = _deep(raw, "phaseGroup.displayIdentifier", "")
            if display_id:
                phase_name = f"{phase_name} - Pool {display_id}"

        def entrant_name(slot):
            e = slot.get("entrant")
            if not e:
                return ""
            return e.get("name", "")

        def entrant_seed(slot):
            e = slot.get("entrant")
            if not e:
                return None
            return e.get("initialSeedNum")

        def entrant_players(slot):
            """Per-side player list (gamerTag/prefix/playerId) — the sets-list
            query carries participants[].player, enough to seat a match from a
            *preview* set that GetSet can't fetch by id. Falls back to the
            entrant display name when participant detail is absent."""
            e = slot.get("entrant") or {}
            out = []
            for part in (e.get("participants") or []):
                pl = part.get("player") or {}
                out.append({
                    "gamerTag": pl.get("gamerTag") or e.get("name") or "",
                    "prefix": pl.get("prefix") or "",
                    "playerId": pl.get("id"),
                })
            if not out and e.get("name"):
                out.append({"gamerTag": e.get("name"), "prefix": "", "playerId": None})
            return out

        # State: 1=created, 2=active, 3=completed, 6=called
        state_map = {1: "created", 2: "active", 3: "completed", 6: "called"}

        # Scores: use entrantNScore if available, otherwise derive W/L from standing
        team1score = raw.get("entrant1Score")
        team2score = raw.get("entrant2Score")
        p1_placement = _deep(p1, "standing.placement")
        p2_placement = _deep(p2, "standing.placement")
        p1_standing_score = _deep(p1, "standing.stats.score.value")
        p2_standing_score = _deep(p2, "standing.stats.score.value")

        # If numeric scores are null but standings exist, use W/L
        wl_only = (team1score is None and team2score is None
                   and p1_placement is not None)
        if wl_only:
            team1score = "W" if p1_placement == 1 else "L" if p1_placement == 2 else None
            team2score = "W" if p2_placement == 1 else "L" if p2_placement == 2 else None
        elif team1score is None and p1_standing_score is not None:
            team1score = p1_standing_score
            team2score = p2_standing_score

        return {
            "id": raw.get("id"),
            "team1score": team1score,
            "team2score": team2score,
            "round_name": raw.get("fullRoundText", ""),
            "round": raw.get("round"),
            "tournament_phase": phase_name,
            "bracket_type": _deep(raw, "phaseGroup.phase.bracketType", ""),
            "p1_name": entrant_name(p1),
            "p2_name": entrant_name(p2),
            "p1_seed": entrant_seed(p1),
            "p2_seed": entrant_seed(p2),
            "state": state_map.get(raw.get("state"), str(raw.get("state", ""))),
            # Consumable shape (mirrors _parse_set_full) so a list set — including
            # a preview set from an unseeded phase — can seat a match directly.
            "entrants": [entrant_players(p1), entrant_players(p2)],
            "seeds": [entrant_seed(p1), entrant_seed(p2)],
            "entrant_ids": [
                (p1.get("entrant") or {}).get("id"),
                (p2.get("entrant") or {}).get("id"),
            ],
            "totalGames": raw.get("totalGames"),
        }

    @staticmethod
    def _parse_set_full(raw: dict) -> dict:
        """Parse a single set with full player detail (from SetQuery)."""
        slots = raw.get("slots", [])
        p1 = slots[0] if len(slots) > 0 else {}
        p2 = slots[1] if len(slots) > 1 else {}

        phase_name = _deep(raw, "phaseGroup.phase.name", "")
        group_count = _deep(raw, "phaseGroup.phase.groupCount", 0) or 0
        if group_count > 1:
            display_id = _deep(raw, "phaseGroup.displayIdentifier", "")
            if display_id:
                phase_name = f"{phase_name} - Pool {display_id}"

        # Scores: use entrantNScore if available, otherwise derive W/L from standing
        team1score = raw.get("entrant1Score")
        team2score = raw.get("entrant2Score")
        p1_placement = _deep(p1, "standing.placement")
        p2_placement = _deep(p2, "standing.placement")
        p1_standing_score = _deep(p1, "standing.stats.score.value")
        p2_standing_score = _deep(p2, "standing.stats.score.value")

        wl_only = (team1score is None and team2score is None
                   and p1_placement is not None)
        if wl_only:
            team1score = "W" if p1_placement == 1 else "L" if p1_placement == 2 else None
            team2score = "W" if p2_placement == 1 else "L" if p2_placement == 2 else None
        elif team1score is None and p1_standing_score is not None:
            team1score = p1_standing_score
            team2score = p2_standing_score

        set_data = {
            "id": raw.get("id"),
            "team1score": team1score,
            "team2score": team2score,
            "round_name": raw.get("fullRoundText", ""),
            "round": raw.get("round"),
            "totalGames": raw.get("totalGames"),
            "tournament_phase": phase_name,
            "bracket_type": _deep(raw, "phaseGroup.phase.bracketType", ""),
        }

        entrant_ids = []
        entrants = [[], []]
        seeds = [None, None]
        for i, slot in enumerate([p1, p2]):
            if i > 1:
                break
            entrant = slot.get("entrant")
            if not entrant:
                entrant_ids.append(None)
                continue
            seeds[i] = entrant.get("initialSeedNum")
            entrant_ids.append(entrant.get("id"))
            participants = entrant.get("participants", []) or []
            for participant in participants:
                player = participant.get("player", {}) or {}
                user = participant.get("user", {}) or {}

                player_data = {
                    "gamerTag": player.get("gamerTag", ""),
                    "prefix": player.get("prefix", ""),
                    "playerId": player.get("id"),
                }

                if user:
                    if user.get("id") is not None:
                        player_data["userId"] = user["id"]
                    if user.get("slug"):
                        player_data["userSlug"] = user["slug"]
                    if user.get("name"):
                        player_data["full_name"] = user["name"]
                    if user.get("genderPronoun"):
                        player_data["pronoun"] = user["genderPronoun"]
                    auths = user.get("authorizations", []) or []
                    if auths:
                        player_data["twitter"] = auths[0].get("externalUsername", "")
                    if user.get("images"):
                        player_data["avatar"] = user["images"][0].get("url", "")
                    loc = user.get("location", {}) or {}
                    if loc.get("country"):
                        player_data["country"] = loc["country"]
                    if loc.get("state"):
                        player_data["state"] = loc["state"]
                    if loc.get("city"):
                        player_data["city"] = loc["city"]

                entrants[i].append(player_data)

        set_data["entrants"] = entrants
        set_data["entrant_ids"] = entrant_ids
        set_data["seeds"] = seeds
        return set_data

    @staticmethod
    def _parse_entrant(raw: dict) -> dict:
        """Parse an entrant from the entrants query."""
        result = {
            "id": raw.get("id"),
            "name": raw.get("name", ""),
            "seed": raw.get("initialSeedNum"),
        }

        participants = raw.get("participants", []) or []
        players = []
        for p in participants:
            player = p.get("player", {}) or {}
            user = p.get("user", {}) or {}
            pd = {
                "gamerTag": player.get("gamerTag", ""),
                "prefix": player.get("prefix", ""),
                "playerId": player.get("id"),
            }
            if user:
                if user.get("id") is not None:
                    pd["userId"] = user["id"]
                if user.get("slug"):
                    pd["userSlug"] = user["slug"]
                if user.get("name"):
                    pd["full_name"] = user["name"]
                if user.get("genderPronoun"):
                    pd["pronoun"] = user["genderPronoun"]
                auths = user.get("authorizations", []) or []
                if auths:
                    pd["twitter"] = auths[0].get("externalUsername", "")
                loc = user.get("location", {}) or {}
                if loc.get("country"):
                    pd["country"] = loc["country"]
                if loc.get("state"):
                    pd["state"] = loc["state"]
                if loc.get("city"):
                    pd["city"] = loc["city"]
            players.append(pd)

        result["players"] = players
        return result

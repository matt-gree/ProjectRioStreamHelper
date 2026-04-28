"""start.gg public GraphQL API client and state provider.

Uses the unauthenticated start.gg/api/-/gql endpoint with browser-like
headers (same approach as upstream TournamentStreamHelper).
"""

import asyncio
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
    _entrants_cache: dict | None = None  # {gamerTag_lower: parsed_player_dict}
    _load_lock: asyncio.Lock = asyncio.Lock()
    _restore_task: asyncio.Task | None = None

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
        if cls._restore_task and not cls._restore_task.done():
            cls._restore_task.cancel()
            try:
                await cls._restore_task
            except (asyncio.CancelledError, Exception):
                pass
            cls._restore_task = None
        if cls._client:
            await cls._client.aclose()
            cls._client = None

    @classmethod
    async def Clear(cls):
        """Clear cached tournament data and the persisted bracket link."""
        cls._event_slug = None
        cls._event_url = None
        cls._tournament_data = None
        cls._entrants_cache = None
        await State.SetBatch([
            ("tournamentInfo.bracket_link", ""),
            ("tournamentInfo.name", ""),
            ("tournamentInfo.location", ""),
            ("tournamentInfo.date", ""),
            ("tournamentInfo.entrants", ""),
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
        # Only invalidate the entrants cache when the event actually changes.
        if cls._event_slug != slug:
            cls._entrants_cache = None
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
            from datetime import datetime, timezone
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

        # Write to State (same keys tournament_info.jsx subscribes to)
        entries = [
            ("tournamentInfo.name", result["tournamentName"]),
            ("tournamentInfo.location", result["address"] or ("Online" if result["isOnline"] else "")),
            ("tournamentInfo.date", date_str),
            ("tournamentInfo.entrants", str(result["numEntrants"])),
            ("tournamentInfo.bracket_link", canonical_url),
        ]
        await State.SetBatch(entries)
        await State.Save()

        return result

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
        """Get paginated sets for the current event."""
        if not cls._event_slug:
            return {"sets": [], "pageInfo": {"page": 1, "totalPages": 0}}

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
    async def GetSet(cls, set_id: int) -> dict:
        """Get a single set by ID with full player detail."""
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

    @classmethod
    async def _ensure_entrants_cache(cls):
        """Build a lookup of all entrants by gamerTag (lowercase).

        Fetches all pages from the entrants endpoint (which reliably returns
        user profile data on the public API) and caches them for the duration
        of the loaded event.
        """
        if cls._entrants_cache is not None:
            return

        if not cls._event_slug:
            cls._entrants_cache = {}
            return

        cache = {}
        page = 1
        while True:
            result = await cls.GetEntrants(page)
            for entrant in result.get("entrants", []):
                for p in entrant.get("players", []):
                    tag = (p.get("gamerTag") or "").lower()
                    if tag:
                        cache[tag] = p
            total_pages = result.get("pageInfo", {}).get("totalPages", 0)
            if page >= total_pages:
                break
            page += 1

        cls._entrants_cache = cache
        logger.info("[startgg] entrants cache built: {} players", len(cache))

    @classmethod
    async def LoadSetIntoScoreboard(cls, set_id: int, scoreboard_number: int = 1) -> dict:
        """Fetch a set and write player tags + scores into the scoreboard state.

        Writes to name/team/profile fields — does NOT touch rioName, character,
        or game state (inning, outs, etc.).
        """
        set_data = await cls.GetSet(set_id)
        if "error" in set_data:
            return set_data

        # Build entrants cache so we can cross-reference profile data
        await cls._ensure_entrants_cache()

        sb = scoreboard_number
        entrants = set_data.get("entrants", [[], []])

        entries = []

        # Player tags, prefixes, and profile data
        for team_idx in range(2):
            team_num = team_idx + 1
            players = entrants[team_idx] if team_idx < len(entrants) else []
            if players:
                p = players[0]  # First (primary) player
                tag = (p.get("gamerTag") or "").lower()

                # Cross-reference with entrants cache for profile data
                cached = cls._entrants_cache.get(tag) if cls._entrants_cache else None
                if cached:
                    for key in ("full_name", "pronoun", "country", "state", "city", "twitter"):
                        if cached.get(key):
                            p[key] = cached[key]

                base = f"score.{sb}.player.{team_num}"
                entries.append((f"{base}.name", p.get("gamerTag", "")))
                entries.append((f"{base}.team", p.get("prefix", "") or ""))
                entries.append((f"{base}.full_name", p.get("full_name", "")))
                entries.append((f"{base}.country", p.get("country", "")))
                entries.append((f"{base}.state", p.get("state", "")))
                entries.append((f"{base}.pronoun", p.get("pronoun", "")))

        # Scores — map W/L to 1/0 for the numeric scoreboard
        t1s = set_data.get("team1score")
        t2s = set_data.get("team2score")
        if t1s == "W":
            t1s, t2s = 1, 0
        elif t2s == "W":
            t1s, t2s = 0, 1
        entries.append((f"score.{sb}.score_left", t1s if isinstance(t1s, (int, float)) else 0))
        entries.append((f"score.{sb}.score_right", t2s if isinstance(t2s, (int, float)) else 0))

        # Phase and round
        if set_data.get("tournament_phase"):
            entries.append((f"score.{sb}.phase", set_data["tournament_phase"]))
        if set_data.get("round_name"):
            entries.append((f"score.{sb}.match", set_data["round_name"]))

        await State.SetBatch(entries)
        await State.Save()

        return {"success": True, "set": set_data}

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
        """
        all_sets = []
        page = 1
        bracket_type = None
        phase_name = ""
        display_id = ""
        group_count = 0

        while True:
            data = await cls._query(
                "BracketSetsQuery",
                BRACKET_SETS_QUERY,
                {"phaseGroupId": phase_group_id, "page": page, "perPage": 64},
            )

            pg = _deep(data, "data.phaseGroup", {})
            if not pg:
                return {"error": "Phase group not found"}

            if bracket_type is None:
                bracket_type = pg.get("bracketType", "DOUBLE_ELIMINATION")
                phase_name = _deep(pg, "phase.name", "")
                group_count = _deep(pg, "phase.groupCount", 0) or 0
                display_id = pg.get("displayIdentifier", "")

            nodes = _deep(pg, "sets.nodes", [])
            all_sets.extend(nodes or [])

            total_pages = _deep(pg, "sets.pageInfo.totalPages", 1)
            if page >= total_pages:
                break
            page += 1

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

        return {
            "type": bracket_type,
            "phaseName": phase_label,
            "phaseGroupId": phase_group_id,
            "winnersRounds": winners_rounds,
            "losersRounds": losers_rounds,
            "grandFinals": grand_finals,
            "players": players,
        }

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
            "tournament_phase": phase_name,
            "bracket_type": _deep(raw, "phaseGroup.phase.bracketType", ""),
        }

        entrant_ids = []
        entrants = [[], []]
        for i, slot in enumerate([p1, p2]):
            if i > 1:
                break
            entrant = slot.get("entrant")
            if not entrant:
                entrant_ids.append(None)
                continue
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

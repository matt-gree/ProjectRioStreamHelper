"""Challonge v2.1 API client and state provider.

Uses the Challonge v2.1 JSON:API with a v1 API key for auth.
Community tournaments are accessed via the community permalink path.
Mirrors the StartGGProvider interface so the frontend can treat
both tournament sources identically.
"""

import asyncio
import re

import httpx
from loguru import logger

from server.settings import Settings
from server.state import State
from server.utils.keyring import decrypt_key

_API_URL = "https://api.challonge.com/v2.1"
_TIMEOUT = 20.0
_MAX_RETRIES = 3

# Challonge match states → our normalized states
_STATE_MAP = {
    "pending": "created",
    "open": "active",
    "complete": "completed",
}


def _parse_scores(scores_str: str | None) -> tuple:
    """Parse a v2 scores string like '10 - 3' or '0 - 0' into (int, int)."""
    if not scores_str:
        return None, None
    parts = scores_str.split("-")
    if len(parts) == 2:
        try:
            return int(parts[0].strip()), int(parts[1].strip())
        except ValueError:
            return None, None
    return None, None


class ChallongeProvider:
    """Singleton provider for Challonge tournament data (v2.1 API)."""

    _client: httpx.AsyncClient | None = None
    _tournament_slug: str | None = None
    _tournament_url: str | None = None
    _tournament_data: dict | None = None
    _tournament_id: int | None = None
    _community_permalink: str | None = None

    # Cached data
    _participants: list | None = None
    _participants_by_id: dict | None = None
    _matches: list | None = None

    # ── lifecycle ──────────────────────────────────────────────

    @classmethod
    async def Start(cls):
        cls._client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            follow_redirects=True,
        )

        # Restore slug from persisted state
        bracket_link = State.state.get("tournamentInfo", {}).get("bracket_link", "")
        if bracket_link and "challonge" in bracket_link:
            slug, _ = cls._parse_url(bracket_link)
            if slug:
                cls._tournament_slug = slug
                cls._tournament_url = bracket_link
                logger.info("[challonge] restored slug from state: {}", slug)

    @classmethod
    async def Stop(cls):
        if cls._client:
            await cls._client.aclose()
            cls._client = None

    # ── core request method ───────────────────────────────────

    @classmethod
    async def _request(cls, path: str, params: dict | None = None) -> dict | list:
        if cls._client is None:
            await cls.Start()

        raw_key = await Settings.Get("challonge.api_key", "")
        api_key = decrypt_key(raw_key)
        if not api_key:
            return {"error": "Challonge API key not configured. Set it in Settings → Challonge."}

        headers = {
            "Authorization-Type": "v1",
            "Authorization": api_key,
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/json",
        }

        url = f"{_API_URL}{path}"

        last_err = None
        for attempt in range(1, _MAX_RETRIES + 1):
            try:
                resp = await cls._client.get(url, headers=headers, params=params)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    return {"error": "Invalid Challonge API key"}
                if e.response.status_code == 404:
                    return {"error": "Tournament not found on Challonge"}
                last_err = e
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(1.0 * attempt)
                    logger.warning(
                        "[challonge] request {} attempt {}/{} failed: {}",
                        path, attempt, _MAX_RETRIES, e,
                    )
            except Exception as e:
                last_err = e
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(1.0 * attempt)
                    logger.warning(
                        "[challonge] request {} attempt {}/{} failed: {}",
                        path, attempt, _MAX_RETRIES, e,
                    )

        logger.error("[challonge] request {} failed after {} retries: {}", path, _MAX_RETRIES, last_err)
        return {"error": f"Challonge API request failed: {last_err}"}

    # ── URL parsing ───────────────────────────────────────────

    @staticmethod
    def _parse_url(url: str) -> tuple[str | None, str | None]:
        """Extract tournament slug and optional subdomain from a Challonge URL.

        Returns (slug, subdomain) or (None, None).
        """
        m = re.search(r"(?:https?://)?(?:(\w+)\.)?challonge\.com/(?:tournaments/)?([^/?#]+)", url)
        if m:
            subdomain = m.group(1)
            slug = m.group(2)
            if subdomain == "www":
                subdomain = None
            # Skip community URLs
            if slug == "communities":
                return None, None
            return slug, subdomain
        return None, None

    # ── community + tournament discovery ──────────────────────

    @classmethod
    async def _find_tournament(cls, slug: str) -> dict | None:
        """Find a tournament by slug across the user's direct tournaments and communities.

        Returns the v2 tournament data dict or None.
        """
        # 1) Try direct tournament lookup (for tournaments the user directly owns)
        data = await cls._request(f"/tournaments/{slug}.json")
        if isinstance(data, dict) and "data" in data:
            t = data["data"]
            attrs = t.get("attributes", {})
            if attrs.get("url") == slug or attrs.get("name"):
                cls._tournament_id = int(t["id"])
                cls._community_permalink = None
                return data

        # 2) Search across communities
        communities = await cls._request("/communities.json", {"per_page": 100})
        if isinstance(communities, dict) and "error" not in communities:
            for comm in communities.get("data", []):
                permalink = comm.get("attributes", {}).get("permalink", "")
                if not permalink:
                    continue

                # List tournaments in this community
                comm_tournaments = await cls._request(
                    f"/communities/{permalink}/tournaments.json",
                    {"per_page": 200},
                )
                if isinstance(comm_tournaments, dict) and "error" not in comm_tournaments:
                    for t in comm_tournaments.get("data", []):
                        if t.get("attributes", {}).get("url") == slug:
                            cls._tournament_id = int(t["id"])
                            cls._community_permalink = permalink
                            logger.info(
                                "[challonge] found {} in community {} (ID {})",
                                slug, permalink, cls._tournament_id,
                            )
                            # Fetch full tournament details through community path
                            full = await cls._request(
                                f"/communities/{permalink}/tournaments/{cls._tournament_id}.json"
                            )
                            if isinstance(full, dict) and "data" in full:
                                return full
                            # Fall back to the listing data
                            return {"data": t}

        return None

    @classmethod
    def _tournament_path(cls) -> str:
        """Build the API path prefix for the current tournament."""
        if cls._community_permalink:
            return f"/communities/{cls._community_permalink}/tournaments/{cls._tournament_id}"
        return f"/tournaments/{cls._tournament_id}"

    # ── public methods (mirror StartGGProvider interface) ─────

    @classmethod
    async def LoadEvent(cls, url: str) -> dict:
        """Load tournament data from a Challonge URL and write to State."""
        slug, subdomain = cls._parse_url(url)
        if not slug:
            return {"error": "Could not parse Challonge URL"}

        cls._tournament_slug = slug
        cls._tournament_url = url
        cls._participants = None
        cls._participants_by_id = None
        cls._matches = None
        cls._tournament_id = None
        cls._community_permalink = None

        # Find the tournament (may require searching communities)
        tournament_resp = await cls._find_tournament(slug)
        if not tournament_resp:
            cls._tournament_slug = None
            return {"error": f"Tournament '{slug}' not found. Check the URL and ensure your API key has access."}

        t = tournament_resp.get("data", {})
        attrs = t.get("attributes", {})

        # Format date
        date_str = ""
        timestamps = attrs.get("timestamps", {})
        starts_at = attrs.get("starts_at") or timestamps.get("started_at", "")
        if starts_at:
            date_str = str(starts_at)[:10]

        num_entrants = attrs.get("participants_count", 0)
        tournament_type = attrs.get("tournament_type", "")
        group_stage_enabled = attrs.get("group_stage_enabled", False)

        result = {
            "tournamentName": attrs.get("name", ""),
            "eventName": "",
            "numEntrants": num_entrants,
            "address": "",
            "shortLink": attrs.get("full_challonge_url", url),
            "startAt": starts_at,
            "endAt": timestamps.get("completed_at", ""),
            "isOnline": True,
            "tournamentType": tournament_type,
            "groupStagesEnabled": group_stage_enabled,
        }

        cls._tournament_data = result

        entries = [
            ("tournamentInfo.name", result["tournamentName"]),
            ("tournamentInfo.location", ""),
            ("tournamentInfo.date", date_str),
            ("tournamentInfo.entrants", str(num_entrants)),
            ("tournamentInfo.bracket_link", url),
        ]
        await State.SetBatch(entries)
        await State.Save()

        # Pre-fetch participants and matches (2 API calls)
        await cls._ensure_data()

        return result

    @classmethod
    async def GetPhases(cls) -> list:
        """Return virtual phases from the Challonge tournament structure."""
        if not cls._tournament_slug:
            return []

        if cls._participants is None:
            await cls._ensure_data()

        group_stages = cls._tournament_data and cls._tournament_data.get("groupStagesEnabled", False)

        if group_stages and cls._participants:
            # Collect unique group_ids from participants
            group_ids = set()
            for p in cls._participants:
                gid = p.get("group_id")
                if gid:
                    group_ids.add(gid)

            phases = []

            if group_ids:
                groups = []
                for gid in sorted(group_ids):
                    groups.append({
                        "id": gid,
                        "displayIdentifier": str(chr(64 + len(groups) + 1)),  # A, B, C...
                        "bracketType": "ROUND_ROBIN",
                    })
                phases.append({
                    "id": "groups",
                    "name": "Group Stage",
                    "phaseGroups": groups,
                })

            # Finals — always present if there are matches
            if cls._matches:
                bracket_type = cls._bracket_type_for_finals()
                phases.append({
                    "id": "finals",
                    "name": "Final Stage",
                    "phaseGroups": [{
                        "id": "finals",
                        "displayIdentifier": "1",
                        "bracketType": bracket_type,
                    }],
                })

            return phases

        # No groups — single phase
        bracket_type = cls._get_bracket_type()
        return [{
            "id": "main",
            "name": "Bracket",
            "phaseGroups": [{
                "id": "main",
                "displayIdentifier": "1",
                "bracketType": bracket_type,
            }],
        }]

    @classmethod
    async def GetSets(
        cls,
        page: int = 1,
        phase_id: str | int | None = None,
        phase_group_id: str | int | None = None,
        include_finished: bool = False,
    ) -> dict:
        """Get paginated sets/matches."""
        if not cls._tournament_slug:
            return {"sets": [], "pageInfo": {"page": 1, "totalPages": 0}}

        if cls._matches is None:
            await cls._ensure_data()

        if cls._matches is None:
            return {"sets": [], "pageInfo": {"page": 1, "totalPages": 0}}

        # Filter matches
        filtered = cls._filter_matches(phase_id, phase_group_id)

        # Filter by state
        if not include_finished:
            filtered = [m for m in filtered if m.get("state") != "complete"]

        # Sort: active first, then pending, then complete
        state_order = {"open": 0, "pending": 1, "complete": 2}
        filtered.sort(key=lambda m: (state_order.get(m.get("state", ""), 9), abs(m.get("round", 0))))

        per_page = 64
        total = len(filtered)
        total_pages = max(1, (total + per_page - 1) // per_page)
        start = (page - 1) * per_page
        page_matches = filtered[start:start + per_page]

        parsed = [cls._parse_match(m) for m in page_matches]

        return {
            "sets": parsed,
            "pageInfo": {
                "page": page,
                "totalPages": total_pages,
                "total": total,
            },
        }

    @classmethod
    async def GetSet(cls, set_id: int) -> dict:
        """Get a single match/set by ID with player detail."""
        if cls._matches is None:
            await cls._ensure_data()

        if cls._matches is None:
            return {"error": "No tournament data loaded"}

        match = None
        for m in cls._matches:
            if m.get("id") == set_id:
                match = m
                break

        if not match:
            return {"error": "Match not found"}

        return cls._parse_match_full(match)

    @classmethod
    async def GetEntrants(cls, page: int = 1) -> dict:
        """Get paginated entrants/participants."""
        if not cls._tournament_slug:
            return {"entrants": [], "pageInfo": {"page": 1, "totalPages": 0}}

        if cls._participants is None:
            await cls._ensure_data()

        if cls._participants is None:
            return {"entrants": [], "pageInfo": {"page": 1, "totalPages": 0}}

        per_page = 64
        total = len(cls._participants)
        total_pages = max(1, (total + per_page - 1) // per_page)
        start = (page - 1) * per_page
        page_participants = cls._participants[start:start + per_page]

        parsed = [cls._parse_participant(p) for p in page_participants]

        return {
            "entrants": parsed,
            "pageInfo": {
                "page": page,
                "totalPages": total_pages,
                "total": total,
            },
        }

    @classmethod
    async def LoadSetIntoScoreboard(cls, set_id: int, scoreboard_number: int = 1) -> dict:
        """Fetch a match and write player data into the scoreboard state."""
        set_data = await cls.GetSet(set_id)
        if "error" in set_data:
            return set_data

        sb = scoreboard_number
        entrants = set_data.get("entrants", [[], []])
        entries = []

        for team_idx in range(2):
            team_num = team_idx + 1
            players = entrants[team_idx] if team_idx < len(entrants) else []
            if players:
                p = players[0]
                base = f"score.{sb}.player.{team_num}"
                entries.append((f"{base}.name", p.get("gamerTag", "")))
                entries.append((f"{base}.team", ""))
                entries.append((f"{base}.full_name", ""))
                entries.append((f"{base}.country", ""))
                entries.append((f"{base}.state", ""))
                entries.append((f"{base}.pronoun", ""))

        # Scores
        t1s = set_data.get("team1score")
        t2s = set_data.get("team2score")
        if t1s == "W":
            t1s, t2s = 1, 0
        elif t2s == "W":
            t1s, t2s = 0, 1
        entries.append((f"score.{sb}.score_left", t1s if isinstance(t1s, (int, float)) else 0))
        entries.append((f"score.{sb}.score_right", t2s if isinstance(t2s, (int, float)) else 0))

        if set_data.get("tournament_phase"):
            entries.append((f"score.{sb}.phase", set_data["tournament_phase"]))
        if set_data.get("round_name"):
            entries.append((f"score.{sb}.match", set_data["round_name"]))

        await State.SetBatch(entries)
        await State.Save()

        return {"success": True, "set": set_data}

    @classmethod
    async def GetBracketData(cls, phase_group_id: str | int) -> dict:
        """Build bracket data structure for a phase group."""
        if cls._matches is None:
            await cls._ensure_data()

        if cls._matches is None:
            return {"error": "No tournament data loaded"}

        matches = cls._filter_matches(phase_group_id=phase_group_id)

        bracket_type = cls._get_bracket_type()
        phase_label = "Bracket"

        if phase_group_id == "finals":
            phase_label = "Final Stage"
            bracket_type = cls._bracket_type_for_finals()
        elif isinstance(phase_group_id, int) or (isinstance(phase_group_id, str) and phase_group_id.isdigit()):
            phases = await cls.GetPhases()
            for phase in phases:
                for pg in phase.get("phaseGroups", []):
                    if str(pg["id"]) == str(phase_group_id):
                        phase_label = f"{phase['name']} - Pool {pg['displayIdentifier']}"
                        bracket_type = pg.get("bracketType", "ROUND_ROBIN")
                        break

        players = {}
        rounds_map = {}

        for m in matches:
            round_num = m.get("round", 0)
            round_name = cls._round_name(round_num, bracket_type)

            if round_num not in rounds_map:
                rounds_map[round_num] = {"name": round_name, "sets": []}

            p1_id = m.get("player1_id")
            p2_id = m.get("player2_id")

            for pid in [p1_id, p2_id]:
                if pid and str(pid) not in players and cls._participants_by_id:
                    p = cls._participants_by_id.get(pid)
                    if p:
                        players[str(pid)] = {
                            "name": p.get("name", ""),
                            "seed": p.get("seed"),
                            "prefix": "",
                        }

            score1 = m.get("score1")
            score2 = m.get("score2")
            state = _STATE_MAP.get(m.get("state", ""), m.get("state", ""))

            set_data = {
                "id": m.get("id"),
                "identifier": m.get("identifier", ""),
                "entrant1Id": str(p1_id) if p1_id else None,
                "entrant2Id": str(p2_id) if p2_id else None,
                "score1": score1,
                "score2": score2,
                "state": state,
                "completed": m.get("state") == "complete",
                "roundName": round_name,
            }
            rounds_map[round_num]["sets"].append(set_data)

        # Separate winners, losers, grand finals
        winners_rounds = {}
        losers_rounds = {}
        grand_finals = []

        if bracket_type == "DOUBLE_ELIMINATION":
            positive_rounds = sorted([r for r in rounds_map if r > 0])
            negative_rounds = sorted([r for r in rounds_map if r < 0], key=lambda x: abs(x))

            # Detect Grand Finals: in double-elim, rounds after Winners Finals
            # (the last 1-set positive round) are Grand Finals
            gf_cutoff = None
            for r in positive_rounds:
                round_data = rounds_map[r]
                num_sets = len(round_data["sets"])
                is_gf_name = any("Grand Final" in s.get("roundName", "") for s in round_data["sets"])
                if is_gf_name:
                    gf_cutoff = r
                    break
                # Winners Finals is a 1-set round followed by more rounds
                if num_sets == 1 and r < positive_rounds[-1]:
                    gf_cutoff = r + 1

            for r in positive_rounds:
                round_data = rounds_map[r]
                if gf_cutoff and r >= gf_cutoff:
                    # Relabel as Grand Finals / Grand Finals Reset
                    for s in round_data["sets"]:
                        s["roundName"] = "Grand Finals" if not grand_finals else "Grand Finals Reset"
                        grand_finals.append(s)
                else:
                    winners_rounds[r] = round_data

            for r in negative_rounds:
                losers_rounds[abs(r)] = rounds_map[r]
        elif bracket_type == "SINGLE_ELIMINATION":
            for r in sorted(rounds_map.keys()):
                if r > 0:
                    winners_rounds[r] = rounds_map[r]
        else:
            for r in sorted(rounds_map.keys()):
                winners_rounds[r] = rounds_map[r]

        # Build connections map: matchId -> [prereqMatchIds]
        connections = {}
        for m in matches:
            match_id = m.get("id")
            prereqs = []
            if m.get("player1_prereq_match_id"):
                prereqs.append(m["player1_prereq_match_id"])
            if m.get("player2_prereq_match_id"):
                prereqs.append(m["player2_prereq_match_id"])
            if prereqs:
                connections[match_id] = prereqs

        return {
            "type": bracket_type,
            "phaseName": phase_label,
            "phaseGroupId": phase_group_id,
            "winnersRounds": winners_rounds,
            "losersRounds": losers_rounds,
            "grandFinals": grand_finals,
            "players": players,
            "connections": connections,
        }

    @classmethod
    async def LoadBracket(cls, phase_group_id: str | int) -> dict:
        """Fetch bracket data and write to State for OBS overlays."""
        bracket_data = await cls.GetBracketData(phase_group_id)
        if "error" in bracket_data:
            return bracket_data

        await State.Set("bracket", bracket_data)
        await State.Save()

        return bracket_data

    # ── internal helpers ──────────────────────────────────────

    @classmethod
    async def _ensure_data(cls):
        """Fetch and cache participants + matches from the v2 API."""
        if cls._tournament_id is None:
            # Need to find the tournament first
            if cls._tournament_slug:
                result = await cls._find_tournament(cls._tournament_slug)
                if not result:
                    return

        if cls._tournament_id is None:
            return

        base = cls._tournament_path()

        # Fetch participants and matches concurrently
        participants_data, matches_data = await asyncio.gather(
            cls._fetch_all_pages(f"{base}/participants.json"),
            cls._fetch_all_pages(f"{base}/matches.json"),
        )

        # Parse participants from v2 format
        cls._participants = []
        for p in participants_data:
            attrs = p.get("attributes", {})
            cls._participants.append({
                "id": int(p["id"]),
                "name": attrs.get("name", ""),
                "seed": attrs.get("seed"),
                "group_id": attrs.get("group_id"),
                "username": attrs.get("username", ""),
                "final_rank": attrs.get("final_rank"),
            })
        cls._participants_by_id = {p["id"]: p for p in cls._participants}
        logger.info("[challonge] loaded {} participants", len(cls._participants))

        # Parse matches from v2 format
        cls._matches = []
        for m in matches_data:
            attrs = m.get("attributes", {})
            rels = m.get("relationships", {})

            p1_data = rels.get("player1", {}).get("data")
            p2_data = rels.get("player2", {}).get("data")
            p1_id = int(p1_data["id"]) if p1_data else None
            p2_id = int(p2_data["id"]) if p2_data else None

            # Fallback: some tournaments don't include player1/player2 relationships
            # but have participant IDs in points_by_participant
            if p1_id is None or p2_id is None:
                pbp = attrs.get("points_by_participant", [])
                if len(pbp) >= 2:
                    if p1_id is None:
                        p1_id = pbp[0].get("participant_id")
                    if p2_id is None:
                        p2_id = pbp[1].get("participant_id")

            # Parse scores
            score1, score2 = _parse_scores(attrs.get("scores"))
            winner_id = attrs.get("winner_id")

            # For completed with no score, derive W/L
            if attrs.get("state") == "complete" and score1 is None and winner_id:
                score1 = "W" if winner_id == p1_id else "L"
                score2 = "W" if winner_id == p2_id else "L"

            # Extract prerequisite match IDs (v2 attributes or relationships)
            p1_prereq = attrs.get("player1_prereq_match_id")
            p2_prereq = attrs.get("player2_prereq_match_id")
            for key in ("prerequisite-match-1", "player1_prereq_match"):
                if p1_prereq is not None:
                    break
                prereq_data = rels.get(key, {}).get("data")
                if prereq_data:
                    p1_prereq = int(prereq_data["id"])
            for key in ("prerequisite-match-2", "player2_prereq_match"):
                if p2_prereq is not None:
                    break
                prereq_data = rels.get(key, {}).get("data")
                if prereq_data:
                    p2_prereq = int(prereq_data["id"])

            cls._matches.append({
                "id": int(m["id"]),
                "round": attrs.get("round", 0),
                "state": attrs.get("state", ""),
                "identifier": attrs.get("identifier", ""),
                "player1_id": p1_id,
                "player2_id": p2_id,
                "score1": score1,
                "score2": score2,
                "winner_id": winner_id,
                "suggested_play_order": attrs.get("suggested_play_order"),
                "player1_prereq_match_id": p1_prereq,
                "player2_prereq_match_id": p2_prereq,
            })
        logger.info("[challonge] loaded {} matches", len(cls._matches))

    @classmethod
    async def _fetch_all_pages(cls, path: str) -> list:
        """Fetch all pages from a paginated v2 endpoint."""
        all_items = []
        page = 1
        while True:
            data = await cls._request(path, {"per_page": 200, "page": page})
            if isinstance(data, dict) and "error" in data:
                logger.warning("[challonge] error fetching {}: {}", path, data["error"])
                break
            items = data.get("data", [])
            if not items:
                break
            all_items.extend(items)
            # Check if there are more pages
            meta = data.get("meta", {})
            total = meta.get("count", 0)
            if len(all_items) >= total or not items:
                break
            page += 1
        return all_items

    @classmethod
    def _filter_matches(cls, phase_id=None, phase_group_id=None) -> list:
        """Filter cached matches by phase/group.

        For group stage tournaments, the v2 API only returns finals matches.
        We don't have individual group stage match data.
        """
        if cls._matches is None:
            return []

        matches = cls._matches

        if phase_group_id is not None:
            pgid = str(phase_group_id)
            if pgid == "finals" or pgid == "main":
                # Return all matches (v2 only gives us finals anyway)
                matches = list(matches)
            else:
                # Numeric group_id — group stage matches aren't available via v2
                # Return empty (the API doesn't expose them)
                matches = []
        elif phase_id is not None:
            pid = str(phase_id)
            if pid == "groups":
                # Group stage matches not available via v2
                matches = []
            elif pid == "finals":
                matches = list(matches)

        return matches

    @classmethod
    def _get_bracket_type(cls) -> str:
        if not cls._tournament_data:
            return "SINGLE_ELIMINATION"
        tt = cls._tournament_data.get("tournamentType", "")
        return {
            "single elimination": "SINGLE_ELIMINATION",
            "double elimination": "DOUBLE_ELIMINATION",
            "round robin": "ROUND_ROBIN",
            "swiss": "SWISS",
        }.get(tt, "SINGLE_ELIMINATION")

    @classmethod
    def _bracket_type_for_finals(cls) -> str:
        if not cls._matches:
            return cls._get_bracket_type()
        has_negative = any(m.get("round", 0) < 0 for m in cls._matches)
        if has_negative:
            return "DOUBLE_ELIMINATION"
        return "SINGLE_ELIMINATION"

    @classmethod
    def _round_name(cls, round_num: int, bracket_type: str) -> str:
        if bracket_type == "DOUBLE_ELIMINATION":
            if round_num > 0:
                return f"Winners Round {round_num}"
            else:
                return f"Losers Round {abs(round_num)}"
        elif bracket_type == "ROUND_ROBIN":
            return f"Round {abs(round_num)}"
        else:
            return f"Round {round_num}"

    @classmethod
    def _participant_name(cls, player_id: int | None) -> str:
        if not player_id or not cls._participants_by_id:
            return ""
        p = cls._participants_by_id.get(player_id)
        return p.get("name", "") if p else ""

    @classmethod
    def _participant_seed(cls, player_id: int | None) -> int | None:
        if not player_id or not cls._participants_by_id:
            return None
        p = cls._participants_by_id.get(player_id)
        return p.get("seed") if p else None

    @classmethod
    def _parse_match(cls, m: dict) -> dict:
        """Parse a normalized match dict into the frontend set format."""
        score1 = m.get("score1")
        score2 = m.get("score2")
        state = _STATE_MAP.get(m.get("state", ""), m.get("state", ""))

        bracket_type = cls._bracket_type_for_finals() if cls._tournament_data and cls._tournament_data.get("groupStagesEnabled") else cls._get_bracket_type()
        round_num = m.get("round", 0)

        return {
            "id": m.get("id"),
            "team1score": score1,
            "team2score": score2,
            "round_name": cls._round_name(round_num, bracket_type),
            "round": round_num,
            "tournament_phase": "",
            "bracket_type": bracket_type,
            "p1_name": cls._participant_name(m.get("player1_id")),
            "p2_name": cls._participant_name(m.get("player2_id")),
            "p1_seed": cls._participant_seed(m.get("player1_id")),
            "p2_seed": cls._participant_seed(m.get("player2_id")),
            "state": state,
        }

    @classmethod
    def _parse_match_full(cls, m: dict) -> dict:
        """Parse a match with full player detail."""
        score1 = m.get("score1")
        score2 = m.get("score2")
        bracket_type = cls._bracket_type_for_finals() if cls._tournament_data and cls._tournament_data.get("groupStagesEnabled") else cls._get_bracket_type()
        round_num = m.get("round", 0)

        entrants = [[], []]
        entrant_ids = []
        for i, pid in enumerate([m.get("player1_id"), m.get("player2_id")]):
            entrant_ids.append(pid)
            if pid and cls._participants_by_id:
                p = cls._participants_by_id.get(pid)
                if p:
                    entrants[i].append({
                        "gamerTag": p.get("name", ""),
                        "prefix": "",
                        "playerId": pid,
                    })

        return {
            "id": m.get("id"),
            "team1score": score1,
            "team2score": score2,
            "round_name": cls._round_name(round_num, bracket_type),
            "round": round_num,
            "tournament_phase": "",
            "bracket_type": bracket_type,
            "entrants": entrants,
            "entrant_ids": entrant_ids,
        }

    @staticmethod
    def _parse_participant(p: dict) -> dict:
        """Parse into the same format as StartGGProvider._parse_entrant."""
        name = p.get("name", "")
        return {
            "id": p.get("id"),
            "name": name,
            "seed": p.get("seed"),
            "players": [{
                "gamerTag": name,
                "prefix": "",
                "playerId": p.get("id"),
            }],
        }

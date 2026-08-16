"""Pure parsers for start.gg GraphQL responses (``server/startgg/provider.py``).

Everything here is a synchronous dict-in/dict-out transform — no HTTP, no
State. The provider fetches; these shape.
"""


def deep(obj, path, default=None):
    """Synchronous deep-get for parsing GraphQL responses."""
    for key in path.split("."):
        if not isinstance(obj, dict):
            return default
        obj = obj.get(key, default)
    return obj


# start.gg set states: 1=created, 2=active, 3=completed, 6=called
STATE_MAP = {1: "created", 2: "active", 3: "completed", 6: "called"}


def derive_scores(raw: dict, p1: dict, p2: dict) -> tuple:
    """A set's ``(team1score, team2score)``: ``entrantNScore`` when available,
    else W/L derived from standing placement, else the standing score value."""
    team1score = raw.get("entrant1Score")
    team2score = raw.get("entrant2Score")
    p1_placement = deep(p1, "standing.placement")
    p2_placement = deep(p2, "standing.placement")
    p1_standing_score = deep(p1, "standing.stats.score.value")
    p2_standing_score = deep(p2, "standing.stats.score.value")

    if team1score is None and team2score is None and p1_placement is not None:
        team1score = "W" if p1_placement == 1 else "L" if p1_placement == 2 else None
        team2score = "W" if p2_placement == 1 else "L" if p2_placement == 2 else None
    elif team1score is None and p1_standing_score is not None:
        team1score = p1_standing_score
        team2score = p2_standing_score
    return team1score, team2score


def phase_label(raw: dict) -> str:
    """Phase name, suffixed with the pool identifier in multi-group phases."""
    name = deep(raw, "phaseGroup.phase.name", "")
    group_count = deep(raw, "phaseGroup.phase.groupCount", 0) or 0
    if group_count > 1:
        display_id = deep(raw, "phaseGroup.displayIdentifier", "")
        if display_id:
            return f"{name} - Pool {display_id}"
    return name


def _player_data(player: dict, user: dict) -> dict:
    """One participant's player dict with the optional user-profile fields."""
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
        if user.get("images"):
            pd["avatar"] = user["images"][0].get("url", "")
        loc = user.get("location", {}) or {}
        if loc.get("country"):
            pd["country"] = loc["country"]
        if loc.get("state"):
            pd["state"] = loc["state"]
        if loc.get("city"):
            pd["city"] = loc["city"]
    return pd


def parse_set(raw: dict) -> dict:
    """Parse a set from the paginated sets query (minimal player detail)."""
    slots = raw.get("slots", [])
    p1 = slots[0] if len(slots) > 0 else {}
    p2 = slots[1] if len(slots) > 1 else {}

    def entrant_name(slot):
        """The entrant's TAG, without the sponsor prefix.

        start.gg's ``entrant.name`` is ``"AAA | Alice"`` for anyone carrying a
        prefix, and the prefix is a sponsor's initials: it identifies nobody,
        while costing a third of every name column that prints it. The cached
        bracket path has always answered with the bare gamerTag
        (``bracket_cache.sets_from_cache``), so the same set read from the API
        and read from the cache printed two different names for one player.

        A multi-participant entrant keeps its own name — there is no single
        gamerTag to answer with — and so does one with no participant detail,
        which is what a preview set from an unseeded phase looks like.
        """
        e = slot.get("entrant")
        if not e:
            return ""
        parts = e.get("participants") or []
        if len(parts) == 1:
            tag = (parts[0].get("player") or {}).get("gamerTag")
            if tag:
                return tag
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

    team1score, team2score = derive_scores(raw, p1, p2)

    return {
        "id": raw.get("id"),
        "team1score": team1score,
        "team2score": team2score,
        "round_name": raw.get("fullRoundText", ""),
        "round": raw.get("round"),
        "tournament_phase": phase_label(raw),
        "bracket_type": deep(raw, "phaseGroup.phase.bracketType", ""),
        "p1_name": entrant_name(p1),
        "p2_name": entrant_name(p2),
        "p1_seed": entrant_seed(p1),
        "p2_seed": entrant_seed(p2),
        "state": STATE_MAP.get(raw.get("state"), str(raw.get("state", ""))),
        # Consumable shape (mirrors parse_set_full) so a list set — including
        # a preview set from an unseeded phase — can seat a match directly.
        "entrants": [entrant_players(p1), entrant_players(p2)],
        "seeds": [entrant_seed(p1), entrant_seed(p2)],
        "entrant_ids": [
            (p1.get("entrant") or {}).get("id"),
            (p2.get("entrant") or {}).get("id"),
        ],
        "totalGames": raw.get("totalGames"),
    }


def parse_set_full(raw: dict) -> dict:
    """Parse a single set with full player detail (from SetQuery)."""
    slots = raw.get("slots", [])
    p1 = slots[0] if len(slots) > 0 else {}
    p2 = slots[1] if len(slots) > 1 else {}

    team1score, team2score = derive_scores(raw, p1, p2)

    set_data = {
        "id": raw.get("id"),
        "team1score": team1score,
        "team2score": team2score,
        "round_name": raw.get("fullRoundText", ""),
        "round": raw.get("round"),
        "totalGames": raw.get("totalGames"),
        "tournament_phase": phase_label(raw),
        "bracket_type": deep(raw, "phaseGroup.phase.bracketType", ""),
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
        for participant in (entrant.get("participants", []) or []):
            entrants[i].append(_player_data(
                participant.get("player", {}) or {},
                participant.get("user", {}) or {},
            ))

    set_data["entrants"] = entrants
    set_data["entrant_ids"] = entrant_ids
    set_data["seeds"] = seeds
    return set_data


def parse_entrant(raw: dict) -> dict:
    """Parse an entrant from the entrants query."""
    return {
        "id": raw.get("id"),
        "name": raw.get("name", ""),
        "seed": raw.get("initialSeedNum"),
        "players": [
            _player_data(p.get("player", {}) or {}, p.get("user", {}) or {})
            for p in (raw.get("participants", []) or [])
        ],
    }

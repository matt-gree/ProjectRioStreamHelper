"""The cached-bracket shape (``server/startgg/provider.py``).

Two pure transforms around the per-phase-group bracket cache:

- ``structure_bracket`` builds the cached dict from a phase group's raw sets
  (winners/losers/GF buckets + a player lookup) — the shape the bracket
  overlay reads from State.
- ``sets_from_cache`` reshapes a cached dict back into the paginated ``/sets``
  response, so a cache hit skips a start.gg round-trip (SETS_QUERY and
  BRACKET_SETS_QUERY return overlapping data).
"""
from server.startgg.parsers import STATE_MAP, derive_scores


def structure_bracket(phase_group_id: int, bracket_type: str,
                      phase_label: str, all_sets: list) -> dict:
    """Structure a phase group's raw sets as bracket data.

    Returns a dict with:
      - type: bracket type (DOUBLE_ELIMINATION, SINGLE_ELIMINATION, ROUND_ROBIN)
      - phaseName: phase name + pool identifier
      - winnersRounds: {roundNum: {name, sets}} for positive rounds
      - losersRounds: {roundNum: {name, sets}} for negative rounds
      - grandFinals: list of GF sets (round numbers after last winners round)
      - players: {entrantId: {name, seed, prefix}}
    """
    players = {}
    rounds_map = {}  # round_number -> {name, sets}

    for raw in all_sets:
        round_num = raw.get("round", 0)
        if round_num not in rounds_map:
            rounds_map[round_num] = {
                "name": raw.get("fullRoundText", f"Round {round_num}"),
                "sets": [],
            }

        slots = raw.get("slots", [])
        entrant1 = (slots[0].get("entrant") if len(slots) > 0 else None) or None
        entrant2 = (slots[1].get("entrant") if len(slots) > 1 else None) or None

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

        p1_slot = slots[0] if len(slots) > 0 else {}
        p2_slot = slots[1] if len(slots) > 1 else {}
        score1, score2 = derive_scores(raw, p1_slot, p2_slot)

        rounds_map[round_num]["sets"].append({
            "id": raw.get("id"),
            "identifier": raw.get("identifier", ""),
            "entrant1Id": str(entrant1["id"]) if entrant1 and entrant1.get("id") else None,
            "entrant2Id": str(entrant2["id"]) if entrant2 and entrant2.get("id") else None,
            "score1": score1,
            "score2": score2,
            "totalGames": raw.get("totalGames"),
            "state": STATE_MAP.get(raw.get("state"), str(raw.get("state", ""))),
            "completed": raw.get("state") == 3,
            "roundName": raw.get("fullRoundText", ""),
        })

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


def sets_from_cache(cached: dict, page: int, include_finished: bool) -> dict:
    """Reshape cached bracket data into the paginated /sets response shape.

    The bracket cache stores sets organized by round (winners/losers/GF)
    with players in a separate lookup. /sets wants a flat list with
    per-set p1_name/p2_name/seeds. We flatten, look up player names, and
    apply the same filtering and pagination the API path would.
    """
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
            # Consumable shape (mirrors parse_set_full) so a set fetched from
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

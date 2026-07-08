"""Matchup history — the head-to-head record behind the Matchup History element.

A producer-triggered fetch (``POST /api/v1/matchup/fetch?match=M``) resolves the
match's two participants to their Rio names, pulls every completed game between
them from the Project Rio API, and projects a SINGLETON ``matchup.*`` namespace
into State (mirrors ``lowerthird.*`` — one matchup band at a time; ``matchId``
records which match the data belongs to). The overlay
(``public/layout/matchup/matchup.html``) renders an all-time series summary over
the five most recent game cards.

Everything derivable is computed here, once, at fetch time — the overlay binds
plain values into theme slots and never re-derives (scores are already oriented
to the match's authored sides, captains resolved, default team names attached).
"""
from datetime import datetime, timezone

from loguru import logger

from server.match import Match
from server.participants import Participants
from server.rio import stats_api
from server.rio.game_pool import _sanitize_row
from server.rio.pyrio.lookup import Lookup
from server.rio.pyrio.team_name_algo import TEAM_NAMES_DICT
from server.state import State

# Game cards shown on the band (newest first). The summary still counts ALL games.
MAX_CARDS = 5


def default_team_name(captain) -> str:
    """The captain's default MSB team name (the roster-independent one).

    Completed-game records carry only captains, not rosters, so the full
    ``team_name_algo`` can't run — the default (index 0) name is the honest
    roster-independent answer (e.g. Mario → "Mario Heroes"). Empty on any
    lookup failure; the overlay then falls back to the captain icon.
    """
    if not captain:
        return ""
    try:
        simplified = Lookup.lookup("simplified_name", captain)
        teams = TEAM_NAMES_DICT.get(simplified) or TEAM_NAMES_DICT.get(captain)
        return (teams[0].get("Name") or "") if teams else ""
    except Exception:
        return ""


def _norm(name) -> str:
    return (name or "").strip().casefold()


def build_matchup(games: list[dict], side1_rio: str, side2_rio: str,
                  match_id=None, max_cards: int = MAX_CARDS) -> dict:
    """Fold sanitized completed-game dicts into the matchup payload.

    Pure (unit-tested): orientation maps each game's away/home users onto the
    match's authored side 1/2 by casefold rioName; games not between exactly
    these two players are skipped (defensive — the API query already filters).
    Tied scores (quits) count in totalGames but credit neither side.
    """
    s1, s2 = _norm(side1_rio), _norm(side2_rio)

    rows = []
    for g in games:
        away, home = _norm(g.get("away_user")), _norm(g.get("home_user"))
        if {away, home} != {s1, s2}:
            continue
        rows.append(g)
    # Newest first. Sanitized timestamps are ISO strings (lexically ordered);
    # missing dates sort last.
    rows.sort(key=lambda g: g.get("date_time_end") or "", reverse=True)

    wins = {1: 0, 2: 0}
    cards = []
    for g in rows:
        away_is_1 = _norm(g.get("away_user")) == s1
        a_score = g.get("away_score") or 0
        h_score = g.get("home_score") or 0
        side1_score = a_score if away_is_1 else h_score
        side2_score = h_score if away_is_1 else a_score
        side1_captain = (g.get("away_captain") if away_is_1 else g.get("home_captain")) or ""
        side2_captain = (g.get("home_captain") if away_is_1 else g.get("away_captain")) or ""

        winner = 1 if side1_score > side2_score else 2 if side2_score > side1_score else None
        if winner:
            wins[winner] += 1

        if len(cards) < max_cards:
            cards.append({
                "gameId": g.get("game_id"),
                "date": g.get("date_time_end") or g.get("date_time_start") or "",
                "side1Score": side1_score,
                "side2Score": side2_score,
                "winnerSide": winner,
                "awaySide": 1 if away_is_1 else 2,
                "side1Captain": side1_captain,
                "side2Captain": side2_captain,
                "side1Team": default_team_name(side1_captain),
                "side2Team": default_team_name(side2_captain),
                "gameMode": g.get("game_mode") or "",
                "stadium": g.get("stadium") or "",
            })

    return {
        "present": True,
        "matchId": match_id,
        "totalGames": len(rows),
        "side1": {"rioName": side1_rio, "wins": wins[1]},
        "side2": {"rioName": side2_rio, "wins": wins[2]},
        "games": cards,
    }


def _display_tag(player: dict | None, rio: str) -> str:
    """The participant's Address Book tag, or "" when none is set. Prefers the
    match side's participantId join key, falling back to a rioName lookup."""
    pid = (player or {}).get("participantId")
    row = Participants.Get(pid) if pid else None
    if not row and rio:
        row = Participants.MatchByRioName(rio)
    return ((row or {}).get("display") or {}).get("tag") or ""


class Matchup:
    """Stateless singleton (mirrors Match): fetch + project ``matchup.*``."""

    @classmethod
    async def Fetch(cls, m) -> dict:
        """Fetch the head-to-head for match ``m`` and project it into State.

        Returns the payload, or ``{"error": ...}`` (nothing projected) when the
        match is missing or a side has no resolvable Rio name yet.
        """
        if not Match.exists(m):
            return {"error": f"match {m!r} not found"}
        players = Match.get(m).get("player") or {}
        p1 = players.get("1") or players.get(1)
        p2 = players.get("2") or players.get(2)
        rio1 = Match._participant_rioname(p1)
        rio2 = Match._participant_rioname(p2)
        if not rio1 or not rio2:
            return {"error": "Both sides need a participant with a Rio name before "
                             "a head-to-head can be fetched."}

        df = await stats_api.fetch_completed_games(username=[rio1], vs_username=[rio2])
        games = [] if df.empty else [_sanitize_row(r.to_dict()) for _, r in df.iterrows()]

        payload = build_matchup(games, rio1, rio2, match_id=m)
        # Address Book display tag per side (overlay prefers it over rioName); the
        # match's participantId is the join key, rioName the fallback lookup.
        payload["side1"]["tag"] = _display_tag(p1, rio1)
        payload["side2"]["tag"] = _display_tag(p2, rio2)
        payload["fetchedAt"] = datetime.now(timezone.utc).isoformat()

        await State.Set("matchup", payload)
        await State.Save()
        logger.info("[Matchup] match {}: {} vs {} — {} games ({}–{})",
                    m, rio1, rio2, payload["totalGames"],
                    payload["side1"]["wins"], payload["side2"]["wins"])
        return payload

    @classmethod
    async def Clear(cls) -> None:
        """Blank the band (overlay hides itself on present=False)."""
        await State.Set("matchup", {"present": False})
        await State.Save()

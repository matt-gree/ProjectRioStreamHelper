"""API-side game-end winner detection (Phase C).

Credits a bound match's series when a *followed live API game* finishes. The
signal we rely on is the **ongoing feed dropping the game we were following** —
not the completed-pool poll, which may be idle. See the phase plan.

Per followed game that drops out of ongoing:
  1. Snapshot the two usernames + start_time + the bound match while the game is
     still in the just-replaced ongoing dict.
  2. One-shot ``/games`` lookup filtered to that pairing (a targeted fetch, not a
     standing poll). Accept only a completed game that started at/after the
     followed game (so a Bo-series rematch never re-credits the previous game),
     read ``winner_user`` and award the series side by rioName via
     ``Match.award_game`` — which declines on a name mismatch (no guessing).
  3. If not yet ingested, retry every ``RETRY_DELAY`` s up to ``RETRY_MAX`` times
     (the DB ingests the game moments after it leaves ongoing).

A crashed/abandoned game **lingers in ongoing forever**, so it never drops out,
never fires, and the producer resolves it by hand — consistent with
``award_game``'s decline-on-ambiguity philosophy.

Server-side by design: series crediting must not depend on the producer UI being
open. HUD/local boards are credited by the post-game stat-file path instead
(``server/postgame.py``); a match binds to exactly one board, so the two paths
never both fire for the same game.
"""
import asyncio

import pandas as pd
from loguru import logger

from server.match import Match

RETRY_DELAY = 10.0    # seconds between completed-pool lookups
RETRY_MAX = 12        # attempts (~2 min) before deferring to the producer
LOOKUP_LIMIT = 8      # completed games to pull for the pairing
START_SLACK = 300     # seconds of slack when matching by start_time


class GameEndWatcher:
    """Watches the ongoing feed for followed match-games ending. Singleton like
    the pools — all lifecycle state is class-level."""

    # game_ids currently being resolved (`_pending`) or already resolved this
    # session (`_done`), so a flickering ongoing feed or overlapping polls never
    # double-award a game.
    _pending: set = set()
    _done: set = set()

    @classmethod
    def reset(cls) -> None:
        cls._pending = set()
        cls._done = set()

    @classmethod
    def _candidate(cls, game_id, game: dict):
        """``(sb, match_id, away, home, start_time)`` if a followed **API-single**
        board bound to an **undecided** match was following ``game_id``, else
        None. HUD board 1 is excluded — its games credit via post-game capture."""
        from server.bindings import get_binding, is_rotating, transport
        from server.settings import Settings

        active = Settings.Get("scoreboards.active", [1]) or [1]
        for sb in active:
            if transport(sb) != "api" or is_rotating(sb):
                continue
            if str(get_binding(sb)["playback"].get("gameId")) != str(game_id):
                continue
            m = Match.scoreboard_match(sb)
            if not m or Match.get(m).get("decided"):
                continue
            away = game.get("away_player") or game.get("away_user") or ""
            home = game.get("home_player") or game.get("home_user") or ""
            start_time = game.get("start_time") or 0
            return sb, m, away, home, start_time
        return None

    @classmethod
    def on_ongoing_poll(cls, prev: dict, curr: dict) -> None:
        """Hook from ``OngoingGamePool`` after each poll. Spawns a resolver for
        any followed match-game that just dropped out of the ongoing feed."""
        if not prev:
            return
        dropped = set(prev.keys()) - set(curr.keys())
        for gid in dropped:
            if gid in cls._pending or gid in cls._done:
                continue
            cand = cls._candidate(gid, prev.get(gid) or {})
            if not cand:
                continue
            sb, m, away, home, start_time = cand
            cls._pending.add(gid)
            logger.info(
                "[GameEnd] board {} game {} left ongoing — resolving winner for match {}",
                sb, gid, m,
            )
            asyncio.create_task(cls._resolve(gid, sb, m, away, home, start_time))

    @classmethod
    async def _resolve(cls, game_id, sb, m, away, home, start_time) -> None:
        try:
            for attempt in range(1, RETRY_MAX + 1):
                # The match may have been retired / decided / unbound (or a new
                # game rebound the board) while we waited — abandon if so.
                if Match.get(m).get("decided") or str(Match.scoreboard_match(sb)) != str(m):
                    logger.info("[GameEnd] match {} no longer awaitable — abandoning", m)
                    return
                winner = await cls._lookup_winner(away, home, start_time)
                if winner:
                    side = await Match.award_game(m, winner)
                    # Found the finished game either way: a name mismatch is a
                    # real result the producer resolves, not a reason to retry.
                    cls._done.add(game_id)
                    if side:
                        logger.info("[GameEnd] match {}: credited game to {} (side {})", m, winner, side)
                    else:
                        logger.warning(
                            "[GameEnd] match {}: winner {!r} not on the fixture — producer resolves", m, winner,
                        )
                    return
                if attempt < RETRY_MAX:
                    await asyncio.sleep(RETRY_DELAY)
            logger.warning(
                "[GameEnd] game {} never appeared in /games after {} tries — producer resolves",
                game_id, RETRY_MAX,
            )
        except Exception:
            logger.exception("[GameEnd] resolver crashed for game {}", game_id)
        finally:
            cls._pending.discard(game_id)

    @classmethod
    async def _lookup_winner(cls, away: str, home: str, start_time) -> str:
        """One-shot completed-games lookup for the pairing. Returns the
        ``winner_user`` of the most recent game that started at/after the followed
        game, or '' when the game hasn't been ingested yet."""
        from server.rio import stats_api

        if not (away or home):
            return ""
        try:
            df = await stats_api.fetch_completed_games(
                username=[away] if away else None,
                vs_username=[home] if home else None,
                limit_games=LOOKUP_LIMIT,
            )
        except Exception:
            logger.exception("[GameEnd] completed lookup failed")
            return ""
        if df is None or df.empty or "winner_user" not in df.columns:
            return ""

        # Keep only games that started at/after the one we followed (minus slack),
        # so an earlier game between the same pairing can't be mistaken for the
        # just-finished one. An empty result means "not ingested yet" → retry.
        if start_time and "date_time_start" in df.columns:
            try:
                cutoff = pd.Timestamp(int(start_time) - START_SLACK, unit="s", tz="UTC")
                col = pd.to_datetime(df["date_time_start"], utc=True)
                df = df[col >= cutoff]
            except Exception:
                logger.exception("[GameEnd] start_time filter failed — using unfiltered result")
        if df.empty:
            return ""

        try:
            if "date_time_start" in df.columns:
                df = df.sort_values("date_time_start", ascending=False)
        except Exception:
            pass
        return str(df.iloc[0].get("winner_user") or "")

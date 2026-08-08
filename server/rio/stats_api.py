"""Async wrapper around pyrio's RioWeb client for Project Rio API calls.

All Project Rio API interactions should go through this module.
RioWeb uses sync requests.Session, so calls are wrapped in asyncio.to_thread().
"""
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode

import pandas as pd
from loguru import logger
from server import socketio
from server.paths import user_data_dir
from server.rio.pyrio.rio_web import RioWeb
from server.rio.pyrio.exceptions import RioAPIError

_client: RioWeb | None = None
_ENV_PATH = user_data_dir() / ".env"

# Diagnostic state for the last stats fetch — keyed by scoreboard so each
# scoreboard's diagnostics popover sees only its own fetch, not whichever
# scoreboard happened to fetch last.
_last_fetch_info: dict[int, dict] = {}

# Diagnostic state for the last completed games fetch (single shared pool, so
# this stays a single dict).
_last_completed_fetch_info: dict = {
    "url": None,
    "count": 0,
    "fetched_at": None,
    "error": None,
}


def _empty_fetch_info() -> dict:
    return {
        "url": None,
        "tag": None,
        "players": {},
        "fetched_at": None,
    }


def get_last_fetch_info(scoreboard_number: int | None = None) -> dict:
    """Return diagnostic info about the last stats fetch for a scoreboard."""
    if scoreboard_number is None:
        # Back-compat: caller didn't specify a scoreboard. Return an empty
        # shape rather than leaking another scoreboard's data.
        return _empty_fetch_info()
    return _last_fetch_info.get(scoreboard_number, _empty_fetch_info()).copy()


def get_last_completed_fetch_info() -> dict:
    """Return diagnostic info about the last completed games fetch."""
    return _last_completed_fetch_info.copy()


async def set_no_players_diagnostic(scoreboard_number: int, tag: str | None) -> None:
    """Record that a stats refresh was attempted but no players are set."""
    info = {
        "url": None,
        "tag": tag,
        "players": {},
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "status": "done",
        "error": "No players detected. A game must be active (via HUD or API) before stats can be fetched.",
    }
    _last_fetch_info[scoreboard_number] = info
    await _emit_fetch_status(scoreboard_number, info)


def reset_fetch_info(scoreboard_number: int) -> None:
    """Drop a scoreboard's diagnostics slot (e.g. on source change/removal)."""
    _last_fetch_info.pop(scoreboard_number, None)


async def _emit_fetch_status(scoreboard_number: int, info: dict) -> None:
    """Broadcast the current fetch state for one scoreboard.

    Lets the frontend stop polling /rio/stats/diagnostics — it gets push
    updates instead. Payload mirrors what GET /rio/stats/diagnostics returns,
    plus the scoreboard id so the client can filter.
    """
    await socketio.emit("v1.stats.fetch_status", {"scoreboard": scoreboard_number, **info})


def load_rio_key() -> str | None:
    """Read the Rio API key from user_data/.env (format: RIO_KEY=<value>)."""
    if not _ENV_PATH.exists():
        return None
    for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("RIO_KEY=") and len(line) > 8:
            return line[8:]
    return None


def save_rio_key(key: str) -> None:
    """Write the Rio API key to user_data/.env."""
    _ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    _ENV_PATH.write_text(f"RIO_KEY={key}\n", encoding="utf-8")


def reset_client() -> None:
    """Discard the cached RioWeb client so it is recreated with the current key."""
    global _client
    _client = None


def _get_client() -> RioWeb:
    """Lazy singleton for the RioWeb API client."""
    global _client
    if _client is None:
        key = load_rio_key()
        cache_dir = str(user_data_dir() / "cache")
        _client = RioWeb(rio_key=key, cache_dir=cache_dir)
    return _client


async def fetch_character_stats(
    usernames: list[str],
    tag: Optional[str] = None,
    scoreboard_number: int | None = None,
) -> pd.DataFrame:
    """Fetch per-character stats from the Project Rio API in a single request.

    Uses by_user=1&by_char=1 with multiple username params.  The response
    is processed by pyrio's RioWeb._process_stats() into a flat DataFrame with:
      - Grouping columns: username, char_name
      - Stat columns: Batting_summary_at_bats, Pitching_batters_faced, etc.

    Returns an empty DataFrame on error.

    Args:
        scoreboard_number: which scoreboard's diagnostics slot to write to.
            If None, no diagnostics are recorded (the fetch still runs).
    """
    # Remove all whitespace from string parameters
    usernames = ["".join(u.split()) for u in usernames]
    usernames = [u for u in usernames if u]
    if tag:
        tag = "".join(tag.split())

    if not usernames:
        return pd.DataFrame()

    client = _get_client()
    player_diag = {}

    # Single request with all usernames
    params = {
        "by_char": 1,
        "by_user": 1,
        "username": usernames,
        "exclude_fielding": 1,
    }
    if tag:
        params["tag"] = tag

    # Build diagnostic URL
    user_qs = "&".join(f"username={u}" for u in usernames)
    base_qs = f"by_char=1&by_user=1&exclude_fielding=1"
    if tag:
        base_qs += f"&tag={tag}"
    diag_url = f"{client.base_url}/stats/?{base_qs}&{user_qs}"

    # Set loading state immediately so the UI can show it
    if scoreboard_number is not None:
        loading_info = {
            "url": diag_url,
            "tag": tag,
            "players": {u: {"char_count": 0, "error": None, "status": "loading"} for u in usernames},
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "status": "loading",
        }
        _last_fetch_info[scoreboard_number] = loading_info
        await _emit_fetch_status(scoreboard_number, loading_info)

    try:
        # raw=False → pyrio processes the response into a flat DataFrame
        df = await asyncio.to_thread(client.get_stats, params)

        for username in usernames:
            if not df.empty and "username" in df.columns:
                char_count = len(df[df["username"] == username])
            else:
                char_count = 0
            logger.info(f"[StatsAPI] sb{scoreboard_number} fetched stats for {username}: {char_count} characters")
            player_diag[username] = {"char_count": char_count, "error": None, "status": "done"}

    except RioAPIError as e:
        logger.warning(f"[StatsAPI] sb{scoreboard_number} API error fetching stats: {e}")
        df = pd.DataFrame()
        for username in usernames:
            player_diag[username] = {"char_count": 0, "error": str(e), "status": "error"}
    except Exception as e:
        logger.error(f"[StatsAPI] sb{scoreboard_number} unexpected error fetching stats: {e}")
        df = pd.DataFrame()
        for username in usernames:
            player_diag[username] = {"char_count": 0, "error": str(e), "status": "error"}

    if scoreboard_number is not None:
        done_info = {
            "url": diag_url,
            "tag": tag,
            "players": player_diag,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "status": "done",
        }
        _last_fetch_info[scoreboard_number] = done_info
        await _emit_fetch_status(scoreboard_number, done_info)

    return df


async def fetch_completed_games(
    tag: list[str] | None = None,
    username: list[str] | None = None,
    vs_username: list[str] | None = None,
    exclude_username: list[str] | None = None,
    start_time: int | None = None,
    end_time: int | None = None,
    stadium: int | None = None,
    limit_games: int | None = None,
    captain: str | None = None,
    vs_captain: str | None = None,
    exclude_tag: list[str] | None = None,
    include_teams: bool | None = None,
) -> pd.DataFrame:
    """Fetch completed games from the Project Rio API.

    Uses pyrio's get_games() which returns a processed DataFrame with
    winner/loser columns, resolved timestamps, stadium names, and game mode names.
    """
    global _last_completed_fetch_info

    client = _get_client()
    params = {}
    if tag:
        params["tag"] = tag
    if username:
        params["username"] = username
    if vs_username:
        params["vs_username"] = vs_username
    if exclude_username:
        params["exclude_username"] = exclude_username
    if start_time is not None:
        params["start_time"] = start_time
    if end_time is not None:
        params["end_time"] = end_time
    if stadium is not None:
        params["stadium"] = stadium
    if limit_games is not None:
        params["limit_games"] = limit_games
    if captain:
        params["captain"] = captain
    if vs_captain:
        params["vs_captain"] = vs_captain
    if exclude_tag:
        params["exclude_tag"] = exclude_tag
    if include_teams is not None:
        params["include_teams"] = include_teams
    params["include_linescore"] = 1

    # Build the diagnostic URL matching what pyrio will send to the Rio API
    qs_parts = []
    for k, v in params.items():
        if isinstance(v, list):
            for item in v:
                qs_parts.append((k, item))
        else:
            qs_parts.append((k, v))
    diag_url = f"{client.base_url}/games/?{urlencode(qs_parts)}" if qs_parts else f"{client.base_url}/games/"

    try:
        df = await asyncio.to_thread(client.get_games, params)
        count = len(df)
        logger.info(f"[StatsAPI] Fetched {count} completed games")
        _last_completed_fetch_info = {
            "url": diag_url,
            "count": count,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }
        return df
    except RioAPIError as e:
        logger.warning(f"[StatsAPI] API error fetching completed games: {e}")
        _last_completed_fetch_info = {
            "url": diag_url,
            "count": 0,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
        }
        return pd.DataFrame()
    except Exception as e:
        logger.error(f"[StatsAPI] Unexpected error fetching completed games: {e}")
        _last_completed_fetch_info = {
            "url": diag_url,
            "count": 0,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
        }
        return pd.DataFrame()


async def fetch_ongoing_games() -> dict:
    """Fetch currently ongoing games from the Project Rio API."""
    client = _get_client()
    try:
        return await asyncio.to_thread(client.get_live_games)
    except RioAPIError as e:
        logger.warning(f"[StatsAPI] API error fetching live games: {e}")
        return {}
    except Exception as e:
        logger.error(f"[StatsAPI] Unexpected error fetching live games: {e}")
        return {}


# Cached game modes: {name: id}
_game_modes: dict[str, int] = {}
_game_modes_lock: asyncio.Lock | None = None
_cache_refresh_lock: asyncio.Lock | None = None

# How long a LIVE path (a HUD frame resolving its game mode) will wait on the
# game-mode cache before giving up and leaving the tag alone. pyrio builds its
# session with no HTTP timeout, so "the API is unreachable" is indistinguishable
# from "the API is slow" and can last forever — and the scoreboard is on air.
# Resolution is a nicety; the board coming up is not.
LIVE_RESOLVE_TIMEOUT = 2.0

# How long after launch the completer-cache rebuild waits. It is CPU-bound in
# pyrio and starves the event loop for ~40s cold, so running it at second zero
# put ~13s between a HUD frame and the board appearing. Nothing live reads it.
STARTUP_CACHE_REFRESH_DELAY = 60.0


def _get_game_modes_lock() -> asyncio.Lock:
    global _game_modes_lock
    if _game_modes_lock is None:
        _game_modes_lock = asyncio.Lock()
    return _game_modes_lock


def modes_ready() -> bool:
    """True once the game-mode list has been fetched at least once.

    Lets a caller tell the two empty answers apart: "that id is not an active
    mode" (final) from "we never got to look" (worth trying again next frame).
    """
    return bool(_game_modes)


def _get_cache_refresh_lock() -> asyncio.Lock:
    global _cache_refresh_lock
    if _cache_refresh_lock is None:
        _cache_refresh_lock = asyncio.Lock()
    return _cache_refresh_lock


async def fetch_game_modes(force: bool = False) -> dict[str, int]:
    """Fetch active game modes from the Project Rio API.

    Returns: {game_mode_name: tag_set_id}
    Caches the result; pass force=True to re-fetch.

    force=True also refreshes pyrio's disk-persisted CompleterCache (tags,
    users, game modes — cache.pkl under user_data/cache/), which otherwise
    trusts a timestamp that can survive up to a day across app restarts.
    That cache backs the game-mode-name resolution used when displaying
    completed games (RioWeb._process_games), so a stale pickle can hide a
    just-added game mode there even after fetch_game_modes() itself refreshes.
    """
    global _game_modes
    if _game_modes and not force:
        return _game_modes

    client = _get_client()

    # The mode list first, and alone under this lock. Everything that waits on
    # `_game_modes` — including a HUD frame resolving a new game's tag — waits
    # exactly as long as this one call, and no longer.
    async with _get_game_modes_lock():
        # Double-check after acquiring lock (another coroutine may have filled it)
        if _game_modes and not force:
            return _game_modes
        try:
            raw = await asyncio.to_thread(client.list_game_modes, active=True)
            tag_sets = raw.get("Tag Sets", [])
            _game_modes = {ts["name"]: ts["id"] for ts in tag_sets}
            logger.info(f"[StatsAPI] Fetched {len(_game_modes)} active game modes")
        except RioAPIError as e:
            logger.warning(f"[StatsAPI] API error fetching game modes: {e}")
        except Exception as e:
            logger.error(f"[StatsAPI] Unexpected error fetching game modes: {e}")

    if force:
        await refresh_completer_cache()

    return _game_modes


async def refresh_completer_cache() -> None:
    """Rebuild pyrio's disk-persisted completer cache (tags/users/modes).

    A separate concern on a separate lock from `_game_modes`, which is what
    anything live actually waits on. Holding the game-modes lock across this is
    what used to put a ~42s Project Rio round-trip in front of the first HUD
    frame.

    Be aware of what this costs even off that lock: it is CPU-bound inside pyrio
    (pickle + pandas), so `to_thread` hands off the work but NOT the GIL, and it
    measurably starves the event loop while it runs. That is why startup defers
    it rather than racing the producer's first frames with it.
    """
    client = _get_client()
    async with _get_cache_refresh_lock():
        try:
            await asyncio.to_thread(client.cache.refresh_cache)
        except Exception as e:
            logger.warning(f"[StatsAPI] Failed to refresh completer cache: {e}")


async def prime_caches() -> None:
    """Launch-time cache warmup, ordered so the board is never behind it.

    The mode list first: it is ~2s, and a HUD frame resolving a new game's tag
    blocks on it. The completer-cache rebuild after a delay: it is ~40s cold and
    starves the loop, and its whole purpose (not trusting a cache.pkl timestamp
    that can be a day stale) is served just as well a minute in as at second
    zero. Nothing on air reads it — it backs game-mode names in the COMPLETED
    games browser.
    """
    await fetch_game_modes()
    await asyncio.sleep(STARTUP_CACHE_REFRESH_DELAY)
    await refresh_completer_cache()
    logger.debug("[StatsAPI] deferred completer-cache refresh complete")


async def resolve_tag_set_name(tag_set_id, timeout: float | None = None) -> str:
    """Resolve a tag-set id (e.g. from a HUD/ongoing game) to its game-mode name.

    Ensures the game-mode cache is populated first. Returns '' when the id is
    missing, not an active game mode, or — when ``timeout`` is given — could not
    be resolved in time.

    ``timeout`` is for callers on a live path. Resolving costs a Project Rio
    round-trip the first time, and pyrio's session has no HTTP timeout of its
    own, so an unreachable API is an indefinite wait. A caller who is holding up
    something that is on air passes a budget and accepts '' — which is already
    the "unknown mode" answer, and already means "leave the current selection
    alone".
    """
    if tag_set_id is None or tag_set_id == -1:
        return ""
    modes = _game_modes
    if not modes:
        if timeout is None:
            modes = await fetch_game_modes()
        else:
            try:
                modes = await asyncio.wait_for(
                    asyncio.shield(fetch_game_modes()), timeout
                )
            except Exception:
                # shield: the in-flight fetch keeps going and fills the cache for
                # the next frame, rather than being cancelled and restarted by
                # whoever asks next.
                logger.debug("[StatsAPI] game-mode resolve timed out; leaving tag alone")
                return ""
    for name, tid in (modes or {}).items():
        if tid == tag_set_id:
            return name
    return ""

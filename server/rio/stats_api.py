"""Async wrapper around pyrio's RioWeb client for Project Rio API calls.

All Project Rio API interactions should go through this module.
RioWeb uses sync requests.Session, so calls are wrapped in asyncio.to_thread().
"""
import asyncio
from pathlib import Path
from typing import Optional

import pandas as pd
from loguru import logger
from server.paths import user_data_dir
from server.rio.pyrio.rio_web import RioWeb
from server.rio.pyrio.exceptions import RioAPIError

_client: RioWeb | None = None
_ENV_PATH = user_data_dir() / ".env"

# Diagnostic state for the last stats fetch
_last_fetch_info: dict = {
    "url": None,
    "tag": None,
    "players": {},  # {username: {"char_count": int, "error": str|None}}
    "fetched_at": None,
}

# Diagnostic state for the last completed games fetch
_last_completed_fetch_info: dict = {
    "url": None,
    "count": 0,
    "fetched_at": None,
    "error": None,
}


def get_last_fetch_info() -> dict:
    """Return diagnostic info about the last stats fetch."""
    return _last_fetch_info.copy()


def get_last_completed_fetch_info() -> dict:
    """Return diagnostic info about the last completed games fetch."""
    return _last_completed_fetch_info.copy()


def set_no_players_diagnostic(tag: str | None) -> None:
    """Record that a stats refresh was attempted but no players are set."""
    global _last_fetch_info
    from datetime import datetime, timezone
    _last_fetch_info = {
        "url": None,
        "tag": tag,
        "players": {},
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "error": "No players detected. A game must be active (via HUD or API) before stats can be fetched.",
    }


def load_rio_key() -> str | None:
    """Read the Rio API key from user_data/.env (format: RIO_KEY=<value>)."""
    if not _ENV_PATH.exists():
        return None
    for line in _ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith("RIO_KEY=") and len(line) > 8:
            return line[8:]
    return None


def save_rio_key(key: str) -> None:
    """Write the Rio API key to user_data/.env."""
    _ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    _ENV_PATH.write_text(f"RIO_KEY={key}\n")


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
) -> pd.DataFrame:
    """Fetch per-character stats from the Project Rio API in a single request.

    Uses by_user=1&by_char=1 with multiple username params.  The response
    is processed by pyrio's RioWeb._process_stats() into a flat DataFrame with:
      - Grouping columns: username, char_name
      - Stat columns: Batting_summary_at_bats, Pitching_batters_faced, etc.

    Returns an empty DataFrame on error.
    """
    global _last_fetch_info
    from datetime import datetime, timezone

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
    _last_fetch_info = {
        "url": diag_url,
        "tag": tag,
        "players": {u: {"char_count": 0, "error": None, "status": "loading"} for u in usernames},
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "status": "loading",
    }

    try:
        # raw=False → pyrio processes the response into a flat DataFrame
        df = await asyncio.to_thread(client.get_stats, params)

        for username in usernames:
            if not df.empty and "username" in df.columns:
                char_count = len(df[df["username"] == username])
            else:
                char_count = 0
            logger.info(f"[StatsAPI] Fetched stats for {username}: {char_count} characters")
            player_diag[username] = {"char_count": char_count, "error": None, "status": "done"}

    except RioAPIError as e:
        logger.warning(f"[StatsAPI] API error fetching stats: {e}")
        df = pd.DataFrame()
        for username in usernames:
            player_diag[username] = {"char_count": 0, "error": str(e), "status": "error"}
    except Exception as e:
        logger.error(f"[StatsAPI] Unexpected error fetching stats: {e}")
        df = pd.DataFrame()
        for username in usernames:
            player_diag[username] = {"char_count": 0, "error": str(e), "status": "error"}

    _last_fetch_info = {
        "url": diag_url,
        "tag": tag,
        "players": player_diag,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "status": "done",
    }

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
    from datetime import datetime, timezone
    from urllib.parse import urlencode

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


def _get_game_modes_lock() -> asyncio.Lock:
    global _game_modes_lock
    if _game_modes_lock is None:
        _game_modes_lock = asyncio.Lock()
    return _game_modes_lock


async def fetch_game_modes(force: bool = False) -> dict[str, int]:
    """Fetch active game modes from the Project Rio API.

    Returns: {game_mode_name: tag_set_id}
    Caches the result; pass force=True to re-fetch.
    """
    global _game_modes
    if _game_modes and not force:
        return _game_modes

    async with _get_game_modes_lock():
        # Double-check after acquiring lock (another coroutine may have filled it)
        if _game_modes and not force:
            return _game_modes

        client = _get_client()
        try:
            raw = await asyncio.to_thread(client.list_game_modes, active=True)
            tag_sets = raw.get("Tag Sets", [])
            _game_modes = {ts["name"]: ts["id"] for ts in tag_sets}
            logger.info(f"[StatsAPI] Fetched {len(_game_modes)} active game modes")
        except RioAPIError as e:
            logger.warning(f"[StatsAPI] API error fetching game modes: {e}")
        except Exception as e:
            logger.error(f"[StatsAPI] Unexpected error fetching game modes: {e}")

    return _game_modes

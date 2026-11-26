"""Every Project Rio web API call PRSH makes, through pyrio's ``AsyncRioClient``.

pyrio decodes each response into typed models (``StatRow``, ``GameSummary``,
``LiveGame``, ``TagSet``…) and raises ``pyrio.web.APIError`` for anything that
goes wrong on the wire. This module adds what is PRSH's own: the per-board
fetch diagnostics, the game-mode name caches the live path reads without
waiting, and completed games laid out as the row dicts the pools store.
"""
import asyncio
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
from loguru import logger

from pyrio import Character, RioError, Side, Stadium
from pyrio.web import APIError, AsyncRioClient, DiskCache, GameSummary, LiveGame, StatRow, TagKind

from server import socketio
from server.paths import user_data_dir

_client: AsyncRioClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None
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
    """Drop a scoreboard's diagnostics slot.

    Called by `StatsTracker.reset_scoreboard`, which is the one place that knows
    every moment a board's stats stop applying — don't call it beside that
    instead of through it, or the slot and the diagnostics describing it can
    disagree.
    """
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


# Connect fast, read slowly: the community fallback asks for a whole season's
# games in one query. pyrio retries transient failures on its own.
HTTP_TIMEOUT = httpx.Timeout(60.0, connect=5.0)
# Tag sets, tags and users barely change; pyrio keeps them on disk for a day.
REFERENCE_CACHE_TTL = 24 * 60 * 60


def _get_client() -> AsyncRioClient:
    """The shared client, rebuilt if the event loop changed (its connections belong to one loop)."""
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client_loop is not loop:
        _client = AsyncRioClient(
            api_key=load_rio_key(),
            timeout=HTTP_TIMEOUT,
            cache=DiskCache(user_data_dir() / "cache" / "rio", ttl=REFERENCE_CACHE_TTL),
        )
        _client_loop = loop
    return _client


def _base_url() -> str:
    return _get_client().base_url


def _clean(value: str) -> str:
    """Rio usernames and tags hold no whitespace; a pasted one sometimes does."""
    return "".join(value.split())


async def fetch_character_stats(
    usernames: list[str],
    tag: Optional[str] = None,
    scoreboard_number: int | None = None,
) -> list[StatRow]:
    """Per-player, per-character batting and pitching totals, in one request.

    One ``StatRow`` per (user, character), ``batting`` and ``pitching`` set.
    Returns ``[]`` on error, recorded in the board's diagnostics.

    Args:
        scoreboard_number: which scoreboard's diagnostics slot to write to.
            If None, no diagnostics are recorded (the fetch still runs).
    """
    usernames = [u for u in (_clean(u) for u in usernames) if u]
    tag = _clean(tag) if tag else None
    if not usernames:
        return []

    query = [("by_char", 1), ("by_user", 1), ("exclude_fielding", 1)]
    if tag:
        query.append(("tag", tag))
    query += [("username", u) for u in usernames]
    diag_url = f"{_base_url()}/stats/?{urlencode(query)}"

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

    player_diag = {}
    try:
        rows = await _get_client().stats(
            users=usernames,
            tags=[tag] if tag else None,
            by_user=True,
            by_character=True,
            exclude_fielding=True,
        )
        for username in usernames:
            char_count = sum(1 for r in rows if (r.user or "").casefold() == username.casefold())
            logger.info(f"[StatsAPI] sb{scoreboard_number} fetched stats for {username}: {char_count} characters")
            player_diag[username] = {"char_count": char_count, "error": None, "status": "done"}
    except RioError as e:
        logger.warning(f"[StatsAPI] sb{scoreboard_number} API error fetching stats: {e}")
        rows = []
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

    return rows


def completed_game_row(game: GameSummary) -> dict:
    """A finished game as the JSON-safe row the pools, matchups and boards read.

    Times are ISO 8601 in UTC; characters, the stadium and the game mode by
    name. A tie names the away player as the winner, as Rio web's own tables do.
    """
    winner = game.winner or Side.AWAY
    loser = winner.other
    line = game.linescore
    return {
        "game_id": game.game_id,
        "away_user": game.away.player,
        "home_user": game.home.player,
        "away_score": game.away.score,
        "home_score": game.home.score,
        "away_captain": game.away.captain.label,
        "home_captain": game.home.captain.label,
        "away_roster": [c.label for c in game.away.roster],
        "home_roster": [c.label for c in game.home.roster],
        "winner_user": game.team(winner).player,
        "loser_user": game.team(loser).player,
        "winner_score": game.team(winner).score,
        "loser_score": game.team(loser).score,
        "date_time_start": game.start_time.isoformat(),
        "date_time_end": game.end_time.isoformat(),
        "stadium": game.stadium.label,
        "innings_played": game.innings_played,
        "innings_selected": game.innings_selected,
        "tag_set": game.tag_set_id,
        "game_mode": mode_name_for(game.tag_set_id),
        "linescore": None if line is None else {"0": list(line.away), "1": list(line.home)},
    }


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
) -> list[dict]:
    """Finished games matching the filters, newest first, as ``completed_game_row`` dicts.

    Times are unix seconds; ``stadium`` a stadium id; captains by name. Returns
    ``[]`` on error, recorded in the completed-games diagnostics.
    ``include_teams`` is accepted for old callers: rosters always come back.
    """
    global _last_completed_fetch_info

    query = [("include_linescore", 1)]
    for key, values in (("tag", tag), ("username", username), ("vs_username", vs_username),
                        ("exclude_username", exclude_username), ("exclude_tag", exclude_tag)):
        query += [(key, v) for v in values or ()]
    for key, value in (("start_time", start_time), ("end_time", end_time), ("stadium", stadium),
                       ("limit_games", limit_games), ("captain", captain), ("vs_captain", vs_captain)):
        if value not in (None, ""):
            query.append((key, value))
    diag_url = f"{_base_url()}/games/?{urlencode(query)}"

    def when(seconds: int | None) -> datetime | None:
        return None if seconds is None else datetime.fromtimestamp(seconds, timezone.utc)

    try:
        await _ensure_mode_names()
        games = await _get_client().games(
            tags=tag or None,
            exclude_tags=exclude_tag or None,
            users=username or None,
            vs_users=vs_username or None,
            exclude_users=exclude_username or None,
            captains=[Character.parse(captain)] if captain else None,
            vs_captains=[Character.parse(vs_captain)] if vs_captain else None,
            stadiums=[Stadium(stadium)] if stadium is not None else None,
            start_time=when(start_time),
            end_time=when(end_time),
            limit_games=limit_games if limit_games is not None else 50,
            include_linescore=True,
        )
        rows = [completed_game_row(g) for g in games]
        logger.info(f"[StatsAPI] Fetched {len(rows)} completed games")
        _last_completed_fetch_info = {
            "url": diag_url,
            "count": len(rows),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }
        return rows
    except RioError as e:
        logger.warning(f"[StatsAPI] API error fetching completed games: {e}")
        _last_completed_fetch_info = {
            "url": diag_url,
            "count": 0,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "error": str(e),
        }
        return []


async def fetch_ongoing_games() -> list[LiveGame]:
    """Games in progress on Rio web; ``[]`` on error."""
    try:
        return await _get_client().live_games()
    except RioError as e:
        logger.warning(f"[StatsAPI] API error fetching live games: {e}")
        return []


# Active game modes: {name: id}. What a producer picks from.
_game_modes: dict[str, int] = {}
# Every tag set Rio web has named, ended seasons included: {id: name}. What a
# completed game's mode is named by.
_mode_names: dict[int, str] = {}
_game_modes_lock: asyncio.Lock | None = None
_cache_refresh_lock: asyncio.Lock | None = None
# The one in-flight fetch every budgeted (live-path) resolve shares, so a run of
# HUD frames waits on ONE request rather than queueing one each behind the lock.
_modes_task: asyncio.Task | None = None
# When the last mode fetch failed (loop time). Until MODES_RETRY_AFTER has passed
# an unforced fetch answers from the (empty) cache instead of asking again: every
# caller that finds the cache empty — each HUD frame of a cold-start game, each
# ongoing-pool tick — used to make its own request, so a Project Rio that was
# down or erroring got one call per frame per streamer for as long as it stayed
# down.
_modes_failed_at: float | None = None
MODES_RETRY_AFTER = 30.0

# How long a LIVE path (a HUD frame resolving its game mode) will wait on the
# game-mode list before giving up and leaving the tag alone. The board is on
# air; resolution is a nicety.
LIVE_RESOLVE_TIMEOUT = 2.0

# How long after launch the full tag-set catalogue is fetched. Nothing live
# reads it: it names the modes of COMPLETED games.
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


def _modes_backing_off() -> bool:
    """True while a recent failed mode fetch says not to ask again yet."""
    if _modes_failed_at is None:
        return False
    return asyncio.get_running_loop().time() - _modes_failed_at < MODES_RETRY_AFTER


def _get_cache_refresh_lock() -> asyncio.Lock:
    global _cache_refresh_lock
    if _cache_refresh_lock is None:
        _cache_refresh_lock = asyncio.Lock()
    return _cache_refresh_lock


async def fetch_game_modes(force: bool = False) -> dict[str, int]:
    """The active game modes, ``{name: tag_set_id}``, cached; ``force`` re-fetches.

    ``force`` also refreshes the full catalogue (``fetch_all_game_modes``) past
    its disk cache, so a just-added mode is named everywhere.
    """
    global _game_modes, _modes_failed_at
    if _game_modes and not force:
        return _game_modes
    if not force and _modes_backing_off():
        return _game_modes

    # The mode list first, and alone under this lock. Everything that waits on
    # `_game_modes` — including a HUD frame resolving a new game's tag — waits
    # exactly as long as this one call, and no longer.
    async with _get_game_modes_lock():
        if _game_modes and not force:
            return _game_modes
        # Re-checked under the lock: callers queued behind a failing fetch would
        # otherwise each go on to repeat it.
        if not force and _modes_backing_off():
            return _game_modes
        try:
            tag_sets = await _get_client().tag_sets.list(active_only=True)
            _game_modes = {ts.name: ts.id for ts in tag_sets}
            _mode_names.update({ts.id: ts.name for ts in tag_sets})
            _modes_failed_at = None
            logger.info(f"[StatsAPI] Fetched {len(_game_modes)} active game modes")
        except RioError as e:
            _modes_failed_at = asyncio.get_running_loop().time()
            logger.warning(f"[StatsAPI] API error fetching game modes: {e}")

    if force:
        await refresh_completer_cache()

    return _game_modes


async def _ensure_mode_names() -> None:
    """Fill the full catalogue once, for naming completed games' modes."""
    if not _mode_names or _mode_names.keys() <= set(_game_modes.values()):
        await warm_completer_cache()


def mode_name_for(tag_set_id: int | None) -> str:
    """A tag set's name from the cached catalogue; '' when unknown or none."""
    if tag_set_id is None:
        return ""
    return _mode_names.get(tag_set_id, "")


async def fetch_all_game_modes() -> dict[str, int]:
    """Every game mode Project Rio has ever named — ended seasons included.

    THE ACTIVE LIST IS NOT THE VOCABULARY. `fetch_game_modes` is the list to
    PICK from, but a board's mode comes from the game it is carrying, and a
    pool of completed games is mostly ended seasons that list no longer names.
    Anything that has to SAY or MATCH a mode (the console's pickers, the pool's
    mode filter) needs the whole catalogue. Falls back to the active list —
    never empty when we know anything at all.
    """
    await warm_completer_cache()
    if _mode_names:
        return {name: tag_set_id for tag_set_id, name in _mode_names.items()}
    return dict(await fetch_game_modes())


async def _load_catalogue(refresh: bool) -> None:
    async with _get_cache_refresh_lock():
        try:
            client = _get_client()
            if refresh and client.cache is not None:
                client.cache.clear()
            tag_sets = await client.tag_sets.list()
            _mode_names.update({ts.id: ts.name for ts in tag_sets})
        except RioError as e:
            logger.warning(f"[StatsAPI] Failed to read the full game-mode catalogue: {e}")


async def refresh_completer_cache() -> None:
    """Re-fetch the reference data (the tag-set catalogue) past pyrio's disk cache.

    For an explicit "refresh" the producer asked for.
    """
    await _load_catalogue(refresh=True)


async def warm_completer_cache() -> None:
    """Load the tag-set catalogue, from pyrio's disk cache while it is fresh."""
    await _load_catalogue(refresh=False)


async def prime_caches() -> None:
    """Launch-time cache warmup, ordered so the board is never behind it.

    The active mode list first: a HUD frame resolving a new game's tag blocks
    on it. The full catalogue after a delay: it names the modes in the
    COMPLETED games browser, and nothing on air waits for it.
    """
    await fetch_game_modes()
    await asyncio.sleep(STARTUP_CACHE_REFRESH_DELAY)
    await warm_completer_cache()
    logger.debug("[StatsAPI] deferred catalogue warm-up complete")


async def resolve_tag_set_name(tag_set_id, timeout: float | None = None) -> str:
    """Resolve a tag-set id (e.g. from a HUD/ongoing game) to its game-mode name.

    Ensures the game-mode cache is populated first. Returns '' when the id is
    missing, not an active game mode, or — when ``timeout`` is given — could not
    be resolved in time. A caller holding up something on air passes a budget
    and accepts '' — which is already the "unknown mode" answer, and already
    means "leave the current selection alone".
    """
    global _modes_task
    if tag_set_id is None or tag_set_id == -1:
        return ""
    modes = _game_modes
    if not modes:
        if timeout is None:
            modes = await fetch_game_modes()
        else:
            if _modes_task is None or _modes_task.done():
                _modes_task = asyncio.ensure_future(fetch_game_modes())
            try:
                modes = await asyncio.wait_for(
                    asyncio.shield(_modes_task), timeout
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


def game_mode_name(tag_set_id) -> str:
    """Cache-only resolve of a tag-set id to its ACTIVE game-mode name; '' if unknown.

    The synchronous sibling of resolve_tag_set_name, for callers ON the hot
    path — apply_parsed_game_to_state runs per HUD frame, and the perf contract
    for that path is no awaits that can become a network round-trip.
    """
    if tag_set_id is None or tag_set_id == -1:
        return ""
    for name, tid in (_game_modes or {}).items():
        if tid == tag_set_id:
            return name
    return ""


# ----- communities (address-book league import) ------------------------------
#
# A Rio COMMUNITY is the league's own membership list, and its game modes are
# its tag sets. The member list is the one call that can be refused — a PRIVATE
# community only answers it for a Rio key whose account is inside it, which is
# exactly the case for a league like the NNL. So a refused member list falls
# back to the people who have actually PLAYED in the community's modes: public,
# and for a league book the better answer anyway, since a member who has never
# played has nothing to put on air.

# Games per mode for the fallback. Rio's default is 50; a season is a few
# hundred games, so ask for them all.
_COMMUNITY_GAMES_PER_MODE = 1000


async def _community_tags():
    return await _get_client().tags.list(kinds=[TagKind.COMMUNITY])


async def fetch_communities() -> list[str]:
    tags = await _community_tags()
    return sorted({t.name for t in tags}, key=str.casefold)


async def fetch_community_roster(name: str) -> dict:
    """Everyone in a Rio community, plus the game modes it owns.

    Returns ``{community, modes, usernames, source, note}`` where ``source`` is
    ``members`` (the community's own list) or ``games`` (the fallback above).
    Raises ``LookupError`` when there is no such community.
    """
    client = _get_client()
    community = next((t for t in await _community_tags() if t.name == name), None)
    if community is None:
        raise LookupError(f"No Rio community named {name!r}")
    tag_sets = await client.tag_sets.list(community_ids=[community.community_id]) \
        if community.community_id is not None else []
    modes = [ts.name for ts in tag_sets]
    note = ""
    try:
        members = await client.communities.members(name)
        users = {u.id: u.name for u in await client.users.list()}
        usernames = [
            users[m.user_id] for m in members
            if m.is_active and not m.is_banned and m.user_id in users
        ]
        source = "members"
    except APIError as e:
        logger.info("[StatsAPI] community {} members refused ({}); using its games", name, e)
        note = str(e)
        # Three at a time: a burst of a dozen season-sized queries is enough to
        # draw a 500 from Rio, and a failed mode silently loses its players.
        gate = asyncio.Semaphore(3)

        async def one(mode):
            async with gate:
                return await fetch_completed_games(tag=[mode], limit_games=_COMMUNITY_GAMES_PER_MODE)

        seen = set()
        usernames = []
        for rows in await asyncio.gather(*(one(m) for m in modes)):
            for row in rows:
                for u in (row.get("away_user"), row.get("home_user")):
                    if u and u.casefold() not in seen:
                        seen.add(u.casefold())
                        usernames.append(u)
        source = "games"
    return {"community": name, "modes": modes, "usernames": usernames, "source": source, "note": note}

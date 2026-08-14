from loguru import logger
from server.utils.router import method
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import ORJSONResponse
from server.rio.game_pool import OngoingGamePool, CompletedGamePool, _pinned_swap_needed
from server.rio.stats_tracker import StatsTracker
from server.rio.provider import RioGameDataProvider
from server.rio.stats_api import get_last_completed_fetch_info
from server.settings import Settings

router = APIRouter()


# --- Ongoing games ---

@method(
    router.get, "/game-pool/ongoing",
    version="1", id="game_pool.ongoing.list",
    response_class=ORJSONResponse
)
async def list_ongoing_games(session_id: str | None = None) -> ORJSONResponse:
    """List all ongoing games from the shared API pool."""
    return ORJSONResponse(OngoingGamePool.list_games())


@method(
    router.post, "/game-pool/ongoing/refresh",
    version="1", id="game_pool.ongoing.refresh",
    response_class=ORJSONResponse
)
async def refresh_ongoing_games(session_id: str | None = None) -> ORJSONResponse:
    """Force an immediate re-poll of ongoing games."""
    await OngoingGamePool._fetch_games()
    return ORJSONResponse({"success": True, "count": len(OngoingGamePool.games)})


@method(
    router.post, "/game-pool/ongoing/auto-poll",
    version="1", id="game_pool.ongoing.auto_poll",
    response_class=ORJSONResponse
)
async def set_ongoing_auto_poll(
    enabled: bool = False,
    interval: float | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Enable or disable auto-polling for ongoing games."""
    await OngoingGamePool.set_auto_poll(enabled, interval)
    return ORJSONResponse({
        "success": True,
        "auto_poll": enabled,
        "interval": interval or OngoingGamePool._poll_interval,
    })


# --- Completed games ---

@method(
    router.get, "/game-pool/completed",
    version="1", id="game_pool.completed.list",
    response_class=ORJSONResponse
)
async def list_completed_games(
    session_id: str | None = None,
) -> ORJSONResponse:
    """List completed games currently in the pool."""
    return ORJSONResponse(CompletedGamePool.list_games())


@method(
    router.post, "/game-pool/completed/refresh",
    version="1", id="game_pool.completed.refresh",
    response_class=ORJSONResponse
)
async def refresh_completed_games(
    tag: list[str] | None = Query(None),
    username: list[str] | None = Query(None),
    vs_username: list[str] | None = Query(None),
    exclude_username: list[str] | None = Query(None),
    start_time: int | None = None,
    end_time: int | None = None,
    stadium: int | None = None,
    limit_games: int | None = None,
    captain: str | None = None,
    vs_captain: str | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Fetch completed games from the API with optional filters."""
    filters = {}
    if tag:
        filters["tag"] = tag
    if username:
        filters["username"] = username
    if vs_username:
        filters["vs_username"] = vs_username
    if exclude_username:
        filters["exclude_username"] = exclude_username
    if start_time is not None:
        filters["start_time"] = start_time
    if end_time is not None:
        filters["end_time"] = end_time
    if stadium is not None:
        filters["stadium"] = stadium
    if limit_games is not None:
        filters["limit_games"] = limit_games
    if captain:
        filters["captain"] = captain
    if vs_captain:
        filters["vs_captain"] = vs_captain

    try:
        await CompletedGamePool.fetch(filters if filters else None)
    except Exception as e:
        logger.exception("[game_pool] refresh_completed_games failed")
        diag = get_last_completed_fetch_info()
        diag["error"] = diag.get("error") or str(e)
        return ORJSONResponse({
            "success": False,
            "count": 0,
            "diagnostics": diag,
        }, status_code=500)

    diag = get_last_completed_fetch_info()
    return ORJSONResponse({
        "success": True,
        "count": len(CompletedGamePool.games),
        "diagnostics": diag,
    })


# --- Assign (works for both ongoing and completed) ---

@method(
    router.post, "/game-pool/assign",
    version="1", id="game_pool.assign",
    response_class=ORJSONResponse
)
async def assign_game(
    game_id: int,
    scoreboard_number: int,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Assign a game (ongoing or completed) to a scoreboard."""
    # Authoritative server-side guard: a HUD-transport board (board 1 with
    # hud_enabled) has the local game as its exclusive writer and is never
    # pool-assignable. Without this, a stale client (other tab, OBS browser
    # source, in-flight poll) could overwrite the HUD-driven data. Every other
    # board — single (live/completed picker) or set (feed) — is assignable.
    from server.bindings import transport
    if transport(scoreboard_number) == "hud":
        raise HTTPException(
            status_code=409,
            detail=f"scoreboard {scoreboard_number} is HUD-bound, not assignable",
        )

    # Detect whether this assignment is a *new* game for this scoreboard,
    # so live-game auto-poll re-applies (which fire on every poll cycle to
    # refresh score/state) don't trigger a stats refetch each tick.
    prev_game_id = Settings.Get(
        f"scoreboards.binding.{scoreboard_number}.playback.gameId"
    )
    is_new_game = prev_game_id != game_id

    # Try ongoing first, then completed
    if OngoingGamePool.get_game(game_id):
        game = OngoingGamePool.get_game(game_id)
        success = await OngoingGamePool.apply_game_to_scoreboard(game_id, scoreboard_number)
        if success:
            # Compute side swap the same way apply_game_to_scoreboard does so
            # the stats slot maps teams correctly when pushing.
            parsed = RioGameDataProvider.parse_game_data(game)
            entrants = parsed.get("entrants", [[{}], [{}]])
            p0 = entrants[0][0].get("rioName", "") if entrants[0] else ""
            p1 = entrants[1][0].get("rioName", "") if entrants[1] else ""
            sides_swapped = _pinned_swap_needed(p0, p1) is True

            if is_new_game:
                # New live game on this scoreboard — sync the per-scoreboard
                # stats_tag to this game's mode so the stats fetch uses the
                # right tag. Gated on is_new_game so the live auto-poll's
                # same-game re-applies don't re-trigger the frontend's
                # tag-change refresh effect on every tick.
                #
                # If the new game's mode is unknown ("" or "ID:..."), clear the
                # stats_tag rather than leaving the previous game's tag in place
                # — otherwise stats fetches run with the wrong tag for the game.
                game_mode_name = game.get("game_mode_name", "")
                if not game_mode_name or game_mode_name.startswith("ID:"):
                    # The ongoing pool bakes game_mode_name from the game-modes
                    # cache, which may have been cold when the pool was built —
                    # re-resolve from the raw tag_set id now that a fetch has had
                    # a chance to warm it.
                    from server.rio import stats_api
                    resolved = await stats_api.resolve_tag_set_name(game.get("tag_set"))
                    if resolved:
                        game_mode_name = resolved
                # One writer, one rule: it clears an unknown mode rather than
                # leaving the last game's, and it leaves a producer's PICK alone
                # (server/bindings.py sync_stats_tag).
                from server.bindings import sync_stats_tag
                await sync_stats_tag(scoreboard_number, game_mode_name)

                # Initialize the slot + historical API stats on first load.
                await StatsTracker.on_new_game(
                    game,
                    scoreboard_number=scoreboard_number,
                    await_fetch=True,
                    sides_swapped=sides_swapped,
                )

            # Record the current batter/pitcher game stats from the ongoing feed
            # and push the merged result. The feed only exposes the two active
            # characters, so the per-character current_game structure fills in
            # as the lineup cycles across polls — matching a HUD-sourced game.
            StatsTracker.on_live_game_update(game, scoreboard_number)
            await StatsTracker.push_stats_to_state(scoreboard_number, sides_swapped)
    elif CompletedGamePool.get_game(game_id):
        success = await CompletedGamePool.apply_game_to_scoreboard(game_id, scoreboard_number)
    else:
        raise HTTPException(status_code=404, detail="Game not found in any pool")

    return ORJSONResponse({"success": success})


# --- Backward compatibility: /game-pool still lists ongoing ---

@method(
    router.get, "/game-pool",
    version="1", id="game_pool.list",
    response_class=ORJSONResponse
)
async def list_games_compat(session_id: str | None = None) -> ORJSONResponse:
    """List ongoing games (backward compatibility)."""
    return ORJSONResponse(OngoingGamePool.list_games())

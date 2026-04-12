from server.utils.router import method
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from server.rio.provider import RioGameDataProvider
from server.settings import Settings
from server.state import State

router = APIRouter()


def _lowest_available_id(active: list[int]) -> int:
    """Find the smallest positive integer not in the active list."""
    used = set(active)
    n = 1
    while n in used:
        n += 1
    return n


@method(
    router.get, "/scoreboards",
    version="1", id="scoreboards.list",
    response_class=ORJSONResponse
)
async def list_scoreboards(session_id: str | None = None) -> ORJSONResponse:
    """List all active scoreboards with their source metadata."""
    active = await Settings.Get("scoreboards.active", [1])
    sources = await Settings.Get("scoreboards.sources", {})
    aliases = await Settings.Get("scoreboards.aliases", {})
    hud_target = await Settings.Get("scoreboards.hud_target", 1)

    scoreboards = []
    for sb_id in active:
        key = str(sb_id)
        source_cfg = sources.get(key, {"type": "manual", "api_game_id": None})
        scoreboards.append({
            "id": sb_id,
            "alias": aliases.get(key, ""),
            "source": source_cfg,
            "is_hud_target": sb_id == hud_target,
        })
    return ORJSONResponse(scoreboards)


@method(
    router.post, "/scoreboards",
    version="1", id="scoreboards.add",
    response_class=ORJSONResponse
)
async def add_scoreboard(session_id: str | None = None) -> ORJSONResponse:
    """Add a new scoreboard tab, reusing the lowest available ID."""
    active = await Settings.Get("scoreboards.active", [1])

    new_id = _lowest_available_id(active)
    active.append(new_id)
    active.sort()

    await Settings.Set("scoreboards.active", active)
    await Settings.Set(f"scoreboards.sources.{new_id}",
                       {"type": "manual", "api_game_id": None})

    return ORJSONResponse({"success": True, "id": new_id})


@method(
    router.delete, "/scoreboards/{sb_id}",
    version="1", id="scoreboards.remove",
    response_class=ORJSONResponse
)
async def remove_scoreboard(sb_id: int, session_id: str | None = None) -> ORJSONResponse:
    """Remove a scoreboard tab and clear its state."""
    active = await Settings.Get("scoreboards.active", [1])

    if len(active) <= 1:
        return ORJSONResponse({"success": False, "error": "Cannot remove last scoreboard"}, status_code=400)
    if sb_id not in active:
        return ORJSONResponse({"success": False, "error": "Scoreboard not found"}, status_code=404)

    # Clear state for this scoreboard
    await State.Unset(f"score.{sb_id}")

    # If this was the HUD target, clear it — don't auto-assign to another
    hud_target = await Settings.Get("scoreboards.hud_target", 1)
    if hud_target == sb_id:
        await Settings.Set("scoreboards.hud_target", 0)
        RioGameDataProvider._reset_side_preservation()

    active.remove(sb_id)
    await Settings.Set("scoreboards.active", active)
    await Settings.Unset(f"scoreboards.sources.{sb_id}")
    await Settings.Unset(f"scoreboards.aliases.{sb_id}")

    await State.Save()
    return ORJSONResponse({"success": True, "active": active})


@method(
    router.put, "/scoreboards/{sb_id}/source",
    version="1", id="scoreboards.set_source",
    response_class=ORJSONResponse
)
async def set_scoreboard_source(
    sb_id: int,
    source_type: str = "manual",
    api_game_id: str | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Set the data source for a scoreboard (manual, hud, or api)."""
    active = await Settings.Get("scoreboards.active", [1])
    if sb_id not in active:
        return ORJSONResponse({"success": False, "error": "Scoreboard not found"}, status_code=404)

    valid_types = ("manual", "hud", "live_game", "rotator")
    if source_type not in valid_types:
        return ORJSONResponse({"success": False, "error": f"Invalid source type. Must be one of: {valid_types}"}, status_code=400)

    # Clear scoreboard state on source change, except HUD → Manual (preserve displayed data)
    old_source = await Settings.Get(f"scoreboards.sources.{sb_id}.type", "manual")
    if old_source != source_type and not (old_source == "hud" and source_type == "manual"):
        await State.Set(f"score.{sb_id}", {})
        await State.Save()

    if source_type == "hud":
        # Unlink previous HUD target
        old_target = await Settings.Get("scoreboards.hud_target", 1)
        if old_target != sb_id and old_target in active:
            await Settings.Set(f"scoreboards.sources.{old_target}.type", "manual")

        await Settings.Set("scoreboards.hud_target", sb_id)
        RioGameDataProvider._reset_side_preservation()

        # Re-apply current HUD data to the new target
        if RioGameDataProvider.hud_watcher and RioGameDataProvider.hud_watcher.latest_game_data:
            parsed = RioGameDataProvider.parse_game_data(
                RioGameDataProvider.hud_watcher.latest_game_data
            )
            parsed = RioGameDataProvider._preserve_player_sides(parsed)
            RioGameDataProvider.current_game = parsed
            await RioGameDataProvider._apply_game_to_state(parsed)
    else:
        # If this was the HUD target, clear it
        hud_target = await Settings.Get("scoreboards.hud_target", 1)
        if hud_target == sb_id:
            await Settings.Set("scoreboards.hud_target", 0)

    await Settings.Set(f"scoreboards.sources.{sb_id}",
                       {"type": source_type, "api_game_id": api_game_id})

    # Flush any state changes accumulated during this handler (no-op if nothing changed)
    await State.Save()

    return ORJSONResponse({"success": True})


@method(
    router.put, "/scoreboards/{sb_id}/alias",
    version="1", id="scoreboards.set_alias",
    response_class=ORJSONResponse
)
async def set_scoreboard_alias(
    sb_id: int,
    alias: str = "",
    session_id: str | None = None,
) -> ORJSONResponse:
    """Set a display alias for a scoreboard tab."""
    active = await Settings.Get("scoreboards.active", [1])
    if sb_id not in active:
        return ORJSONResponse({"success": False, "error": "Scoreboard not found"}, status_code=404)

    alias = alias.strip()
    if alias:
        await Settings.Set(f"scoreboards.aliases.{sb_id}", alias)
    else:
        await Settings.Unset(f"scoreboards.aliases.{sb_id}")

    return ORJSONResponse({"success": True, "alias": alias})

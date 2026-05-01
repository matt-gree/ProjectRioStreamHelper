from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.rio.provider import RioGameDataProvider
from server.rio.rotation import RotationManager
from server.rio.stats_tracker import StatsTracker
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


def hud_target_scoreboards() -> list[int]:
    """Return all active scoreboards whose source type is 'hud'.

    HUD-target is derived from per-scoreboard source config rather than a
    separate setting, so any number of scoreboards can mirror the local HUD
    game simultaneously.
    """
    active = Settings.Get("scoreboards.active", [1])
    sources = Settings.Get("scoreboards.sources", {})
    return [sb for sb in active if sources.get(str(sb), {}).get("type") == "hud"]


@method(
    router.get, "/scoreboards",
    version="1", id="scoreboards.list",
    response_class=ORJSONResponse
)
async def list_scoreboards(session_id: str | None = None) -> ORJSONResponse:
    """List all active scoreboards with their source metadata."""
    active = Settings.Get("scoreboards.active", [1])
    sources = Settings.Get("scoreboards.sources", {})
    aliases = Settings.Get("scoreboards.aliases", {})

    scoreboards = []
    for sb_id in active:
        key = str(sb_id)
        source_cfg = sources.get(key, {"type": "manual", "api_game_id": None})
        scoreboards.append({
            "id": sb_id,
            "alias": aliases.get(key, ""),
            "source": source_cfg,
            "is_hud_target": source_cfg.get("type") == "hud",
        })
    return ORJSONResponse(scoreboards)


@method(
    router.post, "/scoreboards",
    version="1", id="scoreboards.add",
    response_class=ORJSONResponse
)
async def add_scoreboard(session_id: str | None = None) -> ORJSONResponse:
    """Add a new scoreboard tab, reusing the lowest available ID."""
    active = Settings.Get("scoreboards.active", [1])

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
    active = Settings.Get("scoreboards.active", [1])

    if len(active) <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove last scoreboard")
    if sb_id not in active:
        raise HTTPException(status_code=404, detail="Scoreboard not found")

    # Clear state for this scoreboard
    await State.Unset(f"score.{sb_id}")

    old_source = Settings.Get(f"scoreboards.sources.{sb_id}.type")

    # Tear down any background work owned by this scoreboard before its
    # settings are removed, so resume-on-startup can't pick it back up.
    await RotationManager.stop_rotation(sb_id)
    await Settings.Unset(f"scoreboards.rotation.{sb_id}")

    active.remove(sb_id)
    await Settings.Set("scoreboards.active", active)
    await Settings.Unset(f"scoreboards.sources.{sb_id}")
    await Settings.Unset(f"scoreboards.aliases.{sb_id}")

    StatsTracker.reset_scoreboard(sb_id)
    if old_source == "hud":
        RioGameDataProvider._reset_side_preservation()
    else:
        RioGameDataProvider.refresh_hud_targets()

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
    active = Settings.Get("scoreboards.active", [1])
    if sb_id not in active:
        raise HTTPException(status_code=404, detail="Scoreboard not found")

    valid_types = ("manual", "hud", "live_game", "rotator")
    if source_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid source type. Must be one of: {valid_types}")

    # Clear scoreboard state on source change, except HUD → Manual (preserve displayed data)
    old_source = Settings.Get(f"scoreboards.sources.{sb_id}.type", "manual")
    source_changed = old_source != source_type
    if source_changed and not (old_source == "hud" and source_type == "manual"):
        await State.Set(f"score.{sb_id}", {})
        await State.Save()

    # Stop any rotation when leaving the rotator source so it can't keep
    # writing into a scoreboard the user has reassigned. Persist enabled=False
    # so resume-on-startup also skips it.
    if source_changed and old_source == "rotator":
        await RotationManager.stop_rotation(sb_id)

    # Update only the keys that this endpoint owns. Preserve sibling keys
    # (e.g. stats_tag) so a source-type change doesn't silently drop the
    # user's per-scoreboard game-mode selection.
    await Settings.Set(f"scoreboards.sources.{sb_id}.type", source_type)
    await Settings.Set(f"scoreboards.sources.{sb_id}.api_game_id", api_game_id)

    # Drop this scoreboard's stats slot whenever the source actually changes —
    # the previous source's cached players/rosters no longer apply.
    if source_changed:
        StatsTracker.reset_scoreboard(sb_id)

    if source_type == "hud":
        # Side preservation operates on the single HUD-derived game shared by
        # all HUD targets, so resetting it on any HUD-target change is fine.
        # _reset_side_preservation also refreshes the cached HUD-target list.
        RioGameDataProvider._reset_side_preservation()

        # Re-apply current HUD data to all HUD targets (which now includes sb_id)
        if RioGameDataProvider.hud_watcher and RioGameDataProvider.hud_watcher.latest_game_data:
            parsed = RioGameDataProvider.parse_game_data(
                RioGameDataProvider.hud_watcher.latest_game_data
            )
            parsed = RioGameDataProvider._preserve_player_sides(parsed)
            RioGameDataProvider.current_game = parsed
            await RioGameDataProvider._apply_game_to_state(parsed)
    elif old_source == "hud":
        # Demoted from HUD — refresh the cached target list so the watcher
        # stops writing into this scoreboard.
        RioGameDataProvider.refresh_hud_targets()

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
    active = Settings.Get("scoreboards.active", [1])
    if sb_id not in active:
        raise HTTPException(status_code=404, detail="Scoreboard not found")

    alias = alias.strip()
    if alias:
        await Settings.Set(f"scoreboards.aliases.{sb_id}", alias)
    else:
        await Settings.Unset(f"scoreboards.aliases.{sb_id}")

    return ORJSONResponse({"success": True, "alias": alias})

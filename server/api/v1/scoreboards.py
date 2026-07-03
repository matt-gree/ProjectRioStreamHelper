from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.bindings import DEFAULT_BINDING, get_binding, transport
from server.bindings import hud_target_scoreboards as _hud_target_scoreboards
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
    """Scoreboards that mirror the local HUD game — at most board 1.

    HUD is a global transport on board 1 (Settings `project_rio.hud_enabled`),
    so this returns `[1]` when board 1 is active and enabled, else `[]`.
    Kept as a re-export for existing importers (see server/bindings.py).
    """
    return _hud_target_scoreboards()


@method(
    router.get, "/scoreboards",
    version="1", id="scoreboards.list",
    response_class=ORJSONResponse
)
async def list_scoreboards(session_id: str | None = None) -> ORJSONResponse:
    """List all active scoreboards with their binding metadata."""
    active = Settings.Get("scoreboards.active", [1])
    aliases = Settings.Get("scoreboards.aliases", {})

    scoreboards = []
    for sb_id in active:
        key = str(sb_id)
        scoreboards.append({
            "id": sb_id,
            "alias": aliases.get(key, ""),
            "binding": get_binding(sb_id),
            "transport": transport(sb_id),
            "is_hud_target": transport(sb_id) == "hud",
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
    await Settings.Set(f"scoreboards.binding.{new_id}", dict(DEFAULT_BINDING))

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

    was_hud = transport(sb_id) == "hud"

    # Tear down any background work owned by this scoreboard before its
    # settings are removed, so resume-on-startup can't pick it back up.
    await RotationManager.stop_rotation(sb_id)
    await Settings.Unset(f"scoreboards.rotation.{sb_id}")

    active.remove(sb_id)
    await Settings.Set("scoreboards.active", active)
    await Settings.Unset(f"scoreboards.binding.{sb_id}")
    await Settings.Unset(f"scoreboards.aliases.{sb_id}")

    StatsTracker.reset_scoreboard(sb_id)
    if was_hud:
        RioGameDataProvider._reset_side_preservation()
    else:
        RioGameDataProvider.refresh_hud_targets()

    await State.Save()
    return ORJSONResponse({"success": True, "active": active})


@method(
    router.put, "/scoreboards/{sb_id}/binding",
    version="1", id="scoreboards.set_binding",
    response_class=ORJSONResponse
)
async def set_scoreboard_binding(
    sb_id: int,
    kind: str = "single",
    pool: str | None = None,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Set a scoreboard's binding kind (single | set) and optional pool.

    Transport (HUD vs API) is derived, not set here — board 1 carries the HUD
    when `project_rio.hud_enabled` (see server/bindings.py). A HUD-transport
    board ignores its binding kind, but the write is still accepted so toggling
    HUD off later reveals the stored kind.
    """
    active = Settings.Get("scoreboards.active", [1])
    if sb_id not in active:
        raise HTTPException(status_code=404, detail="Scoreboard not found")

    if kind not in ("single", "set"):
        raise HTTPException(status_code=400, detail="kind must be 'single' or 'set'")

    old = get_binding(sb_id)
    old_kind = old.get("kind", "single")
    kind_changed = old_kind != kind

    # Leaving set mode stops any running feed so it can't keep writing into a
    # board the user has switched to single. Persists enabled=False for resume.
    if old_kind == "set" and kind != "set":
        await RotationManager.stop_rotation(sb_id)

    await Settings.Set(f"scoreboards.binding.{sb_id}.kind", kind)
    if pool in ("both", "live", "completed"):
        await Settings.Set(f"scoreboards.binding.{sb_id}.pool", pool)

    # On a real mode change, clear the stale frame + game reference + stats slot
    # (the previous mode's game no longer applies). A HUD-transport board is left
    # alone — the HUD writer owns it.
    if kind_changed and transport(sb_id) != "hud":
        await Settings.Set(f"scoreboards.binding.{sb_id}.gameId", None)
        await State.Set(f"score.{sb_id}", {})
        StatsTracker.reset_scoreboard(sb_id)
        await State.Save()

    return ORJSONResponse({"success": True, "binding": get_binding(sb_id)})


@method(
    router.put, "/scoreboards/hud-enabled",
    version="1", id="scoreboards.set_hud_enabled",
    response_class=ORJSONResponse
)
async def set_hud_enabled(
    enabled: bool = True,
    session_id: str | None = None,
) -> ORJSONResponse:
    """Toggle the global HUD transport on board 1.

    On → refresh HUD targets and re-apply the latest HUD game to board 1.
    Off → refresh HUD targets (board 1 reverts to its own binding). The last
    HUD frame is left on screen (like the old HUD→Manual behavior); it becomes
    editable again.
    """
    await Settings.Set("project_rio.hud_enabled", bool(enabled))

    # Side-preservation caches the HUD-target list; reset recomputes it.
    RioGameDataProvider._reset_side_preservation()

    if enabled and RioGameDataProvider.hud_watcher \
            and RioGameDataProvider.hud_watcher.latest_game_data:
        parsed = RioGameDataProvider.parse_game_data(
            RioGameDataProvider.hud_watcher.latest_game_data
        )
        parsed = RioGameDataProvider._preserve_player_sides(parsed)
        RioGameDataProvider.current_game = parsed
        await RioGameDataProvider._apply_game_to_state(parsed)

    await State.Save()
    return ORJSONResponse({"success": True, "hud_enabled": bool(enabled)})


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

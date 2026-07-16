from server.utils.router import method
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from server.bindings import DEFAULT_BINDING, get_binding, transport
from server.bindings import hud_target_scoreboards as _hud_target_scoreboards
from server.rio.provider import RioGameDataProvider
from server.rio.rotation import PoolManager
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
    await PoolManager.stop_rotation(sb_id, user_stop=False)
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
    """Set a scoreboard's playback mode and optional pool scope.

    `kind` accepts "single" or "set"/"rotate" ("set" kept as an alias for
    backward compatibility with pre-pool-unification callers) and maps onto
    `playback.mode`. This endpoint only flips the mode metadata — it does not
    itself start a rotation (see `POST /rotation/{sb}/start`), matching the
    pre-existing split between "switch this board to rotate mode" (here) and
    "start rotating the configured pool" (rotation.py).

    Transport (HUD vs API) is derived, not set here — board 1 carries the HUD
    when `project_rio.hud_enabled` (see server/bindings.py). A HUD-transport
    board ignores its playback mode, but the write is still accepted so
    toggling HUD off later reveals the stored mode.
    """
    active = Settings.Get("scoreboards.active", [1])
    if sb_id not in active:
        raise HTTPException(status_code=404, detail="Scoreboard not found")

    if kind not in ("single", "set", "rotate"):
        raise HTTPException(status_code=400, detail="kind must be 'single' or 'rotate'")
    mode = "rotate" if kind in ("set", "rotate") else "single"

    old_mode = get_binding(sb_id)["playback"].get("mode", "single")
    mode_changed = old_mode != mode

    # Leaving rotate mode stops any running pool task so it can't keep writing
    # into a board the user has switched to single.
    if old_mode == "rotate" and mode != "rotate":
        await PoolManager.stop_rotation(sb_id, user_stop=True)

    await Settings.Set(f"scoreboards.binding.{sb_id}.playback.mode", mode)
    if pool in ("both", "live", "completed"):
        await Settings.Set(f"scoreboards.binding.{sb_id}.pool.scope", pool)

    # On a real mode change, clear the stale frame + game reference + stats slot
    # (the previous mode's game no longer applies). A HUD-transport board is left
    # alone — the HUD writer owns it.
    if mode_changed and transport(sb_id) != "hud":
        await Settings.Set(f"scoreboards.binding.{sb_id}.playback.gameId", None)
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
    router.post, "/scoreboards/reset",
    version="1", id="scoreboards.reset",
    response_class=ORJSONResponse
)
async def reset_scoreboard_state(session_id: str | None = None) -> ORJSONResponse:
    """Reset all match + scoreboard state back to a clean baseline.

    Recovery hatch for corrupt/stuck state — e.g. a board left in ``rotate``
    mode after an HUD-off session (which then rejects match binds as "rotating"),
    an orphaned match binding, or a stuck match_conflict. Keeps the active
    scoreboard tabs (and the global HUD toggle) but returns every board to a
    default single binding and deletes every authored match.

    Steps: stop all rotations → delete all matches (unbind + blank + drop
    conflicts) → reset each active board's binding to the single default →
    clear each board's live score state and rotation status → reset HUD
    side-preservation → re-apply the current HUD frame to board 1 if HUD is on.
    """
    import copy

    from server.match import Match

    active = Settings.Get("scoreboards.active", [1])

    # 1. Stop every rotation so no background task keeps writing during the reset.
    for sb_id in list(active):
        await PoolManager.stop_rotation(sb_id, user_stop=True)

    # 2. Delete every authored match — unbind and blank the boards it held first.
    for m in list(Match._all().keys()):
        bound = Match.bound_scoreboards(m)
        if bound:
            await State.UnsetBatch(
                [k for sb in bound
                 for k in (f"score.{sb}.match", f"score.{sb}.match_conflict")]
            )
        for sb in bound:
            await Match.clear_scoreboard(sb)
        await State.Unset(f"match.{m}")

    # 3. Reset each board to a clean single binding and blank its live state.
    for sb_id in list(active):
        await Settings.Set(f"scoreboards.binding.{sb_id}", copy.deepcopy(DEFAULT_BINDING))
        await State.Set(f"score.{sb_id}", {})
        await State.Unset(f"scoreboards.rotation.{sb_id}")
        StatsTracker.reset_scoreboard(sb_id)

    await State.Save()

    # 4. Reset side-preservation and re-seat the current HUD frame on board 1.
    RioGameDataProvider._reset_side_preservation()
    if RioGameDataProvider.hud_watcher \
            and RioGameDataProvider.hud_watcher.latest_game_data \
            and 1 in RioGameDataProvider._hud_targets:
        parsed = RioGameDataProvider.parse_game_data(
            RioGameDataProvider.hud_watcher.latest_game_data
        )
        parsed = RioGameDataProvider._preserve_player_sides(parsed)
        RioGameDataProvider.current_game = parsed
        await RioGameDataProvider._apply_game_to_state(parsed)
        await State.Save()

    return ORJSONResponse({"success": True, "active": active})


@method(
    router.put, "/scoreboards/{sb_id}/player/{team}/name-override",
    version="1", id="scoreboards.set_name_override",
    response_class=ORJSONResponse
)
async def set_player_name_override(
    sb_id: int,
    team: int,
    name: str = "",
    session_id: str | None = None,
) -> ORJSONResponse:
    """Pin (or clear) a manual name override for one player slot.

    The override BECOMES the slot's identity: it wins over the feed name, so it
    drives the overlay name, address-book resurface, the match identity gate,
    and the stats fetch — while the HUD keeps feeding roster/scores/gameplay.
    It persists across same-game HUD frames and is cleared automatically on a
    new HUD game (see `RioGameDataProvider._clear_name_overrides`). Passing an
    empty name clears the override immediately.

    Applies to any board, but is primarily for HUD/live boards whose feed would
    otherwise overwrite a hand-typed name every frame.
    """
    import asyncio

    if team not in (1, 2):
        raise HTTPException(status_code=400, detail="team must be 1 or 2")
    active = Settings.Get("scoreboards.active", [1])
    if sb_id not in active:
        raise HTTPException(status_code=404, detail="Scoreboard not found")

    name = name.strip()
    key = f"score.{sb_id}.player.{team}.rioName_override"
    if name:
        await State.Set(key, name)
    else:
        await State.Unset(key)

    # Re-apply so the effective rioName + resurface reflect the change now. A
    # HUD/live board re-runs its current frame (which reads the override back);
    # a board with no live frame gets the value written straight through.
    prov = RioGameDataProvider
    if sb_id in prov._hud_targets and prov.current_game is not None:
        await prov._apply_game_to_state(prov.current_game)
    elif name:
        await State.Set(f"score.{sb_id}.player.{team}.rioName", name)
    await State.Save()

    # Stats follow the (new) identity — fetch in the background so the click
    # returns immediately; the merged stats broadcast when ready.
    asyncio.create_task(StatsTracker.refresh_api_stats(sb_id))

    return ORJSONResponse({"success": True, "override": name})


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

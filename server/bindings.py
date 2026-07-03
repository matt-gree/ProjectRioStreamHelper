"""Scoreboard binding model — the single source of truth for what fills a
scoreboard.

Replaces the old `scoreboards.sources.{N}.type` enum (manual | hud | live_game)
+ orthogonal `scoreboards.rotation.{N}` feed with one unified binding:

    scoreboards.binding.{N} = {
        "kind":      "single" | "set",   # one game vs a rotating pool
        "gameId":    str | int | null,   # single: null = manual/editable board
        "pool":      "both" | "live" | "completed",
        "stats_tag": str | null,         # per-scoreboard game-mode tag
    }

**Transport** (HUD file vs API) is *derived*, not user-picked: board 1 is the
only board that can carry the local HUD, and does so iff the global
`project_rio.hud_enabled` toggle is on. Every other board is API transport.

This module holds only pure accessors that depend on Settings, so it can be
imported from both the API layer and the rio data layer without cycles.
"""

from server.settings import Settings

DEFAULT_BINDING = {
    "kind": "single",
    "gameId": None,
    "pool": "both",
    "stats_tag": None,
}


def get_binding(sb_id: int) -> dict:
    """Return the binding dict for a scoreboard, filled with defaults."""
    raw = Settings.Get(f"scoreboards.binding.{sb_id}", None)
    if not isinstance(raw, dict):
        return dict(DEFAULT_BINDING)
    return {**DEFAULT_BINDING, **raw}


def hud_enabled() -> bool:
    """Whether the local HUD transport is active (global toggle)."""
    return bool(Settings.Get("project_rio.hud_enabled", True))


def transport(sb_id: int) -> str:
    """Derived transport for a scoreboard: 'hud' (board 1 + hud_enabled) or 'api'."""
    return "hud" if int(sb_id) == 1 and hud_enabled() else "api"


def hud_target_scoreboards() -> list[int]:
    """Scoreboards that mirror the local HUD game — at most board 1.

    HUD is a global transport on board 1, so this returns `[1]` when board 1 is
    active and `hud_enabled`, else `[]`.
    """
    active = Settings.Get("scoreboards.active", [1])
    return [1] if (1 in active and hud_enabled()) else []


def is_set(sb_id: int) -> bool:
    """Whether a scoreboard is bound to a rotating set (vs a single game)."""
    return get_binding(sb_id).get("kind") == "set"


def binding_stats_tag(sb_id: int) -> str | None:
    """Per-scoreboard game-mode stats tag."""
    return get_binding(sb_id).get("stats_tag")

"""Scoreboard binding model — the single source of truth for what fills a
scoreboard.

Replaces the old `scoreboards.sources.{N}.type` enum (manual | hud | live_game)
+ orthogonal `scoreboards.rotation.{N}` feed, and the intermediate
`kind: single|set` binding, with one **pool + playback** model (see
~/.claude/plans/pool-playback-unification.md):

    scoreboards.binding.{N} = {
        "pool": {
            "filters":  [ {id, tag: [...], username: [...],
                           vs_username: [...], limit_games}, ... ],
            "scope":    "live" | "completed" | "both",
            "pinned":   [gameId, ...],   # always in, regardless of filter
            "excluded": [gameId, ...],   # never in, even if it matches
        },
        "playback": {
            "mode":          "single" | "rotate",
            "gameId":        str | int | null,  # single: null = auto-follow
            "interval":      seconds,           # rotate
            "current_index": int,               # rotate runtime cursor
            "interrupt":     dict | null,        # reserved, not implemented
        },
        "stats_tag": str | null,   # per-scoreboard game-mode tag
    }

A `playback.mode == "single"` binding with an empty pool and no pinned
`gameId` is the manual/editable board — "manual" is not a source type, it's
the empty state of this model.

**Transport** (HUD file vs API) is *derived*, not user-picked: board 1 is the
only board that can carry the local HUD, and does so iff the global
`project_rio.hud_enabled` toggle is on. Every other board is API transport.

This module holds only pure accessors that depend on Settings, so it can be
imported from both the API layer and the rio data layer without cycles.
"""

from server.settings import Settings

DEFAULT_POOL = {
    "filters": [],
    "scope": "both",
    "pinned": [],
    "excluded": [],
    "pinned_cache": {},
    # How often (seconds) to recompute membership against `filters` — the
    # live half is free (filters an already-polled in-memory list); the
    # completed half hits the Project Rio API per chip, so this is the "poll
    # speed" knob. 0 = static (pinned-only; filters present but inert) —
    # this is what a migrated legacy rotation gets, since the old model's
    # auto-poll was additive-only and this one adds *and* removes, a
    # semantics change users should opt into explicitly.
    "refresh_interval": 60,
}

DEFAULT_PLAYBACK = {
    "mode": "single",
    "gameId": None,
    "interval": 30,
    "current_index": 0,
    "interrupt": None,
}

DEFAULT_BINDING = {
    "pool": DEFAULT_POOL,
    "playback": DEFAULT_PLAYBACK,
    "stats_tag": None,
}


def get_binding(sb_id: int) -> dict:
    """Return the binding dict for a scoreboard, filled with defaults.

    `pool` and `playback` are merged one level deep against their defaults
    (not just shallow-replaced) so a partially-populated sub-dict — e.g. one
    written by an endpoint that only touches `playback.interval` — doesn't
    lose sibling keys.
    """
    raw = Settings.Get(f"scoreboards.binding.{sb_id}", None)
    if not isinstance(raw, dict):
        raw = {}
    return {
        **DEFAULT_BINDING,
        **raw,
        "pool": {**DEFAULT_POOL, **(raw.get("pool") or {})},
        "playback": {**DEFAULT_PLAYBACK, **(raw.get("playback") or {})},
    }


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


def is_rotating(sb_id: int) -> bool:
    """Whether a scoreboard is rotating a pool (vs a frozen single game).

    Renamed from `is_set` (the old `kind: single|set` binding). Same
    semantics: callers using this to gate "can this board be assigned a
    game / bound to a match" should still read it as "not currently rotating".
    """
    return get_binding(sb_id).get("playback", {}).get("mode") == "rotate"


def playback_mode(sb_id: int) -> str:
    """The scoreboard's playback mode: 'single' or 'rotate'."""
    return get_binding(sb_id).get("playback", {}).get("mode", "single")


def pool(sb_id: int) -> dict:
    """The scoreboard's pool config (filters/scope/pinned/excluded)."""
    return get_binding(sb_id).get("pool", dict(DEFAULT_POOL))


def binding_stats_tag(sb_id: int) -> str | None:
    """Per-scoreboard game-mode stats tag."""
    return get_binding(sb_id).get("stats_tag")

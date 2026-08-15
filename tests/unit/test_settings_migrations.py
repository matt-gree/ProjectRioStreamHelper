"""Settings.Load migrations.

These run on real upgrades, so a regression silently resets users' config.
Each test writes a legacy settings.json into the isolated temp path and loads it.
"""
import orjson

from server.settings import Settings

# Every overlay migration bumps this, so tests assert "fully migrated" rather
# than pinning the number a given migration happened to land on.
CURRENT_OVERLAY_SCHEMA = Settings.settings["overlays"]["schema_version"]


def _write_settings(path, data):
    (path / "settings.json").write_bytes(orjson.dumps(data))


async def test_legacy_lan_host_migrates_to_allow_lan(isolate_user_data):
    _write_settings(isolate_user_data, {"server": {"host": "0.0.0.0", "port": 5260}})
    await Settings.Load()
    # Non-loopback host preserved LAN access via the new flag...
    assert Settings.settings["server"]["allow_lan"] is True
    # ...and the legacy key is dropped.
    assert "host" not in Settings.settings["server"]


async def test_legacy_loopback_host_does_not_enable_lan(isolate_user_data):
    _write_settings(isolate_user_data, {"server": {"host": "127.0.0.1"}})
    await Settings.Load()
    assert Settings.settings["server"]["allow_lan"] is False
    assert "host" not in Settings.settings["server"]


async def test_no_host_key_leaves_allow_lan_default(isolate_user_data):
    _write_settings(isolate_user_data, {"server": {"port": 5300}})
    await Settings.Load()
    assert Settings.settings["server"]["allow_lan"] is False
    assert Settings.settings["server"]["port"] == 5300


async def test_overlay_schema_v1_strips_promoted_globals(isolate_user_data):
    _write_settings(isolate_user_data, {
        "overlays": {
            "schema_version": 1,
            "scoreboard": {"showElo": False, "accentColor": "#abcdef"},
        },
    })
    await Settings.Load()
    overlays = Settings.settings["overlays"]
    # accentColor is now a global — its stale per-layout copy is removed...
    assert "accentColor" not in overlays["scoreboard"]
    # ...while the genuinely layout-specific key survives. An explicit False is
    # not the seeded value v3 clears, so it rides through both migrations.
    assert overlays["scoreboard"]["showElo"] is False
    assert overlays["schema_version"] == CURRENT_OVERLAY_SCHEMA


"""
v3 flipped ELO's default to off. A settings file written before that carries the
SEEDED `showElo: true`, so leaving it would mean the new default never reaches
anyone who had already run the app — the migration clears the key so the default
applies. Only the un-scoped leaf: nothing seeds a per-board pin, so one is
always a producer's own choice.
"""


async def test_overlay_schema_v3_clears_the_seeded_elo_true(isolate_user_data):
    _write_settings(isolate_user_data, {
        "overlays": {"schema_version": 2, "scoreboard": {"showElo": True}},
    })
    await Settings.Load()
    overlays = Settings.settings["overlays"]
    assert overlays["schema_version"] == CURRENT_OVERLAY_SCHEMA
    assert "showElo" not in overlays["scoreboard"]


async def test_overlay_schema_v3_keeps_a_per_board_elo_pin(isolate_user_data):
    _write_settings(isolate_user_data, {
        "overlays": {
            "schema_version": 2,
            "scoreboard": {"showElo": True, "2": {"showElo": True}},
        },
    })
    await Settings.Load()
    sb = Settings.settings["overlays"]["scoreboard"]
    assert "showElo" not in sb            # seeded leaf cleared
    assert sb["2"]["showElo"] is True     # deliberate pin kept


async def test_overlay_schema_v3_is_left_untouched(isolate_user_data):
    _write_settings(isolate_user_data, {
        "overlays": {"schema_version": 3, "scoreboard": {"showElo": True}},
    })
    await Settings.Load()
    # Later migrations still run (the version moves on), but v3's own clearing
    # does not: already migrated, so a `true` here is a producer turning it
    # back ON.
    assert Settings.settings["overlays"]["schema_version"] == CURRENT_OVERLAY_SCHEMA
    assert Settings.settings["overlays"]["scoreboard"]["showElo"] is True


"""
v4 promoted the controller-port palette to a global. It was read per layout by
five mounts but had a UI on exactly one — the Character Spotlight — so its copy
is the one that wins; any other namespace's is carried up only if nothing has
claimed that port yet. Every per-layout copy goes, because two places storing
one palette is how they drift back apart.
"""


async def test_overlay_schema_v4_promotes_the_port_palette(isolate_user_data):
    _write_settings(isolate_user_data, {
        "overlays": {
            "schema_version": 3,
            "postgamecallout": {"port0Color": "#111111", "port1Color": "#222222"},
            "scorecard": {"port1Color": "#999999", "port2Color": "#333333", "mainMode": "full"},
        },
    })
    await Settings.Load()
    overlays = Settings.settings["overlays"]
    assert overlays["schema_version"] == CURRENT_OVERLAY_SCHEMA
    # The spotlight's copies win; the scorecard's port 3 fills a port nobody
    # else claimed; its port 2 loses to the spotlight rather than overwriting.
    assert overlays["global"]["port0Color"] == "#111111"
    assert overlays["global"]["port1Color"] == "#222222"
    assert overlays["global"]["port2Color"] == "#333333"
    assert overlays["global"]["port3Color"] is None
    # ...and nothing per-layout is left to drift, while the scorecard's own
    # settings ride through untouched.
    assert overlays["postgamecallout"] == {}
    assert "port1Color" not in overlays["scorecard"]
    assert overlays["scorecard"]["mainMode"] == "full"


async def test_overlay_schema_v4_leaves_an_unset_palette_inheriting(isolate_user_data):
    """No stored port colours = nothing to promote. The four globals stay None,
    which is INHERIT (the design package's palette, then the app's own) — a
    migration that wrote literal hexes here would pin the old defaults over
    every package a producer installs later."""
    _write_settings(isolate_user_data, {"overlays": {"schema_version": 3}})
    await Settings.Load()
    glob = Settings.settings["overlays"]["global"]
    assert [glob[f"port{i}Color"] for i in range(4)] == [None] * 4


# --- Pool + playback migration (schema v2) ---
# See ~/.claude/plans/pool-playback-unification.md. Runs after the v1
# kind/gameId/pool binding migration, collapsing it into pool (filters/scope/
# pinned/excluded) + playback (mode/gameId/interval/current_index).

async def test_v1_single_binding_migrates_to_playback_single(isolate_user_data):
    _write_settings(isolate_user_data, {
        "scoreboards": {
            "active": [1],
            "binding": {"1": {"kind": "single", "gameId": "G1", "pool": "both", "stats_tag": "Ranked"}},
        },
    })
    await Settings.Load()
    b = Settings.settings["scoreboards"]["binding"]["1"]
    assert b["playback"] == {
        "mode": "single", "gameId": "G1", "interval": 30, "current_index": 0, "interrupt": None,
    }
    assert b["pool"] == {"filters": [], "scope": "both", "pinned": [], "excluded": [], "pinned_cache": {}, "refresh_interval": 60}
    assert b["stats_tag"] == "Ranked"
    assert Settings.settings["scoreboards"]["binding_schema"] == 2


async def test_v1_set_binding_preserves_curated_list_as_pinned(isolate_user_data):
    """The old model was hand-curation: whatever the user had selected must
    survive as `pinned`, not be silently reinterpreted as a live filter — the
    old auto-poll's additive-only semantics don't carry over as continuous
    add/remove membership (see refresh_interval == 0 below)."""
    _write_settings(isolate_user_data, {
        "scoreboards": {
            "active": [2],
            "binding": {"2": {"kind": "set", "gameId": None, "pool": "completed", "stats_tag": None}},
            "rotation": {
                "2": {
                    "enabled": True,
                    "interval": 45,
                    "current_index": 1,
                    "game_ids": [101, 102, 103],
                    "cached_games": [
                        {"game_id": 101, "away_user": "A", "home_user": "B"},
                        {"game_id": 102, "away_user": "C", "home_user": "D"},
                    ],
                    "filters": {"tag": ["Ranked"], "username": ["A"]},
                    "source_pool": "completed",
                    "poll_interval": 60,
                },
            },
        },
    })
    await Settings.Load()
    b = Settings.settings["scoreboards"]["binding"]["2"]
    assert b["playback"]["mode"] == "rotate"
    assert b["playback"]["interval"] == 45
    assert b["playback"]["current_index"] == 1
    # The legacy rotation was actively cycling (rotation.2.enabled == True) —
    # that must survive migration so the board resumes on next launch instead
    # of landing silently paused.
    assert b["playback"]["running"] is True
    assert b["pool"]["pinned"] == [101, 102, 103]
    assert b["pool"]["scope"] == "completed"
    assert b["pool"]["excluded"] == []
    # Static by default — a semantics change (additive-only -> add+remove)
    # should never silently alter what's on-screen for an existing rotation.
    assert b["pool"]["refresh_interval"] == 0
    # Old filters carried over as an inert chip, ready for the user to
    # re-enable continuous membership explicitly post-upgrade.
    assert b["pool"]["filters"] == [{"id": 1, "tag": ["Ranked"], "username": ["A"], "vs_username": [], "limit_games": None}]
    # Cached completed-game dicts resolve pinned display without a live lookup.
    assert b["pool"]["pinned_cache"]["101"]["away_user"] == "A"
    assert b["pool"]["pinned_cache"]["102"]["home_user"] == "D"


async def test_v1_set_binding_not_running_migrates_with_running_false(isolate_user_data):
    """A legacy rotation that was stopped (not enabled) must migrate to
    playback.running == False, not just happen to default there."""
    _write_settings(isolate_user_data, {
        "scoreboards": {
            "active": [4],
            "binding": {"4": {"kind": "set", "gameId": None, "pool": "both", "stats_tag": None}},
            "rotation": {
                "4": {
                    "enabled": False,
                    "interval": 30,
                    "current_index": 0,
                    "game_ids": [201],
                    "filters": {},
                },
            },
        },
    })
    await Settings.Load()
    b = Settings.settings["scoreboards"]["binding"]["4"]
    assert b["playback"]["mode"] == "rotate"
    assert b["playback"]["running"] is False


async def test_v1_set_binding_no_filters_migrates_with_empty_filter_list(isolate_user_data):
    _write_settings(isolate_user_data, {
        "scoreboards": {
            "active": [3],
            "binding": {"3": {"kind": "set", "gameId": None, "pool": "both"}},
            "rotation": {"3": {"enabled": True, "game_ids": [5], "filters": {}}},
        },
    })
    await Settings.Load()
    b = Settings.settings["scoreboards"]["binding"]["3"]
    assert b["pool"]["filters"] == []
    assert b["pool"]["pinned"] == [5]


async def test_pool_playback_migration_is_idempotent(isolate_user_data):
    _write_settings(isolate_user_data, {
        "scoreboards": {
            "active": [1],
            "binding": {"1": {"kind": "single", "gameId": "G1", "pool": "both"}},
        },
    })
    await Settings.Load()
    first = Settings.settings["scoreboards"]["binding"]["1"]
    await Settings.Load()
    second = Settings.settings["scoreboards"]["binding"]["1"]
    assert first == second
    assert Settings.settings["scoreboards"]["binding_schema"] == 2


async def test_fresh_install_gets_v2_shaped_default_binding(isolate_user_data):
    """No settings.json at all — Load() still produces a v2-shaped binding
    for the default board 1 (v1 migration creates it from scratch, v2 runs
    on that same in-memory dict in the same Load() call)."""
    await Settings.Load()
    b = Settings.settings["scoreboards"]["binding"]["1"]
    assert b["playback"]["mode"] == "single"
    assert b["pool"]["filters"] == []
    assert Settings.settings["scoreboards"]["binding_schema"] == 2

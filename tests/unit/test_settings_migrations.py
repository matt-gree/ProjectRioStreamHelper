"""Settings.Load migrations.

These run on real upgrades, so a regression silently resets users' config.
Each test writes a legacy settings.json into the isolated temp path and loads it.
"""
import orjson

from server.settings import Settings


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
    # ...while the genuinely layout-specific key survives.
    assert overlays["scoreboard"]["showElo"] is False
    assert overlays["schema_version"] == 2


async def test_overlay_schema_v2_is_left_untouched(isolate_user_data):
    _write_settings(isolate_user_data, {
        "overlays": {"schema_version": 2, "scoreboard": {"showElo": True}},
    })
    await Settings.Load()
    assert Settings.settings["overlays"]["schema_version"] == 2
    assert Settings.settings["overlays"]["scoreboard"]["showElo"] is True

"""Settings.ApplyBatch — a design look is applied as ONE settings commit.

Loading a look used to be one `Settings.Set` per key: a hundred settings.json
rewrites, and every overlay repainting between them.
"""
import pytest

from server.settings import Settings


@pytest.fixture
def overlays():
    Settings.settings = {"overlays": {
        "global": {"accentColor": "#f59e0b"},
        "scoreboard": {"accentColor": "#ff0000", "1": {"displayFont": "Oswald"}},
    }}
    return Settings.settings["overlays"]


async def test_sets_and_unsets_land_together(overlays, monkeypatch):
    saves = []

    async def save():
        saves.append(True)

    monkeypatch.setattr(Settings, "Save", save)
    await Settings.ApplyBatch(
        [("overlays.global.accentColor", "#00ff00"), ("overlays.lowerthird.accentColor", "#123456")],
        ["overlays.scoreboard.accentColor", "overlays.scoreboard.1.displayFont"],
    )
    assert overlays["global"]["accentColor"] == "#00ff00"
    assert overlays["lowerthird"]["accentColor"] == "#123456"
    assert "accentColor" not in overlays["scoreboard"]
    assert "displayFont" not in overlays["scoreboard"]["1"]
    assert saves == [True]


async def test_every_key_is_announced_with_the_callers_sid(overlays, mock_socket):
    await Settings.ApplyBatch([("overlays.global.accentColor", "#00ff00")],
                              ["overlays.scoreboard.accentColor"], session_id="abc")
    frames = [(c.args[0], c.args[1]) for c in mock_socket.await_args_list]
    assert ("v1.settings.unset", {"key": "overlays.scoreboard.accentColor", "sid": "abc"}) in frames
    assert ("v1.settings.set", {"key": "overlays.global.accentColor", "value": "#00ff00", "sid": "abc"}) in frames


async def test_an_empty_batch_writes_nothing(overlays, mock_socket, monkeypatch):
    saved = []

    async def save():
        saved.append(True)

    monkeypatch.setattr(Settings, "Save", save)
    before = Settings.revision
    await Settings.ApplyBatch([], [])
    assert saved == [] and Settings.revision == before
    mock_socket.assert_not_awaited()

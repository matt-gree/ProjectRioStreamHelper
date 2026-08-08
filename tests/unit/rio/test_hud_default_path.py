"""Where PRSH looks for Project Rio's decoded.hud.json when nothing is configured.

This path is load-bearing twice: it is the HUD file the watcher watches, and
`server/postgame_files` derives the StatFiles directory from its grandparent.
Getting it wrong costs the producer the live scoreboard AND post-game capture,
and presents as "PRSH doesn't see my game".
"""
import platform
from pathlib import Path

import pytest

from server.rio.provider import get_default_hud_file_path


@pytest.fixture
def as_windows(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Windows")


def test_windows_default_follows_appdata(as_windows, monkeypatch):
    """%APPDATA% is the authority. A roaming profile or folder redirection puts
    AppData somewhere other than ~/AppData/Roaming — often a network share —
    and Project Rio writes to the variable, so a hardcoded literal watches a
    file nothing will ever write."""
    monkeypatch.setenv("APPDATA", r"\\fileserver\profiles\producer\AppData\Roaming")
    p = get_default_hud_file_path()
    assert p.parts[-3:] == ("Project Rio", "HudFiles", "decoded.hud.json")
    assert "fileserver" in str(p)
    assert str(Path.home()) not in str(p)


def test_windows_default_falls_back_to_home_without_appdata(as_windows, monkeypatch):
    monkeypatch.delenv("APPDATA", raising=False)
    p = get_default_hud_file_path()
    assert p == Path.home() / "AppData" / "Roaming" / "Project Rio" / "HudFiles" / "decoded.hud.json"


def test_windows_empty_appdata_is_treated_as_unset(as_windows, monkeypatch):
    monkeypatch.setenv("APPDATA", "")
    p = get_default_hud_file_path()
    assert p == Path.home() / "AppData" / "Roaming" / "Project Rio" / "HudFiles" / "decoded.hud.json"


def test_macos_default_is_unchanged(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    assert get_default_hud_file_path() == (
        Path.home() / "Library" / "Application Support"
        / "Project Rio" / "HudFiles" / "decoded.hud.json"
    )

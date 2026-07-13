"""Path/port resolution — the isolation seams agent runs depend on.

PRSH_USER_DATA_DIR + PRSH_PORT + PRSH_NO_BROWSER let an agent boot a fully
isolated server (own user_data, own port, no browser tab). These pin the env
overrides and the lazy path resolution in State/Settings that makes the
user_data override actually reach the persisted files.
"""
from pathlib import Path

from server.paths import app_root, env_port, suppress_browser, user_data_dir


def test_user_data_dir_env_override(monkeypatch, tmp_path):
    override = tmp_path / "isolated" / "user_data"
    monkeypatch.setenv("PRSH_USER_DATA_DIR", str(override))
    p = user_data_dir()
    assert p == override
    assert p.is_dir()  # created on resolve


def test_user_data_dir_default_is_cwd_relative(monkeypatch):
    monkeypatch.delenv("PRSH_USER_DATA_DIR", raising=False)
    assert user_data_dir() == Path("./user_data")


def test_app_root_is_repo_root_regardless_of_cwd(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # static assets must not depend on CWD
    root = app_root()
    assert (root / "pyproject.toml").is_file()
    assert (root / "public" / "layout").is_dir()


def test_env_port(monkeypatch):
    monkeypatch.delenv("PRSH_PORT", raising=False)
    assert env_port() is None
    monkeypatch.setenv("PRSH_PORT", "5299")
    assert env_port() == 5299
    monkeypatch.setenv("PRSH_PORT", "not-a-port")
    assert env_port() is None  # invalid → ignored, not a crash


def test_suppress_browser(monkeypatch):
    monkeypatch.delenv("PRSH_NO_BROWSER", raising=False)
    assert suppress_browser() is False
    monkeypatch.setenv("PRSH_NO_BROWSER", "1")
    assert suppress_browser() is True


def test_state_paths_resolve_lazily_from_env(monkeypatch, tmp_path):
    """State's output paths must pick up PRSH_USER_DATA_DIR on first use —
    not be baked at import time (conftest injects temp paths by assignment;
    a real isolated run relies on this lazy resolution instead)."""
    from server.state import State

    monkeypatch.setenv("PRSH_USER_DATA_DIR", str(tmp_path / "ud"))
    monkeypatch.setattr(State, "_program_state_out", None)
    monkeypatch.setattr(State, "_stream_labels_out", None)
    assert str(State._state_file()) == str(tmp_path / "ud" / "state.json")
    assert str(State._labels_dir()) == str(tmp_path / "ud" / "stream_labels")


def test_settings_path_resolves_lazily_from_env(monkeypatch, tmp_path):
    from server.settings import Settings

    monkeypatch.setenv("PRSH_USER_DATA_DIR", str(tmp_path / "ud"))
    monkeypatch.setattr(Settings, "_settings_out", None)
    assert str(Settings._settings_file()) == str(tmp_path / "ud" / "settings.json")

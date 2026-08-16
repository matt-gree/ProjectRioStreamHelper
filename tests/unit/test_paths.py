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


# --------------------------------------------------------------- reveal_path --
#
# Every "reveal this folder" button (assets, stream labels, the log viewer, the
# tray) routes through one helper. There were four copies before, and they had
# DRIFTED rather than merely repeated — different platform checks, different
# Windows commands, and only some of them caught a failure. These pin the parts
# that differed, so a fifth caller can't quietly reintroduce a variant.

def test_reveal_path_uses_the_platform_file_manager(monkeypatch):
    import server.paths as paths

    calls = []
    monkeypatch.setattr(paths.subprocess, "Popen", lambda argv: calls.append(argv))

    monkeypatch.setattr(paths.sys, "platform", "darwin")
    paths.reveal_path("/some/dir")
    assert calls == [["open", "/some/dir"]]

    calls.clear()
    monkeypatch.setattr(paths.sys, "platform", "linux")
    paths.reveal_path("/some/dir")
    assert calls == [["xdg-open", "/some/dir"]]


def test_reveal_path_on_windows_uses_startfile(monkeypatch):
    """Not `explorer`: os.startfile honours the user's default handler, and
    explorer.exe returns non-zero even when it succeeded."""
    import server.paths as paths

    seen = []
    monkeypatch.setattr(paths.sys, "platform", "win32")
    monkeypatch.setattr(paths.os, "startfile", seen.append, raising=False)
    paths.reveal_path("C:/logs")
    assert seen == ["C:/logs"]


def test_reveal_path_swallows_failure(monkeypatch):
    """A reveal is a convenience. A producer mid-broadcast is not helped by a
    500, so a failure is logged and never raised — one of the behaviours the
    four old copies disagreed on."""
    import server.paths as paths

    monkeypatch.setattr(paths.sys, "platform", "darwin")
    monkeypatch.setattr(paths.subprocess, "Popen", _boom)
    paths.reveal_path("/nope")  # must not raise


def _boom(*_a, **_k):
    raise OSError("no file manager")


def test_logs_dir_is_created_under_the_writable_root(monkeypatch, tmp_path):
    """The log viewer and the tray share this, so they cannot disagree."""
    import server.paths as paths

    monkeypatch.setattr(paths, "_frozen_writable_root", lambda: tmp_path)
    d = paths.logs_dir()
    assert d == tmp_path / "logs"
    assert d.is_dir()

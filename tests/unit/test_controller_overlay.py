"""The controller overlay's two contracts with the rest of PRSH.

`gc-overlay` is the odd element out: it is the only one whose content comes from
a SUBPROCESS on a second port rather than from a layout PRSH serves itself. That
buys it two seams nothing else has, and neither was covered — the only test
naming `controller` before this file asserted that the filename derives the type.

1. WHICH gc-overlay gets launched, and with which interpreter. Getting this
   wrong doesn't raise: the resolver answers None and the feature quietly
   reports itself uninstalled, or it launches under the wrong Python and the
   subprocess dies on an import the producer never sees.

2. WHICH controller port a side shows. The layout is a thin wrapper that
   iframes gc-overlay at `score.{N}.player.{T}.port`, so a left/right browser
   source follows whoever is on that side. That only holds because the port
   travels with the entrant through the side cascade.

The resolver is platform-neutral, and now genuinely so: gc-overlay 1.1.0 carries
a transport for every platform PRSH runs on, so there is no platform gate left to
monkeypatch. What decides the feature is whether gc-overlay is FOUND.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

from server import controller_overlay as co
from server.rio.provider import RioGameDataProvider as P
from server.state import State
from server.utils.deep_dict import deep_get


# ── helpers ─────────────────────────────────────────────────────────────────

def make_source_checkout(root: Path, *, venv: bool = True) -> Path:
    """A gc-overlay directory as a source checkout: main.py, optional own venv."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "main.py").write_text("# gc-overlay entrypoint\n")
    if venv:
        bin_dir = root / "venv" / "bin"
        bin_dir.mkdir(parents=True)
        (bin_dir / "python3").write_text("#!/bin/sh\n")
    return root


def make_frozen_dir(root: Path, *, mode: int = 0o755) -> Path:
    """A gc-overlay directory as a frozen build: a standalone binary, no main.py."""
    root.mkdir(parents=True, exist_ok=True)
    binary = root / ("gc-overlay.exe" if sys.platform == "win32" else "gc-overlay")
    binary.write_text("#!/bin/sh\n")
    binary.chmod(mode)
    return root


# ── 1a. what counts as a gc-overlay directory ───────────────────────────────

def test_a_source_checkout_is_launchable(tmp_path):
    assert co._is_gc_overlay_dir(make_source_checkout(tmp_path / "gc")) is True


def test_a_frozen_build_is_launchable(tmp_path):
    assert co._is_gc_overlay_dir(make_frozen_dir(tmp_path / "gc")) is True


def test_a_directory_with_neither_is_not(tmp_path):
    (tmp_path / "gc").mkdir()
    assert co._is_gc_overlay_dir(tmp_path / "gc") is False
    assert co._base_command(tmp_path / "gc") is None


# ── 1b. the search order ────────────────────────────────────────────────────

def test_the_resolver_answers_none_when_nothing_is_installed(monkeypatch):
    """Presence is the only gate. It replaced a platform gate that hid the
    feature on Windows — which, once gc-overlay grew a Windows transport, was
    hiding it from the only machine that could confirm the transport works."""
    monkeypatch.setattr(co, "_is_gc_overlay_dir", lambda p: False)

    assert co._find_gc_overlay() is None


def test_the_search_order_is_frozen_then_in_repo_then_sibling(monkeypatch):
    """Order matters in one direction: a frozen build carries its own gc-overlay
    and must never reach past it to a checkout that happens to sit next to the
    .app on a developer's machine."""
    probed = []
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", "/fake/bundle", raising=False)
    monkeypatch.setattr(co, "_is_gc_overlay_dir", lambda p: probed.append(p) or False)

    assert co._find_gc_overlay() is None

    repo_root = Path(co.__file__).resolve().parent.parent
    assert probed == [
        Path("/fake/bundle") / "gc-overlay",
        repo_root / "gc-overlay",
        repo_root.parent / "gc-overlay",
    ]


def test_an_unfrozen_run_never_probes_a_bundle(monkeypatch):
    probed = []
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setattr(co, "_is_gc_overlay_dir", lambda p: probed.append(p) or False)

    co._find_gc_overlay()

    repo_root = Path(co.__file__).resolve().parent.parent
    assert probed == [repo_root / "gc-overlay", repo_root.parent / "gc-overlay"]


def test_the_first_launchable_candidate_wins(monkeypatch):
    """Not merely 'a launchable one' — later candidates must not be consulted
    once an earlier one answers."""
    repo_root = Path(co.__file__).resolve().parent.parent
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setattr(co, "_is_gc_overlay_dir", lambda p: True)

    assert co._find_gc_overlay() == repo_root / "gc-overlay"


# ── 1c. the launch command ──────────────────────────────────────────────────

def test_a_source_checkout_runs_gc_overlays_own_interpreter(tmp_path):
    """THE one that fails silently. gc-overlay has its own dependencies and its
    own venv; PRSH's interpreter does not have them. Falling back to
    `sys.executable` launches a subprocess that dies on an import error the
    producer sees only as an overlay that never appears."""
    gc = make_source_checkout(tmp_path / "gc")

    cmd = co._base_command(gc)

    assert cmd == [str(gc / "venv" / "bin" / "python3"), str(gc / "main.py")]
    assert cmd[0] != sys.executable


def test_a_source_checkout_without_a_venv_falls_back_to_the_running_python(tmp_path):
    """The deliberate fallback: better to try than to refuse, since a developer
    may have installed gc-overlay's deps into the interpreter they run PRSH
    with."""
    gc = make_source_checkout(tmp_path / "gc", venv=False)

    assert co._base_command(gc) == [sys.executable, str(gc / "main.py")]


def test_a_frozen_binary_beats_main_py_in_the_same_directory(tmp_path):
    """A directory can hold both. The binary is the shipped artifact."""
    gc = make_source_checkout(tmp_path / "gc")
    make_frozen_dir(gc)

    assert co._base_command(gc) == [str(co._gc_binary(gc))]


@pytest.mark.skipif(os.name == "nt", reason="no executable bit on Windows")
def test_the_frozen_binary_is_restored_to_executable(tmp_path):
    """Files bundled as PyInstaller `datas` can lose the executable bit, so PRSH
    re-chmods before launching. Without it the nested binary inside the .app
    fails to start — a path that only exists in a frozen build, which is exactly
    where it is hardest to notice."""
    gc = make_frozen_dir(tmp_path / "gc", mode=0o644)
    binary = co._gc_binary(gc)
    assert not os.access(binary, os.X_OK)

    co._base_command(gc)

    assert os.access(binary, os.X_OK)


# ── 2. the side → controller-port mapping ───────────────────────────────────
#
# `public/layout/controller/controller.html?team=T` reads
# `score.{N}.player.{T}.port` and iframes gc-overlay at that port. So the
# question these answer is: does a browser source pinned to the left side keep
# showing the same person's controller when Project Rio reassigns away/home?

async def apply(left_name, left_port, right_name, right_port, *, game_id):
    """One feed frame in RAW order, through the real per-board path."""
    await P._apply_game_to_state({
        "entrants": [
            [{"rioName": left_name, "port": left_port}],
            [{"rioName": right_name, "port": right_port}],
        ],
        "team1score": 0, "team2score": 0, "inning": 1, "game_id": game_id,
    })


def port_on(side: int):
    return deep_get(State.state, f"score.1.player.{side}.port")


def name_on(side: int):
    return deep_get(State.state, f"score.1.player.{side}.rioName")


async def test_each_side_carries_its_own_players_port(mock_socket):
    P._hud_targets = [1]

    await apply("rjb", 0, "MattGree", 1, game_id="g1")

    assert (name_on(1), port_on(1)) == ("rjb", 0)
    assert (name_on(2), port_on(2)) == ("MattGree", 1)


async def test_the_port_follows_the_player_when_rio_flips_away_and_home(mock_socket):
    """The per-side follow, end to end.

    Project Rio assigns away/home per game, so the same two players arrive in
    the opposite order next game. The cascade holds each player on their side
    (`back_to_back`) — and the port has to travel with them, or the left source
    starts drawing the right player's controller while every other overlay on
    that side still shows the left player.

    This works because the port is read off the ORIENTED entrant list, not from
    a fixed index. A refactor that writes `.port` from raw feed order passes
    every other side-cascade test and fails only here.
    """
    P._hud_targets = [1]
    await apply("rjb", 0, "MattGree", 1, game_id="g1")

    # Next game: Rio puts MattGree away and rjb home — raw order reversed.
    await apply("MattGree", 1, "rjb", 0, game_id="g2")

    assert deep_get(State.state, "score.1.side_reason") == "back_to_back"
    assert (name_on(1), port_on(1)) == ("rjb", 0)
    assert (name_on(2), port_on(2)) == ("MattGree", 1)


async def test_a_player_who_changes_controller_between_games_takes_the_new_port(mock_socket):
    """The mirror of the test above: following the PLAYER means following them
    to a different controller, not pinning the side to a port it once had."""
    P._hud_targets = [1]
    await apply("rjb", 0, "MattGree", 1, game_id="g1")

    await apply("rjb", 3, "MattGree", 1, game_id="g2")

    assert (name_on(1), port_on(1)) == ("rjb", 3)


# ── 3. how the subprocess is spawned ────────────────────────────────────────
#
# Two flags that are invisible on macOS and decide whether the feature works
# at all on Windows. Neither raises when wrong: the producer gets an empty
# black console window beside their overlay, and a log with nothing in it.

def test_the_child_never_allocates_a_console_window(monkeypatch):
    """A console child of a windowed parent ALLOCATES a console on Windows.

    PRSH freezes with console=False and gc-overlay with console=True (PRSH
    drains its stdout, which a windowed exe has none of), so the child has no
    console to inherit and Windows makes it one — an empty terminal window
    that stays up for the session. CREATE_NO_WINDOW is the suppression, and
    it has to be the flag rather than flipping the child windowed.
    """
    import importlib

    # CREATE_NO_WINDOW is a Windows-only stdlib constant, so a POSIX test run
    # has to supply both halves of the condition to see the branch at all.
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.setattr(subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False)
    try:
        assert importlib.reload(co)._NO_WINDOW == 0x08000000
    finally:
        monkeypatch.undo()
        importlib.reload(co)


def test_the_flag_is_inert_off_windows():
    """CREATE_NO_WINDOW does not exist on POSIX; the launch must still work."""
    assert co._NO_WINDOW == 0


def test_the_child_runs_unbuffered():
    """gc-overlay's stdout is a PIPE, so CPython block-buffers it.

    Its transport diagnostics are the only account of why the overlay is
    sitting on "Waiting for controller data...", and at 8 KB of buffering
    they reach PRSH's log long after they were wanted, or never.
    """
    assert co._child_env()["PYTHONUNBUFFERED"] == "1"


def test_the_child_inherits_the_rest_of_the_environment(monkeypatch):
    monkeypatch.setenv("PRSH_TEST_MARKER", "kept")
    assert co._child_env()["PRSH_TEST_MARKER"] == "kept"

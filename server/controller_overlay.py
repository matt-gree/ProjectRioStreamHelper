"""Managed subprocess for the gc-overlay controller input display.

Launches gc-overlay as a child process and monitors its health.
The overlay runs independently on its own port and serves its own
WebSocket + HTML overlay that OBS can capture as a browser source.
"""

import asyncio
import os
import platform
import socket
import subprocess
import sys
from pathlib import Path

from loguru import logger

from server.paths import user_data_dir
from server.settings import Settings

# There is no platform gate. gc-overlay carries two peer transports as of
# 1.1.0 — MemoryWatcher (AF_UNIX; macOS, Linux) and a process-memory poll
# (Windows, Linux) — so every platform PRSH runs on can read a controller.
# What varies is whether gc-overlay is actually PRESENT, which _find_gc_overlay
# already answers; "supported" was standing in for "found" and hid the feature
# on the one platform that needed to be able to test it.


# A PRSH frozen build is windowed (PRSH.spec: console=False) and gc-overlay is
# a console app (gc-overlay.spec: console=True — PRSH drains its stdout, and a
# windowed PyInstaller exe has no stdout to drain). On Windows a console child
# of a windowed parent has no console to inherit, so it ALLOCATES one: an empty
# black terminal window appears beside the overlay and stays for the session.
# CREATE_NO_WINDOW suppresses the allocation without touching the pipes, which
# is why this is the fix rather than flipping the child to console=False.
# No-op everywhere else: the flag only exists on Windows.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def _child_env() -> dict:
    """Environment for the gc-overlay child.

    PYTHONUNBUFFERED because we hand the child a PIPE, and CPython
    block-buffers stdout onto a pipe — so gc-overlay's transport diagnostics
    ("Waiting for Dolphin/Project Rio to start...", the hooked/elevation
    messages) sit in an 8 KB buffer and reach `_drain_output` long after the
    producer needed them, or never. Honoured by a frozen build too: the
    bootloader runs an ordinary CPython, which reads this at init.
    """
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _port_free(port: int) -> bool:
    """Return True if TCP port is bindable on localhost right now."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", port))
        s.close()
        return True
    except OSError:
        return False


def _find_free_port_near(start: int, count: int = 10) -> int | None:
    for p in range(start, start + count):
        if _port_free(p):
            return p
    return None


# ── The orphan PRSH left behind ─────────────────────────────────────────────
#
# gc-overlay is a separate process, and nothing in the OS ties its life to
# PRSH's: when PRSH ends without running its lifespan shutdown — Windows' exit
# is an `os._exit`, the macOS tray gives shutdown five seconds and then does the
# same, and a crash or Force Quit gives it nothing — the child is reparented to
# init and keeps the configured port. The NEXT launch then found 8069 taken by
# its own previous self and could only offer "Use port 8070", which moves every
# Controller source in OBS off the port it was built against. A pidfile is the
# one record that survives the parent: it names the process PRSH started, so a
# port held by THAT process is reclaimed rather than routed around.

def _pidfile() -> Path:
    return user_data_dir() / "gc-overlay.pid"


def _write_pidfile(pid: int, port: int) -> None:
    try:
        _pidfile().write_text(f"{pid} {port}\n")
    except OSError:
        logger.debug("[controller_overlay] could not write pidfile")


def _clear_pidfile() -> None:
    try:
        _pidfile().unlink(missing_ok=True)
    except OSError:
        pass


def _read_pidfile() -> tuple[int, int] | None:
    try:
        pid, port = _pidfile().read_text().split()[:2]
        return int(pid), int(port)
    except (OSError, ValueError):
        return None


def _pid_is_gc_overlay(pid: int) -> bool:
    """True only if `pid` is alive AND is a gc-overlay.

    The identity check is what makes killing it safe: a pidfile outlives its
    process, and a recycled pid belongs to somebody else. No psutil — `ps` and
    `tasklist` answer this on every platform PRSH ships, and a failure to ask is
    an answer of False (never kill what you could not identify).
    """
    try:
        if os.name == "nt":
            out = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=5, creationflags=_NO_WINDOW,
            ).stdout
        else:
            out = subprocess.run(
                ["ps", "-p", str(pid), "-o", "command="],
                capture_output=True, text=True, timeout=5,
            ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return "gc-overlay" in out.lower() or "gc_overlay" in out.lower()


def _terminate_pid(pid: int) -> None:
    """SIGTERM on POSIX; TerminateProcess on Windows (os.kill's meaning there)."""
    try:
        import signal
        os.kill(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass


async def _reclaim_orphan(port: int) -> bool:
    """Kill a gc-overlay a previous PRSH left on `port`. True if the port is now free."""
    record = _read_pidfile()
    if record is None:
        return False
    pid, recorded_port = record
    if recorded_port != port or pid == os.getpid() or not _pid_is_gc_overlay(pid):
        _clear_pidfile()
        return False
    logger.info("[controller_overlay] reclaiming port {} from orphaned gc-overlay (pid {})", port, pid)
    _terminate_pid(pid)
    for _ in range(30):
        if _port_free(port):
            _clear_pidfile()
            return True
        await asyncio.sleep(0.1)
    return _port_free(port)


def _gc_binary(gc_dir: Path) -> Path | None:
    """Return the frozen gc-overlay executable inside gc_dir, if present.

    Frozen builds ship a standalone binary (no main.py); source checkouts
    ship main.py. A directory may have either.
    """
    name = "gc-overlay.exe" if platform.system() == "Windows" else "gc-overlay"
    binary = gc_dir / name
    return binary if binary.exists() else None


def _is_gc_overlay_dir(gc_dir: Path) -> bool:
    """True if gc_dir holds a launchable gc-overlay (binary or source)."""
    return _gc_binary(gc_dir) is not None or (gc_dir / "main.py").exists()


def _base_command(gc_dir: Path) -> list[str] | None:
    """Command prefix (no CLI args) to run gc-overlay from gc_dir.

    Prefers the frozen binary; falls back to ``python main.py`` using
    gc-overlay's own venv if it has one. Returns None if neither exists.
    """
    binary = _gc_binary(gc_dir)
    if binary is not None:
        # Files bundled as PyInstaller `datas` can lose the executable bit;
        # restore it so the nested binary can actually launch.
        if os.name != "nt":
            try:
                os.chmod(binary, 0o755)
            except OSError:
                pass
        return [str(binary)]

    main_py = gc_dir / "main.py"
    if not main_py.exists():
        return None

    python = sys.executable
    gc_venv_python = gc_dir / "venv" / "bin" / "python3"
    if not gc_venv_python.exists():
        gc_venv_python = gc_dir / "venv" / "Scripts" / "python.exe"
    if gc_venv_python.exists():
        python = str(gc_venv_python)
    return [python, str(main_py)]


def _read_gc_version(gc_dir: Path | None) -> str | None:
    """Run ``gc-overlay --version`` and return the version string, or None.

    Cheap one-shot subprocess (argparse exits before the server starts), run
    once at startup / on path change — not on the hot path.
    """
    if gc_dir is None:
        return None
    base = _base_command(gc_dir)
    if base is None:
        return None
    try:
        out = subprocess.run(
            base + ["--version"],
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(gc_dir),
            creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip() or None


def _find_gc_overlay() -> Path | None:
    """Locate the gc-overlay directory.

    Search order (first launchable match wins):
    1. Frozen build: nested binary bundled alongside the PRSH executable.
    2. In-repo submodule: ./gc-overlay (PRSH vendors it as a submodule).
    3. Sibling directory: ../gc-overlay (dev convenience).

    """
    candidates: list[Path] = []

    if getattr(sys, "frozen", False):
        bundle_dir = Path(sys._MEIPASS) if hasattr(sys, "_MEIPASS") else Path(sys.executable).parent
        candidates.append(bundle_dir / "gc-overlay")

    repo_root = Path(__file__).resolve().parent.parent
    candidates.append(repo_root / "gc-overlay")       # in-repo submodule
    candidates.append(repo_root.parent / "gc-overlay")  # sibling checkout

    for c in candidates:
        if _is_gc_overlay_dir(c):
            return c
    return None


class ControllerOverlay:
    """Singleton manager for the gc-overlay subprocess."""

    _process: asyncio.subprocess.Process | None = None
    _task: asyncio.Task | None = None
    _port: int = 8069
    _gc_overlay_path: Path | None = None
    _version: str | None = None
    _running: bool = False
    _auto_start: bool = False

    @classmethod
    async def Start(cls):
        """Initialize and optionally auto-start the overlay."""
        # Detection only. There is no path override: gc-overlay ships inside
        # every build and the submodule covers a source checkout, so a stored
        # path could only ever point somewhere stale.
        cls._gc_overlay_path = _find_gc_overlay()

        cls._port = Settings.Get("controller_overlay.port", 8069)
        cls._auto_start = Settings.Get("controller_overlay.auto_start", False)
        cls._version = _read_gc_version(cls._gc_overlay_path)

        if cls._gc_overlay_path:
            logger.info(
                "[controller_overlay] found gc-overlay {} at: {}",
                cls._version or "(unknown version)",
                cls._gc_overlay_path,
            )
        else:
            logger.debug("[controller_overlay] gc-overlay not found")

        if cls._auto_start and cls._gc_overlay_path:
            await cls.Launch()

    @classmethod
    async def Stop(cls):
        """Stop the overlay subprocess if running."""
        await cls._kill_process()

    @classmethod
    async def Launch(cls) -> dict:
        """Launch the gc-overlay subprocess."""
        if cls._running and cls._process and cls._process.returncode is None:
            return {"success": True, "already_running": True, "port": cls._port}

        if not cls._gc_overlay_path:
            return {"success": False, "error": "gc-overlay not found", "reason": "not_installed"}

        base_cmd = _base_command(cls._gc_overlay_path)
        if base_cmd is None:
            return {
                "success": False,
                "error": f"No gc-overlay binary or main.py at {cls._gc_overlay_path}",
                "reason": "missing_entrypoint",
            }

        # Kill any existing process
        await cls._kill_process()

        # Pre-flight port check. A port held by the gc-overlay a previous PRSH
        # orphaned is taken back first; only a port held by something ELSE gets
        # the structured error with a suggested free port (the UI's one-click
        # "Use port X" affordance).
        if not _port_free(cls._port) and not await _reclaim_orphan(cls._port):
            suggestion = _find_free_port_near(cls._port + 1)
            logger.warning(
                "[controller_overlay] port {} in use (suggested free: {})",
                cls._port,
                suggestion,
            )
            return {
                "success": False,
                "reason": "port_in_use",
                "error": f"Port {cls._port} is already in use.",
                "port": cls._port,
                "suggested_port": suggestion,
            }

        try:
            cmd = base_cmd + ["--port", str(cls._port)]

            logger.info("[controller_overlay] launching: {}", " ".join(cmd))

            cls._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(cls._gc_overlay_path),
                creationflags=_NO_WINDOW,
                env=_child_env(),
            )

            cls._running = True
            _write_pidfile(cls._process.pid, cls._port)

            # Start a background task to monitor the process
            cls._task = asyncio.create_task(cls._monitor())

            # Give it a moment to start
            await asyncio.sleep(0.5)

            if cls._process.returncode is not None:
                output = ""
                if cls._process.stdout:
                    output = (await cls._process.stdout.read()).decode(errors="replace")
                cls._running = False
                return {"success": False, "error": f"Process exited immediately: {output[:200]}"}

            return {"success": True, "port": cls._port, "pid": cls._process.pid}

        except Exception as e:
            cls._running = False
            logger.exception("[controller_overlay] failed to launch")
            return {"success": False, "error": str(e)}

    @classmethod
    async def Shutdown(cls) -> dict:
        """Stop the overlay subprocess."""
        if not cls._running:
            return {"success": True, "was_running": False}

        await cls._kill_process()
        return {"success": True, "was_running": True}

    @classmethod
    def GetStatus(cls) -> dict:
        """Get current status of the overlay."""
        running = cls._running and cls._process is not None and cls._process.returncode is None
        return {
            "supported": True,  # kept for API compatibility; always true now
            "available": cls._gc_overlay_path is not None,
            "path": str(cls._gc_overlay_path) if cls._gc_overlay_path else None,
            "version": cls._version,
            "running": running,
            "port": cls._port,
            "pid": cls._process.pid if cls._process and running else None,
            "url": f"http://localhost:{cls._port}" if running else None,
        }

    @classmethod
    async def SetPort(cls, port: int):
        """Update the port (requires restart to take effect)."""
        cls._port = port
        await Settings.Set("controller_overlay.port", port)

    @classmethod
    def KillNow(cls) -> None:
        """Terminate the child synchronously, from any thread.

        For the exits that never reach the lifespan shutdown — Windows' window
        close and the macOS tray's post-timeout — both of which end in
        `os._exit`, which runs no cleanup at all. A signal by pid rather than
        the asyncio Process, whose methods belong to the loop's thread. The
        pidfile is left in place on purpose: if the signal is somehow not
        enough, it is what lets the next launch take the port back.
        """
        proc = cls._process
        if proc is not None and proc.returncode is None:
            _terminate_pid(proc.pid)

    @classmethod
    async def _kill_process(cls):
        """Terminate the subprocess gracefully."""
        cls._running = False

        if cls._task and not cls._task.done():
            cls._task.cancel()
            try:
                await cls._task
            except asyncio.CancelledError:
                pass
            cls._task = None

        if cls._process and cls._process.returncode is None:
            try:
                cls._process.terminate()
                try:
                    await asyncio.wait_for(cls._process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    cls._process.kill()
                    await cls._process.wait()
            except ProcessLookupError:
                pass
            logger.info("[controller_overlay] process stopped")

        if cls._process is not None:
            _clear_pidfile()
        cls._process = None

    @classmethod
    async def _monitor(cls):
        """Monitor the subprocess, drain output, and log if it exits unexpectedly."""
        try:
            if cls._process:
                # Drain stdout (stderr is redirected there too) to prevent buffer
                # from filling up and blocking the subprocess.
                drain_task = None
                if cls._process.stdout:
                    drain_task = asyncio.create_task(cls._drain_output())

                returncode = await cls._process.wait()

                if drain_task:
                    drain_task.cancel()
                    try:
                        await drain_task
                    except asyncio.CancelledError:
                        pass

                if cls._running:
                    logger.warning(
                        "[controller_overlay] process exited with code {}",
                        returncode,
                    )
                    cls._running = False
        except asyncio.CancelledError:
            pass

    @classmethod
    async def _drain_output(cls):
        """Continuously read and log stdout from the subprocess.

        INFO, not DEBUG. main.py registers its file sinks at INFO/ERROR, so a
        debug line reaches the dev console and never the `prsh_info.txt` a
        producer actually sends you — and gc-overlay's stdout is the only
        account of WHY an overlay is sitting on "Waiting for controller
        data...". It is not chatty: every print site fires on startup or on a
        transport status CHANGE (`_report_status` dedupes), and aiohttp's
        access log is off (`run_app(print=None)`), so this is a handful of
        lines per session rather than anything per-tick.
        """
        try:
            while cls._process and cls._process.stdout:
                line = await cls._process.stdout.readline()
                if not line:
                    break
                text = line.decode(errors="replace").rstrip()
                if text:
                    logger.info("[gc-overlay] {}", text)
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

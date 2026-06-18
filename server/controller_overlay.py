"""Managed subprocess for the gc-overlay controller input display.

Launches gc-overlay as a child process and monitors its health.
The overlay runs independently on its own port and serves its own
WebSocket + HTML overlay that OBS can capture as a browser source.
"""

import asyncio
import os
import platform
import signal
import socket
import subprocess
import sys
from pathlib import Path

from loguru import logger

from server.settings import Settings

# gc-overlay only functions on macOS (its Dolphin MemoryWatcher reader uses
# AF_UNIX sockets and macOS-only config paths). PRSH gates the whole feature
# — UI, API, and build bundling — on this. See CLAUDE.md "Controller Overlay".
PLATFORM_SUPPORTED = platform.system() == "Darwin"


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

    A custom override (settings controller_overlay.path) is applied by the
    caller, not here.
    """
    if not PLATFORM_SUPPORTED:
        return None

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
    _controller: int = 1
    _gc_overlay_path: Path | None = None
    _version: str | None = None
    _running: bool = False
    _auto_start: bool = False

    @classmethod
    async def Start(cls):
        """Initialize and optionally auto-start the overlay."""
        if not PLATFORM_SUPPORTED:
            logger.debug("[controller_overlay] unsupported platform — feature disabled")
            cls._gc_overlay_path = None
            cls._version = None
            return

        cls._gc_overlay_path = _find_gc_overlay()

        # Check for custom path in settings
        custom_path = Settings.Get("controller_overlay.path", "")
        if custom_path:
            p = Path(custom_path)
            if _is_gc_overlay_dir(p):
                cls._gc_overlay_path = p

        cls._port = Settings.Get("controller_overlay.port", 8069)
        cls._controller = Settings.Get("controller_overlay.controller", 1)
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
        if not PLATFORM_SUPPORTED:
            return {
                "success": False,
                "reason": "unsupported_platform",
                "error": "The controller overlay is only supported on macOS.",
            }

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

        # Pre-flight port check: if the configured port is in use, return a
        # structured error with a suggested free port. The UI shows a one-click
        # "Use port X" affordance.
        if not _port_free(cls._port):
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
            )

            cls._running = True

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
            "supported": PLATFORM_SUPPORTED,
            "available": cls._gc_overlay_path is not None,
            "path": str(cls._gc_overlay_path) if cls._gc_overlay_path else None,
            "version": cls._version,
            "running": running,
            "port": cls._port,
            "controller": cls._controller,
            "pid": cls._process.pid if cls._process and running else None,
            "url": f"http://localhost:{cls._port}" if running else None,
        }

    @classmethod
    async def SetPort(cls, port: int):
        """Update the port (requires restart to take effect)."""
        cls._port = port
        await Settings.Set("controller_overlay.port", port)

    @classmethod
    async def SetController(cls, controller: int):
        """Update the controller port (1-4). Requires restart."""
        if 1 <= controller <= 4:
            cls._controller = controller
            await Settings.Set("controller_overlay.controller", controller)

    @classmethod
    async def SetPath(cls, path: str):
        """Update the gc-overlay path and re-detect."""
        await Settings.Set("controller_overlay.path", path)
        if path:
            p = Path(path)
            if _is_gc_overlay_dir(p):
                cls._gc_overlay_path = p
                cls._version = _read_gc_version(p)
                return {"success": True, "path": str(p), "available": True, "version": cls._version}
            return {"success": False, "error": f"No gc-overlay binary or main.py at {path}"}
        # Clear custom path and re-run auto-detection
        cls._gc_overlay_path = _find_gc_overlay()
        cls._version = _read_gc_version(cls._gc_overlay_path)
        return {"success": True, "path": str(cls._gc_overlay_path) if cls._gc_overlay_path else None, "available": cls._gc_overlay_path is not None, "version": cls._version}

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
        """Continuously read and log stdout from the subprocess."""
        try:
            while cls._process and cls._process.stdout:
                line = await cls._process.stdout.readline()
                if not line:
                    break
                text = line.decode(errors="replace").rstrip()
                if text:
                    logger.debug("[gc-overlay] {}", text)
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

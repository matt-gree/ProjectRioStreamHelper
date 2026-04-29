"""Managed subprocess for the gc-overlay controller input display.

Launches gc-overlay as a child process and monitors its health.
The overlay runs independently on its own port and serves its own
WebSocket + HTML overlay that OBS can capture as a browser source.
"""

import asyncio
import os
import signal
import socket
import sys
from pathlib import Path

from loguru import logger

from server.settings import Settings


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


def _find_gc_overlay() -> Path | None:
    """Locate the gc-overlay directory.

    Search order:
    1. Settings value (controller_overlay.path)
    2. Sibling directory: ../gc-overlay relative to this repo
    3. Bundled path for frozen builds
    """
    # Check settings first (set below after Settings.Load)
    # This is called at runtime, not import time

    # Sibling directory (development layout)
    repo_root = Path(__file__).resolve().parent.parent
    sibling = repo_root.parent / "gc-overlay"
    if (sibling / "main.py").exists():
        return sibling

    # Frozen build: bundled alongside
    if getattr(sys, 'frozen', False):
        bundle_dir = Path(sys._MEIPASS) if hasattr(sys, '_MEIPASS') else Path(sys.executable).parent
        bundled = bundle_dir / "gc-overlay"
        if (bundled / "main.py").exists():
            return bundled

    return None


class ControllerOverlay:
    """Singleton manager for the gc-overlay subprocess."""

    _process: asyncio.subprocess.Process | None = None
    _task: asyncio.Task | None = None
    _port: int = 8069
    _controller: int = 1
    _gc_overlay_path: Path | None = None
    _running: bool = False
    _auto_start: bool = False

    @classmethod
    async def Start(cls):
        """Initialize and optionally auto-start the overlay."""
        cls._gc_overlay_path = _find_gc_overlay()

        # Check for custom path in settings
        custom_path = Settings.Get("controller_overlay.path", "")
        if custom_path:
            p = Path(custom_path)
            if (p / "main.py").exists():
                cls._gc_overlay_path = p

        cls._port = Settings.Get("controller_overlay.port", 8069)
        cls._controller = Settings.Get("controller_overlay.controller", 1)
        cls._auto_start = Settings.Get("controller_overlay.auto_start", False)

        if cls._gc_overlay_path:
            logger.info("[controller_overlay] found gc-overlay at: {}", cls._gc_overlay_path)
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

        main_py = cls._gc_overlay_path / "main.py"
        if not main_py.exists():
            return {
                "success": False,
                "error": f"main.py not found at {cls._gc_overlay_path}",
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
            # Use the same Python interpreter
            python = sys.executable

            # Check if gc-overlay has its own venv
            gc_venv_python = cls._gc_overlay_path / "venv" / "bin" / "python3"
            if not gc_venv_python.exists():
                gc_venv_python = cls._gc_overlay_path / "venv" / "Scripts" / "python.exe"
            if gc_venv_python.exists():
                python = str(gc_venv_python)

            cmd = [
                python,
                str(main_py),
                "--port", str(cls._port),
            ]

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
            "available": cls._gc_overlay_path is not None,
            "path": str(cls._gc_overlay_path) if cls._gc_overlay_path else None,
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
            if (p / "main.py").exists():
                cls._gc_overlay_path = p
                return {"success": True, "path": str(p), "available": True}
            return {"success": False, "error": f"main.py not found at {path}"}
        # Clear custom path and re-run auto-detection
        cls._gc_overlay_path = _find_gc_overlay()
        return {"success": True, "path": str(cls._gc_overlay_path) if cls._gc_overlay_path else None, "available": cls._gc_overlay_path is not None}

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

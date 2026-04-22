import sys
import os
import subprocess
import threading
import multiprocessing
import asyncio
from pathlib import Path

from uvicorn import Config, Server
from socketio import ASGIApp
from loguru import logger

from server import server, socketio
from server.state import State
from server.settings import Settings, Config as TSHConfig
from server.utils.uvilogger import setup_logger

# Signals the tray (main thread on macOS) that the server is up and URL is set.
_server_ready = threading.Event()
# Set when the server fails to start (e.g. port in use) so the tray can react.
_server_failed = threading.Event()
# Reference to the running uvicorn Server so the tray can request a graceful
# shutdown from the main thread without raising signals into Cocoa handlers.
_uvicorn_server = None


def _open_browser(url: str):
    """Open a browser tab. Uses 'open' directly on macOS for frozen-app reliability."""
    if sys.platform == "darwin":
        subprocess.Popen(["open", url])
    else:
        import webbrowser
        webbrowser.open_new_tab(url)


async def main() -> int:
    wr = _writable_root()
    log_dir = os.path.join(wr, 'logs')
    os.makedirs(log_dir, exist_ok=True)

    logger.add(
        os.path.join(log_dir, "tsh_info.txt"),
        format="[{time:YYYY-MM-DD HH:mm:ss}] - {level} - {file}:{function}:{line} | {message} | {extra}",
        encoding="utf-8",
        level="INFO",
        rotation="20 MB",
        enqueue=False
    )

    logger.add(
        os.path.join(log_dir, "tsh_error.txt"),
        format="[{time:YYYY-MM-DD HH:mm:ss}] - {level} - {file}:{function}:{line} | {message} | {extra}",
        encoding="utf-8",
        level="ERROR",
        rotation="20 MB",
        enqueue=False
    )

    await asyncio.gather(
        TSHConfig.Load(),
        Settings.Load()
    )

    # TSH_DEV=1 is set by `npm run server` (via package.json).
    # Running python3 main.py directly uses production mode.
    dev_mode = os.environ.get("TSH_DEV") == "1"
    await Settings.Set("server.dev", dev_mode)

    host = await Settings.Get("server.host", "0.0.0.0")
    port = await Settings.Get("server.port", 5260)
    autostart = await Settings.Get("server.autostart", True)

    uvi = Server(Config(
        app=ASGIApp(
            socketio,
            other_asgi_app=server.app
        ),
        host=host,
        port=port,
        reload=await Settings.Get("dev", False),
        loop=asyncio.get_event_loop()
    ))
    global _uvicorn_server
    _uvicorn_server = uvi

    setup_logger()

    try:
        task_serve = asyncio.create_task(uvi.serve(), name="uvicorn")

        # Wait for uvicorn to start. If the task finishes before
        # uvi.started is set, the server failed (e.g. port in use).
        while not uvi.started:
            if task_serve.done():
                exc = task_serve.exception()
                logger.error("Server failed to start: {}", exc or "unknown error")
                _server_failed.set()
                return 1
            await asyncio.sleep(0.1)

        for uvi_server in uvi.servers:
            for socket in uvi_server.sockets:
                host_port = socket.getsockname()
                host = host_port[0]
                port = host_port[1]

        if host == "0.0.0.0":
            host = "localhost"

        server_url = f"http://{host}:{port}/"
        await TSHConfig.SetServerURL(server_url)

        # Signal the tray (if running on main thread) that the URL is ready.
        _server_ready.set()

        if autostart:
            logger.debug("opening browser to {server_url}", server_url=server_url)
            await asyncio.to_thread(_open_browser, server_url)

        logger.debug("awaiting server")
        tasks, _ = await asyncio.wait([task_serve])
        for task in tasks:
            if task.exception():
                raise task.exception()

    except (asyncio.exceptions.CancelledError, KeyboardInterrupt):
        pass

    return 0


def _run_asyncio():
    """Entry point for the background asyncio thread (macOS frozen mode)."""
    try:
        asyncio.run(main())
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    except Exception:
        logger.exception("Server thread exiting due to exception")
    finally:
        # If server never became ready, signal failure so the main thread doesn't hang.
        if not _server_ready.is_set():
            _server_failed.set()


def _writable_root() -> str:
    """Return a writable root directory for logs and user data.

    On macOS frozen builds, the .app bundle may be on a read-only volume,
    so we use ~/Library/Application Support/PRSH/ instead.
    On Windows or dev mode, use the current working directory.
    """
    if getattr(sys, 'frozen', False) and sys.platform == 'darwin':
        app_support = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'PRSH')
        os.makedirs(app_support, exist_ok=True)
        return app_support
    return '.'


if __name__ == '__main__':
    # Pyinstaller fix
    multiprocessing.freeze_support()

    frozen = getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS')
    if frozen:
        # CWD is set by hooks/runtime_hook_chdir.py before imports ran.
        # Use a writable root for logs (macOS .app bundles may be read-only).
        wr = _writable_root()
        log_dir = os.path.join(wr, 'logs')
        os.makedirs(log_dir, exist_ok=True)
        sys.stderr = open(os.path.join(log_dir, 'tsh_error.txt'), 'w', encoding='utf-8')
        sys.stdout = open(os.path.join(log_dir, 'tsh_info.txt'), 'w', encoding='utf-8')

    if frozen and sys.platform in ("darwin", "win32"):
        # Pre-flight port check on the main thread. If the configured port is
        # in use, show a dialog (auto-retry / open settings / quit) before
        # starting the server. Tk requires the main thread, so this must
        # happen before the server background thread is spawned.
        from server.port_conflict import preflight_port_check
        if preflight_port_check() is None:
            sys.exit(0)

        # Both pystray (macOS) and tkinter (Windows) must run on the main thread.
        # Run the asyncio server in a background thread instead.
        t = threading.Thread(target=_run_asyncio, daemon=True)
        t.start()

        # Wait for the server to be ready or fail.
        while not _server_ready.is_set() and not _server_failed.is_set():
            _server_ready.wait(timeout=0.5)

        if _server_failed.is_set():
            logger.error("Server failed to start — exiting. Check logs for details.")
            # Pre-flight should have caught port-in-use, so this is likely a
            # harder failure (permissions, missing deps, crash during import).
            # Reveal the log directory so the user can grab the file.
            try:
                from server.port_conflict import reveal_in_file_manager
                reveal_in_file_manager(Path(log_dir) / "tsh_error.txt")
            except Exception:
                pass
            sys.exit(1)

        if sys.platform == "darwin":
            try:
                from server.tray import Tray
                tray = Tray.create_tray()
                tray.run()  # blocks main thread; user quits via "Exit" in the tray menu
            except Exception:
                logger.exception("Tray failed to start; server will keep running until process is killed")
                t.join()  # keep main thread alive so the daemon server thread stays up
            # Tray has exited — wait briefly for the server thread to finish
            # its lifespan shutdown (settings save, gc-overlay stop, etc.)
            # before forcing exit. Without this, macOS shows "Not Responding"
            # while the daemon thread is forcibly torn down.
            t.join(timeout=5.0)
            os._exit(0)
        else:
            # Windows: show a persistent taskbar window instead of a tray icon.
            # A visible window always appears in the taskbar, solving the tray overflow issue.
            from server.win_window import WinWindow
            cfg = TSHConfig.config
            WinWindow.create_and_run(
                server_url=cfg.get("server_url", "http://localhost:5260/"),
                version=cfg.get("version", ""),
                name=cfg.get("name", "PRSH"),
            )
    else:
        ret = 0
        try:
            ret = asyncio.run(main())
        except (asyncio.exceptions.CancelledError, KeyboardInterrupt):
            pass
        except Exception:
            logger.exception("Exiting application due to exception")
            sys.exit(1)
        finally:
            sys.exit(ret)

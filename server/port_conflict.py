"""Pre-flight port conflict detection and recovery dialog.

Runs synchronously on the main thread before the async server starts. On
conflict, presents a modal tkinter dialog offering auto-retry (pick the
next free port + persist), reveal the settings folder, or quit.
"""

import os
import socket
import subprocess
import sys
from pathlib import Path

import orjson
from loguru import logger


def _settings_path() -> Path:
    """Resolve the settings.json path without pulling in the async Settings class."""
    # Matches server.paths.user_data_dir() for frozen + dev layouts.
    from server.paths import _frozen_writable_root
    root = _frozen_writable_root()
    if root is not None:
        root.mkdir(parents=True, exist_ok=True)
        return root / "user_data" / "settings.json"
    return Path("./user_data/settings.json").resolve()


def read_server_config() -> tuple[str, int]:
    """Read (host, port) from settings.json, falling back to defaults."""
    host, port = "0.0.0.0", 5260
    try:
        p = _settings_path()
        if p.exists():
            data = orjson.loads(p.read_bytes())
            server = data.get("server", {}) or {}
            host = server.get("host", host) or host
            port = int(server.get("port", port) or port)
    except Exception as e:
        logger.debug("[port_conflict] could not read settings: {}", e)
    return host, port


def probe_port(host: str, port: int) -> bool:
    """Return True if (host, port) is bindable right now."""
    # 0.0.0.0 binds to all interfaces; a probe of localhost is insufficient because
    # another process could still be listening on a specific interface.
    probe_host = host if host not in ("", "0.0.0.0") else "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((probe_host, port))
        s.close()
        return True
    except OSError:
        return False


def find_free_port(host: str, start: int, count: int = 20) -> int | None:
    """Scan [start, start+count) and return the first free port, else None."""
    for p in range(start, start + count):
        if probe_port(host, p):
            return p
    return None


def write_port(new_port: int) -> bool:
    """Persist a new server.port to settings.json. Returns True on success."""
    try:
        p = _settings_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        data: dict = {}
        if p.exists():
            data = orjson.loads(p.read_bytes())
        data.setdefault("server", {})
        data["server"]["port"] = int(new_port)
        p.write_bytes(orjson.dumps(data, option=orjson.OPT_INDENT_2))
        return True
    except Exception as e:
        logger.exception("[port_conflict] failed to write port: {}", e)
        return False


def reveal_in_file_manager(path: Path) -> None:
    """Reveal a file/folder in the OS file manager."""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
        elif sys.platform == "win32":
            # explorer /select,<path> highlights the file in Explorer.
            subprocess.Popen(["explorer", "/select,", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path.parent)])
    except Exception:
        logger.exception("[port_conflict] reveal failed")


def show_conflict_dialog(configured_port: int, suggested_port: int | None) -> str:
    """Show a modal dialog; return one of: 'retry', 'open_settings', 'quit'.

    Uses tkinter, which is bundled with PRSH (frozen via PyInstaller includes
    tkinter on both macOS and Windows; on macOS Tk comes from the system Python
    framework).
    """
    choice = {"value": "quit"}

    try:
        import tkinter as tk
        from tkinter import ttk

        root = tk.Tk()
        root.title("PRSH — Port in Use")
        root.resizable(False, False)

        # Center-ish
        root.update_idletasks()
        root.geometry("+300+200")

        frame = ttk.Frame(root, padding=16)
        frame.pack()

        ttk.Label(
            frame,
            text=f"Port {configured_port} is already in use.",
            font=("TkDefaultFont", 11, "bold"),
        ).pack(anchor="w")

        body_text = (
            "Another program (possibly another copy of PRSH) is using this port.\n\n"
            "OBS browser sources use this port, so changing it means you'll need\n"
            "to refresh your OBS sources with the new URL."
        )
        ttk.Label(frame, text=body_text, justify="left").pack(anchor="w", pady=(6, 10))

        btns = ttk.Frame(frame)
        btns.pack(fill="x", pady=(4, 0))

        def pick(val):
            choice["value"] = val
            root.destroy()

        if suggested_port is not None:
            retry_label = f"Use port {suggested_port} (next free)"
            ttk.Button(btns, text=retry_label, command=lambda: pick("retry")).pack(side="left")
        else:
            ttk.Label(
                btns,
                text="No free ports found nearby. Edit settings.json manually.",
                foreground="#b00",
            ).pack(side="left")

        ttk.Button(btns, text="Open settings folder", command=lambda: pick("open_settings")).pack(side="left", padx=8)
        ttk.Button(btns, text="Quit", command=lambda: pick("quit")).pack(side="right")

        root.protocol("WM_DELETE_WINDOW", lambda: pick("quit"))
        root.mainloop()
    except Exception:
        # If tkinter fails (unlikely), log and fall back to quit so the user at
        # least sees something in the logs rather than a silent process death.
        logger.exception("[port_conflict] dialog failed to render")

    return choice["value"]


def preflight_port_check() -> int | None:
    """Check the configured port and (if in use) prompt the user.

    Returns the port to use (possibly modified in settings.json), or None
    if the user chose to quit.
    """
    host, port = read_server_config()
    if probe_port(host, port):
        return port

    logger.warning("[port_conflict] configured port {} is in use", port)
    suggested = find_free_port(host, port + 1)
    action = show_conflict_dialog(port, suggested)

    if action == "retry" and suggested is not None:
        if write_port(suggested):
            logger.info("[port_conflict] moved to port {}", suggested)
            return suggested
        return None
    if action == "open_settings":
        reveal_in_file_manager(_settings_path())
        return None
    return None

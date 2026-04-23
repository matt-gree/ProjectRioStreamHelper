from pystray import Icon, Menu, MenuItem
from PIL import Image
from server.settings import Config
from loguru import logger
from os import path as _os_path
from pathlib import Path
import os
import subprocess
import sys


def _logo_path(filename: str = "logo.png") -> Path:
    """Return the absolute path to a logo file, works in both frozen and dev builds."""
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / "public" / filename
    return Path(__file__).parent.parent / "public" / filename


class Tray:
    icon = None

    @classmethod
    def on_open(cls, _icon=None, _item=None):
        url = Config.config.get("server_url", "")
        if not url:
            logger.warning("[Tray] Server URL not set yet — server may not have started")
            return
        if sys.platform == "darwin":
            subprocess.Popen(["open", url])
        else:
            import webbrowser
            webbrowser.open_new_tab(url)

    @classmethod
    def on_exit(cls, _icon=None, _item=None):
        logger.debug("[Tray] User requests exit")
        # Ask uvicorn to shut down gracefully from the main thread (just a
        # flag assignment — thread-safe). The asyncio thread will run the
        # lifespan shutdown (Settings.Save, gc-overlay stop, etc.) and
        # finish; main.py joins on it after tray.run() returns.
        try:
            import main as _main
            if _main._uvicorn_server is not None:
                _main._uvicorn_server.should_exit = True
        except Exception:
            logger.exception("[Tray] failed to signal uvicorn shutdown")
        if cls.icon:
            cls.icon.stop()

    @classmethod
    def on_open_settings(cls, _icon=None, _item=None):
        """Open the browser to the settings route."""
        url = Config.config.get("server_url", "")
        if not url:
            return
        # HashRouter: settings lives inside SettingsModal, which is toggled from
        # the header. Opening the app root is the simplest reliable entry.
        if sys.platform == "darwin":
            subprocess.Popen(["open", url])
        else:
            import webbrowser
            webbrowser.open_new_tab(url)

    @classmethod
    def on_open_logs(cls, _icon=None, _item=None):
        """Reveal the logs folder in Finder / Explorer."""
        from server.paths import _frozen_writable_root
        root = _frozen_writable_root() or Path(".").resolve()
        log_dir = root / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", str(log_dir)])
            elif sys.platform == "win32":
                os.startfile(str(log_dir))  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", str(log_dir)])
        except Exception:
            logger.exception("[Tray] failed to open logs folder")

    @classmethod
    def show_notification(cls, *args, **kwargs):
        if Icon.HAS_NOTIFICATION:
            cls.icon.notify(*args, **kwargs)

    @classmethod
    def create_tray(cls):
        name = Config.config.get("name", "PRSH")
        version = Config.config.get("version", "")
        # Non-clickable "About" line — pystray makes a MenuItem with no action
        # non-interactive by default.
        about_label = f"{name} v{version}" if version else name

        menu_items = [
            MenuItem(text=about_label, action=lambda *a: None, enabled=False),
            Menu.SEPARATOR,
            MenuItem(text="Open...", action=cls.on_open, default=True),
            MenuItem(text="Open logs folder", action=cls.on_open_logs),
            Menu.SEPARATOR,
            MenuItem(text="Exit", action=cls.on_exit, default=False),
        ]

        # PIL image for pystray (required for initialization + Windows)
        logo_png = _logo_path("logo_tray.png")
        logger.debug(f"[Tray] Loading logo from {logo_png} (exists={logo_png.exists()})")
        logo = Image.open(str(logo_png))

        cls.icon = Icon(
            name=Config.config["name"],
            icon=logo,
            title=Config.config["name"] + " " + Config.config["version"],
            menu=Menu(*menu_items)
        )

        # On macOS, bypass pystray's PIL→NSImage conversion (which uses LANCZOS
        # and blurs pixel art). Load the .icns natively via NSImage so macOS
        # picks the best resolution for the menu bar automatically.
        if sys.platform == "darwin":
            icns_file = _logo_path("logo_tray.icns")
            if icns_file.exists():
                import AppKit

                ns_image = AppKit.NSImage.alloc().initWithContentsOfFile_(str(icns_file))
                if ns_image:
                    # Template image: macOS uses alpha only and tints to match
                    # the menu bar (black on light bars, white on dark bars).
                    ns_image.setTemplate_(True)

                    def _patched_assert(self_icon=cls.icon, native=ns_image):
                        thickness = self_icon._status_bar.thickness()
                        size = AppKit.NSMakeSize(thickness, thickness)
                        native.setSize_(size)
                        self_icon._icon_image = native
                        self_icon._status_item.button().setImage_(native)

                    cls.icon._assert_image = _patched_assert

        return cls.icon
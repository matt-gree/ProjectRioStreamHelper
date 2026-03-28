from pystray import Icon, Menu, MenuItem
from PIL import Image
from server.settings import Config
from loguru import logger
from os import kill, getpid
from signal import SIGINT
from pathlib import Path
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
        if cls.icon:
            cls.icon.stop()
        kill(getpid(), SIGINT)

    @classmethod
    def show_notification(cls, *args, **kwargs):
        if Icon.HAS_NOTIFICATION:
            cls.icon.notify(*args, **kwargs)

    @classmethod
    def create_tray(cls):
        menu_items = [
            MenuItem(text="Open...", action=cls.on_open, default=True),
            Menu.SEPARATOR,
            MenuItem(text="Exit", action=cls.on_exit, default=False)
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
                    def _patched_assert(self_icon=cls.icon, native=ns_image):
                        thickness = self_icon._status_bar.thickness()
                        size = AppKit.NSMakeSize(thickness, thickness)
                        native.setSize_(size)
                        self_icon._icon_image = native
                        self_icon._status_item.button().setImage_(native)

                    cls.icon._assert_image = _patched_assert

        return cls.icon
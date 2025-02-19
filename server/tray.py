from pystray import Icon, Menu, MenuItem
from PIL import Image
from server.settings import Config
from loguru import logger
from os import kill, getpid
from signal import SIGINT
from pathlib import Path
import webbrowser

class Tray:
    icon = None

    @classmethod
    def on_open(cls):
        webbrowser.open_new_tab(Config.config["server_url"])

    @classmethod
    def on_exit(cls):
        logger.debug("user requests exit")
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

        logo = Image.open(str(Path("./dist/logo.png")), mode="r")
        cls.icon = Icon(
            name=Config.config["name"], 
            icon=logo, 
            title=Config.config["name"] + " " + Config.config["version"],
            menu=Menu(*menu_items)
        )

        return cls.icon
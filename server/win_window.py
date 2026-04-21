import os
import sys
import tkinter as tk
import webbrowser
from pathlib import Path

from loguru import logger


def _logo_path() -> Path:
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / "public" / "logo_tray.png"
    return Path(__file__).parent.parent / "public" / "logo_tray.png"


class WinWindow:
    @classmethod
    def create_and_run(cls, server_url: str, version: str, name: str):
        root = tk.Tk()
        root.title(name)
        root.resizable(False, False)

        try:
            from PIL import Image, ImageTk
            img = Image.open(str(_logo_path()))
            photo = ImageTk.PhotoImage(img)
            root.iconphoto(True, photo)
            root._photo = photo  # prevent GC
        except Exception:
            logger.debug("[WinWindow] Could not load window icon")

        def _exit():
            logger.debug("[WinWindow] User requested exit")
            root.destroy()
            os._exit(0)

        root.protocol("WM_DELETE_WINDOW", _exit)

        tk.Label(root, text=name, font=("Segoe UI", 11, "bold")).pack(padx=24, pady=(16, 2))
        tk.Label(root, text=f"v{version}", font=("Segoe UI", 9), fg="#888888").pack()

        link = tk.Label(
            root, text=server_url, fg="#0066cc", cursor="hand2",
            font=("Segoe UI", 9, "underline"),
        )
        link.pack(pady=(10, 0))
        link.bind("<Button-1>", lambda _: webbrowser.open_new_tab(server_url))

        tk.Button(root, text="Exit", command=_exit, width=10, pady=2).pack(pady=(12, 16))

        root.mainloop()

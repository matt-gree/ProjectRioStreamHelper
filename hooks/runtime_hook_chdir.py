# PyInstaller runtime hook — runs before main.py (and before any imports).
# Sets CWD to the executable's directory so that all relative paths
# (./dist, ./public, ./user_data) resolve correctly in both the server
# imports and the main application code.
import sys
import os

if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    os.chdir(sys._MEIPASS)
    # Don't create ./logs here — on macOS the bundle may be read-only
    # (App Translocation). main.py handles log dirs via _writable_root().

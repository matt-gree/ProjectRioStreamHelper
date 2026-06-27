"""PRSH Project Rio integration package.

Importing this package wires the RioVisualizer submodule (top-level
``rio_visualizer`` package, living outside ``server/``) onto ``sys.path`` so
``from rio_visualizer.api import simulate`` resolves. This runs before any
``server.rio.*`` submodule (e.g. provider) is imported.
"""
from server.paths import ensure_rio_visualizer_on_path

ensure_rio_visualizer_on_path()

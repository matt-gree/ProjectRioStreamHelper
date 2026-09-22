"""PRSH Project Rio integration package.

Importing this package wires the RioVisualizer submodule (top-level
``rio_visualizer`` package, living outside ``server/``) onto ``sys.path`` so
``from rio_visualizer.api import simulate`` resolves, and aliases PRSH's
vendored pyrio as top-level ``pyrio`` so RioVisualizer's ``import pyrio`` hit
engine resolves to our single copy (not a second nested checkout). Both run
before any ``server.rio.*`` submodule (e.g. provider) is imported.
"""
from server.paths import ensure_pyrio_importable, ensure_rio_visualizer_on_path

ensure_pyrio_importable()
ensure_rio_visualizer_on_path()

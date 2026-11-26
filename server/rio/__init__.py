"""PRSH Project Rio integration package.

Importing this package makes ``import pyrio`` resolve to the pinned submodule
at ``server/rio/pyrio`` and puts the RioVisualizer submodule (top-level
``rio_visualizer`` package, outside ``server/``) on ``sys.path``. Both run
before any ``server.rio.*`` submodule (e.g. provider) is imported.
"""
from server.paths import ensure_pyrio_importable, ensure_rio_visualizer_on_path

ensure_pyrio_importable()
ensure_rio_visualizer_on_path()

"""Post-game capture: a finished game's box score, read from Project Rio's stat
file and projected into ``postgame.{N}``.

- ``capture`` — ``PostGame``, the model and projector
- ``files``   — which stat file belongs to a game, and reading it
- ``stats``   — box-score shaping
- ``contacts`` — the Character Spotlight's per-AB walkthrough
- ``watch``   — ``StatFileWatcher``, auto-capture when Rio writes the file
"""
from server.postgame.capture import PostGame

__all__ = ["PostGame"]

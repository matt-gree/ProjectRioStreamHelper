"""Shared address-book resurface map.

Maps a participant registry ``display.*`` field to the ``score.{N}.player.{T}.*``
field overlays read. Used by both the HUD/Live/Rotator resurface path
(``server/rio/provider.py``) and the Match projector (``server/match.py``) so the
two stay in lockstep. Mirrors the frontend resolver (``src/lib/participants.js``).
``mainCharacter`` has no scoreboard target and is intentionally omitted.
"""

RESURFACE_MAP = {
    "tag": "name",
    "prefix": "team",
    "fullName": "full_name",
    "pronoun": "pronoun",
    "country": "country",
    "state": "state",
    "twitter": "twitter",
    "youtube": "youtube",
}

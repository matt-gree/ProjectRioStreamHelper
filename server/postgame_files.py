"""Stat-file location + IO for the post-game capture (``server/postgame.py``).

Project Rio writes a decoded stat file per finished game under
``StatFiles/MarioSuperstarBaseball/`` — a sibling of the ``HudFiles`` directory
that holds ``decoded.hud.json``. Selection is **not** "newest file": a capture
matches the file whose in-file ``GameID`` equals the just-finished game's id
AND whose ``Loaded from HUD`` flag is ``0`` (a HUD-replay file is not real
recorded data and is rejected).
"""
import re
from pathlib import Path

from loguru import logger

from server.rio.provider import get_default_hud_file_path
from server.settings import Settings

_STAT_SUBDIR = ("StatFiles", "MarioSuperstarBaseball")
_DECODED_PREFIX = "decoded."
# Trailing _<digits>.json in a stat-file name is the GameID (decimal). Used only
# as a cheap pre-filter; the GameID inside the file is the authoritative match.
_FILENAME_GAMEID_RE = re.compile(r"_(\d+)\.json$")


def norm_game_id(g) -> str:
    """Canonical comparison form for a GameID from any source.

    The stat file's ``GameID`` is a decimal string matching its filename; the
    HUD feed writes ``score.{N}.game_id`` as a string while the Live-API path
    writes an int. Normalize all of them to a comma/space-stripped string.
    """
    if g is None:
        return ""
    return str(g).replace(",", "").strip()


def stat_dir() -> Path:
    """``StatFiles/MarioSuperstarBaseball`` as a sibling of ``HudFiles``.

    Resolved from the configured HUD path when set, else the OS default. The
    HUD *file* may be absent (a game just ended) — we only need its parent
    layout, so this never gates on file existence.
    """
    user_path = Settings.Get("project_rio.hud_path", "")
    hud = Path(user_path) if user_path else get_default_hud_file_path()
    return hud.parent.parent.joinpath(*_STAT_SUBDIR)


def candidate_files(game_id: str) -> list[Path]:
    """Decoded stat files whose filename GameID matches, newest first.

    Filename match is a pre-filter only; ``find_file`` re-verifies the
    in-file GameID and the Loaded-from-HUD gate.
    """
    d = stat_dir()
    if not d.is_dir():
        return []
    files = []
    for p in d.glob(f"{_DECODED_PREFIX}*.json"):
        m = _FILENAME_GAMEID_RE.search(p.name)
        if m and (not game_id or norm_game_id(m.group(1)) == game_id):
            files.append(p)
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files


def load_json(path: Path) -> dict | None:
    try:
        import orjson
        return orjson.loads(path.read_bytes())
    except Exception:
        logger.exception("[PostGame] failed to read stat file {}", path)
        return None


def find_file(game_id: str) -> tuple[Path | None, str | None]:
    """Locate the usable stat file for ``game_id``.

    Returns ``(path, None)`` on success, or ``(None, reason)`` when no file
    matches or the only match is a HUD replay (``Loaded from HUD != 0``).
    """
    gid = norm_game_id(game_id)
    if not gid:
        return None, "No game id for this scoreboard yet — start/finish a game first."

    candidates = candidate_files(gid)
    if not candidates:
        return None, f"No stat file found for game {gid} in {stat_dir()}."

    loaded_from_hud_seen = False
    for path in candidates:
        data = load_json(path)
        if data is None:
            continue
        if norm_game_id(data.get("GameID")) != gid:
            continue
        if data.get("Loaded from HUD", 0) != 0:
            loaded_from_hud_seen = True
            continue
        return path, None

    if loaded_from_hud_seen:
        return None, (
            f"Stat file for game {gid} was loaded from a HUD replay "
            "(Loaded from HUD != 0) and has no usable stats."
        )
    return None, f"No usable stat file matched game {gid}."


def list_files(limit: int = 25) -> list[dict]:
    """Recent usable (``Loaded from HUD == 0``) stat files for a manual pick.

    Returns lightweight descriptors, newest first — no full parse.
    """
    d = stat_dir()
    if not d.is_dir():
        return []
    files = sorted(d.glob(f"{_DECODED_PREFIX}*.json"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    for p in files[: limit * 2]:
        data = load_json(p)
        if data is None or data.get("Loaded from HUD", 0) != 0:
            continue
        out.append({
            "file": p.name,
            "gameId": norm_game_id(data.get("GameID")),
            "awayPlayer": data.get("Away Player", ""),
            "homePlayer": data.get("Home Player", ""),
            "awayScore": data.get("Away Score"),
            "homeScore": data.get("Home Score"),
            "endDate": data.get("Date - End", ""),
        })
        if len(out) >= limit:
            break
    return out

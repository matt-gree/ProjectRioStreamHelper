"""Stat-file location + IO for the post-game capture (``server/postgame/capture.py``).

Project Rio writes a decoded stat file per finished game under
``StatFiles/MarioSuperstarBaseball/`` — a sibling of the ``HudFiles`` directory
that holds ``decoded.hud.json``. Selection is **not** "newest file": a capture
matches the file whose in-file ``GameID`` equals the just-finished game's id
AND whose ``Loaded from HUD`` flag is ``0`` (a HUD-replay file is not real
recorded data and is rejected).
"""
import os
import re
from datetime import datetime
from pathlib import Path

from loguru import logger
import pyrio

from server.rio.provider import get_default_hud_file_path
from server.settings import Settings

_STAT_SUBDIR = ("StatFiles", "MarioSuperstarBaseball")
_DECODED_PREFIX = "decoded."
# Trailing _<id>.json in a stat-file name is the GameID: decimal before Rio
# 2.3.0, hex from it. Used only as a cheap pre-filter; the GameID pyrio reads
# from inside the file is the authoritative match.
_FILENAME_GAMEID_RE = re.compile(r"_([0-9A-Fa-f]+)\.json$")


def _filename_matches(token: str, game_id: str) -> bool:
    """Whether a file name's id token can be ``game_id`` (a decimal string), read either way."""
    try:
        wanted = int(game_id)
    except ValueError:
        return False
    return (token.isdigit() and int(token) == wanted) or int(token, 16) == wanted


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

    Resolution mirrors ``provider.get_user_hud_path``: ``PRSH_HUD_FILE`` is
    authoritative, then the configured HUD path, then the OS default. Honouring
    the env override matters now that auto-capture watches this directory
    (``server/postgame/watch.py``) — resolving past it pointed an isolated
    agent/CI instance at the developer's REAL Project Rio folder, where it would
    capture live games into a throwaway state file.

    The HUD *file* may be absent (a game just ended) — we only need its parent
    layout, so this never gates on file existence.
    """
    override = os.environ.get("PRSH_HUD_FILE")
    user_path = Settings.Get("project_rio.hud_path", "")
    if override:
        hud = Path(override).expanduser()
    elif user_path:
        hud = Path(user_path)
    else:
        hud = get_default_hud_file_path()
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
        if m and (not game_id or _filename_matches(m.group(1), game_id)):
            files.append(p)
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files


def read_game(path: Path) -> pyrio.Game | None:
    """A stat file read by pyrio, or None (logged) when it can't be read."""
    try:
        return pyrio.read_game(path)
    except (pyrio.RioError, OSError) as e:
        logger.warning("[PostGame] could not read stat file {}: {}", path, e)
        return None


def display_time(when: datetime) -> str:
    """A game time the way Rio's decoded files write it ("Sun Nov 22 20:36:20 2026"), local time."""
    return (when.astimezone() if when.tzinfo else when).ctime()


def find_file(game_id: str) -> tuple[Path | None, str | None]:
    """Locate the usable stat file for ``game_id``.

    Returns ``(path, None)`` on success, or ``(None, reason)`` when no file
    matches or the only match is a HUD replay (loaded from a HUD file).
    """
    gid = norm_game_id(game_id)
    if not gid:
        return None, "No game id for this scoreboard yet — start/finish a game first."

    candidates = candidate_files(gid)
    if not candidates:
        return None, f"No stat file found for game {gid} in {stat_dir()}."

    loaded_from_hud_seen = False
    for path in candidates:
        game = read_game(path)
        if game is None or str(game.id) != gid:
            continue
        if game.loaded_from_hud:
            loaded_from_hud_seen = True
            continue
        return path, None

    if loaded_from_hud_seen:
        return None, (
            f"Stat file for game {gid} was loaded from a HUD replay "
            "(Loaded from HUD != 0) and has no usable stats."
        )
    return None, f"No usable stat file matched game {gid}."


def resolve_pick(name: str) -> tuple[Path | None, str | None]:
    """Resolve a producer's hand-picked stat file to a path inside ``stat_dir``.

    The override for when the automatic match cannot work: a game whose id never
    reached the board, a crash that left the board on the wrong game, a file that
    landed under an id nobody expected. It deliberately does NOT check the GameID
    against the board — overriding that check is the entire point.

    What it does check is that the file is one of ours. ``name`` comes off an
    HTTP query string, so it is untrusted: the basename is taken first (a
    traversal sequence cannot survive it), and the resolved parent is compared to
    the resolved stat directory afterwards, which is what catches a symlink
    pointing out of the folder. The HUD-replay gate stays — such a file has no
    recorded stats to read, so accepting one would trade a clear refusal for an
    empty box score.
    """
    if not name or not str(name).strip():
        return None, "No stat file chosen."

    d = stat_dir()
    path = d / os.path.basename(str(name).strip())

    try:
        resolved = path.resolve()
        if resolved.parent != d.resolve():
            return None, "That file is not in Project Rio's stat folder."
    except OSError:
        return None, "That file could not be read."

    if not resolved.is_file():
        return None, f"No stat file named {path.name} in {d}."

    game = read_game(resolved)
    if game is None:
        return None, f"Could not read stat file {path.name}."
    if game.loaded_from_hud:
        return None, (
            f"{path.name} was loaded from a HUD replay "
            "(Loaded from HUD != 0) and has no usable stats."
        )
    return resolved, None


def list_files(limit: int = 25) -> list[dict]:
    """Recent usable (not HUD-replay) stat files for a manual pick, newest first."""
    d = stat_dir()
    if not d.is_dir():
        return []
    files = sorted(d.glob(f"{_DECODED_PREFIX}*.json"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    for p in files[: limit * 2]:
        game = read_game(p)
        if game is None or game.loaded_from_hud:
            continue
        out.append({
            "file": p.name,
            "gameId": str(game.id),
            "awayPlayer": game.away.player,
            "homePlayer": game.home.player,
            "awayScore": game.away.score,
            "homeScore": game.home.score,
            "endDate": display_time(game.end_time),
        })
        if len(out) >= limit:
            break
    return out

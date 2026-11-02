"""Stat-file location + IO for the post-game capture (``server/postgame/capture.py``).

Project Rio writes a decoded stat file per game under
``StatFiles/MarioSuperstarBaseball/`` — a sibling of the ``HudFiles`` directory
that holds ``decoded.hud.json``: ``decoded.*`` for a finished game,
``quit.decode.*`` for one quit part way. Selection is **not** "newest file": a
capture matches the file whose in-file ``GameID`` equals the just-finished game's
id AND whose ``Loaded from HUD`` flag is ``0`` (a HUD-replay file is not real
recorded data and is rejected).
"""
import os
import re
from pathlib import Path

from loguru import logger

from server.rio.provider import get_default_hud_file_path
from server.settings import Settings

_STAT_SUBDIR = ("StatFiles", "MarioSuperstarBaseball")
_DECODED_PREFIX = "decoded."
# A game quit part way. Project Rio with the quit fixes writes only this; earlier
# versions write it a few ms before a `decoded.` file for the same game, with the
# unfinished last event still in it, which is why `decoded.` wins a pair. The
# encoded `quit.*` files share the first word and are not ours; nor is `crash.*`.
_QUIT_PREFIX = "quit.decode."
# Trailing _<id>.json in a stat-file name is the GameID: lowercase hex from Rio
# 2.3.0, decimal before it, and this matches both. Used only as a cheap
# pre-filter; the GameID inside the file is the authoritative match.
_FILENAME_GAMEID_RE = re.compile(r"_([0-9a-fA-F]+)\.json$")


def norm_game_id(g) -> str:
    """Canonical comparison form for a GameID from any source.

    The stat file's ``GameID`` matches its filename: lowercase hex from Rio
    2.3.0, a decimal string (often comma-grouped) before it. The HUD feed writes
    ``score.{N}.game_id`` as the same string while the Live-API path writes an
    int. Normalize all of them to a comma/space-stripped lowercase string — never
    a number, because ``123`` alone does not say which base it is in.
    """
    if g is None:
        return ""
    return str(g).replace(",", "").strip().lower()


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


def is_stat_file(name: str) -> bool:
    """Whether ``name`` is a decoded stat file: ``decoded.*`` or ``quit.decode.*``."""
    return name.startswith((_DECODED_PREFIX, _QUIT_PREFIX)) and name.endswith(".json")


def _game_key(name: str) -> str:
    """What a game's ``decoded.*`` and ``quit.decode.*`` names share: all of it
    past the timestamp, which can differ across a second boundary. The GameID
    alone would not do — old quit files can have an id of 0."""
    return name.partition("_")[2]


def is_quit_game(name: str) -> bool:
    """Whether the stat file ``name`` is from a game that was quit.

    Decided by filename, as a quit file or a ``decoded.*`` with a quit twin.
    ``Quitter Team`` can't say: it stays "None" on a quit that wasn't made from
    the pause menu, and pyrio's ``wasQuit`` has been true for every game.
    """
    if name.startswith(_QUIT_PREFIX):
        return True
    d = stat_dir()
    if not d.is_dir():
        return False
    key = _game_key(name)
    return any(p.name.startswith(_QUIT_PREFIX) and _game_key(p.name) == key
               for p in d.iterdir())


def candidate_files(game_id: str) -> list[Path]:
    """Decoded stat files whose filename GameID matches: ``decoded.*`` before
    ``quit.decode.*``, each newest first.

    Filename match is a pre-filter only; ``find_file`` re-verifies the
    in-file GameID and the Loaded-from-HUD gate.
    """
    d = stat_dir()
    if not d.is_dir():
        return []
    files = []
    for p in d.iterdir():
        m = _FILENAME_GAMEID_RE.search(p.name)
        if is_stat_file(p.name) and m and (not game_id or norm_game_id(m.group(1)) == game_id):
            files.append(p)
    files.sort(key=lambda p: (p.name.startswith(_QUIT_PREFIX), -p.stat().st_mtime))
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

    data = load_json(resolved)
    if data is None:
        return None, f"Could not read stat file {path.name}."
    if data.get("Loaded from HUD", 0) != 0:
        return None, (
            f"{path.name} was loaded from a HUD replay "
            "(Loaded from HUD != 0) and has no usable stats."
        )
    return resolved, None


def list_files(limit: int = 25) -> list[dict]:
    """Recent usable (``Loaded from HUD == 0``) stat files for a manual pick.

    Returns lightweight descriptors, newest first — no full parse. A game with
    both a ``decoded.*`` and a ``quit.decode.*`` file is listed once, as the
    ``decoded.*`` unless that one can't be used.
    """
    d = stat_dir()
    if not d.is_dir():
        return []
    files = sorted((p for p in d.iterdir() if is_stat_file(p.name)),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    quit_keys = {_game_key(p.name) for p in files if p.name.startswith(_QUIT_PREFIX)}
    decoded = {_game_key(p.name): p for p in files if p.name.startswith(_DECODED_PREFIX)}

    def usable(data: dict | None) -> bool:
        return data is not None and data.get("Loaded from HUD", 0) == 0

    out = []
    for p in files[: limit * 2]:
        data = load_json(p)
        if not usable(data):
            continue
        twin = decoded.get(_game_key(p.name)) if p.name.startswith(_QUIT_PREFIX) else None
        if twin is not None and usable(load_json(twin)):
            continue
        out.append({
            "file": p.name,
            "gameId": norm_game_id(data.get("GameID")),
            "awayPlayer": data.get("Away Player", ""),
            "homePlayer": data.get("Home Player", ""),
            "awayScore": data.get("Away Score"),
            "homeScore": data.get("Home Score"),
            "endDate": data.get("Date - End", ""),
            "quit": _game_key(p.name) in quit_keys,
        })
        if len(out) >= limit:
            break
    return out

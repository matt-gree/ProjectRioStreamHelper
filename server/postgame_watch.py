"""Auto-capture — turns Project Rio writing a stat file into a post-game capture.

**The file appearing IS the end-of-game signal**, and it is the only reliable one
a local board has. The HUD feed has no final frame — it simply stops, or the next
game overwrites it — and ``score.{N}.game_completed`` is written by the API paths
alone (``server/rio/provider.py``, ``game_pool.py``). Project Rio, meanwhile,
writes exactly one decoded stat file per finished game the moment it ends, which
is also the precondition a capture needs: watching for the file means never
firing before there is something to read.

So this module is deliberately thin. It decides only WHEN to ask; whether a file
is usable stays in ``postgame_files.find_file`` (GameID + Loaded-from-HUD), and
the capture itself is the same ``PostGame.capture`` the producer's button calls,
under the same lock — a watcher capture and a hand capture racing the same board
is exactly the case that lock was written for.

The producer's Capture button does not go away. It is the recovery path for a
file that lands late, a capture that was cleared and is wanted back, or a rig
with ``postgame.auto_capture`` turned off.
"""
import asyncio
from pathlib import Path

from loguru import logger
from watchfiles import Change, awatch

from server import postgame_files
from server.postgame import PostGame
from server.postgame_files import norm_game_id
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get
from server.utils.tasks import spawn

# How long to wait before looking for the stat directory again. It does not
# exist until Project Rio has finished its first game on this machine, so a
# fresh install boots with nothing to watch and must not treat that as fatal.
DIR_RETRY = 30.0

# Falsey spellings a settings value can arrive as. `PUT /settings?key=&value=`
# writes every value as a STRING (query params have no types), so a switch
# turned off through the REST route lands as `"false"` — which is truthy, and
# an off switch that reads as on is worse than no off switch. The UI writes a
# real bool over the socket; this reads both. Same dance as
# `State._is_export_enabled` and the modal's hud_enabled read.
_FALSEY = ("", "0", "false", "no", "off")


def _flag(key: str, default: bool = True) -> bool:
    value = Settings.Get(key, default)
    if isinstance(value, str):
        return value.strip().lower() not in _FALSEY
    return bool(value)


class StatFileWatcher:
    """Watches Project Rio's stat-file directory for finished games. Singleton
    like the other watchers — all lifecycle state is class-level."""

    _task: asyncio.Task | None = None
    _stop: asyncio.Event | None = None

    # (sb, game_id) pairs already auto-captured this session. A file is written
    # in more than one syscall, so `added` is usually followed by `modified`;
    # this is what makes the capture once-per-game rather than once-per-write.
    # It is also what makes the producer's Clear STICK: having cleared a capture
    # they did not want, the file is still sitting there and every later write
    # in that directory would otherwise hand it back.
    _done: set[tuple[int, str]] = set()

    @classmethod
    def reset(cls) -> None:
        cls._done = set()

    @classmethod
    async def Start(cls) -> None:
        if cls._task is not None:
            return
        cls._stop = asyncio.Event()
        cls._task = spawn(cls._loop(), name="postgame.stat_watch")

    @classmethod
    async def Stop(cls) -> None:
        if cls._stop is not None:
            cls._stop.set()
        if cls._task is not None:
            cls._task.cancel()
            try:
                await cls._task
            except (asyncio.CancelledError, Exception):
                pass
        cls._task = None
        cls._stop = None

    @classmethod
    async def Restart(cls) -> None:
        """Re-resolve the watched directory — the HUD path moved, and the stat
        directory is derived from it (``postgame_files.stat_dir``)."""
        await cls.Stop()
        await cls.Start()

    # ----- watch loop ------------------------------------------------------

    @classmethod
    async def _loop(cls) -> None:
        while cls._stop is not None and not cls._stop.is_set():
            d = postgame_files.stat_dir()
            if not d.is_dir():
                # Nothing to watch yet (no game has ever finished on this
                # machine, or the HUD path points somewhere else). Not an error.
                try:
                    await asyncio.wait_for(cls._stop.wait(), timeout=DIR_RETRY)
                except asyncio.TimeoutError:
                    continue
                return
            logger.info("[PostGame] auto-capture watching {}", d)
            try:
                async for changes in awatch(
                    d,
                    watch_filter=lambda change, path: Path(path).name.startswith("decoded.")
                    and path.endswith(".json"),
                    stop_event=cls._stop,
                    debounce=300,
                    step=200,
                ):
                    for change_type, path in changes:
                        if change_type in (Change.added, Change.modified):
                            await cls._on_file(Path(path))
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[PostGame] auto-capture watch failed — retrying")
                try:
                    await asyncio.wait_for(cls._stop.wait(), timeout=DIR_RETRY)
                except asyncio.TimeoutError:
                    continue
                return

    # ----- capture decision -------------------------------------------------

    @classmethod
    def _board_carrying(cls, game_id: str) -> int | None:
        """The active board whose live game is ``game_id``, or None.

        A capture is projected per board, so the file has to be matched to one.
        Matching on the id the board is CARRYING (rather than, say, capturing to
        board 1 because the file is local) is what keeps a two-board rig honest:
        the stat file for the game on board 2 captures to board 2.
        """
        for sb in Settings.Get("scoreboards.active", [1]) or [1]:
            live = norm_game_id(deep_get(State.state, f"score.{sb}.game_id", None))
            if live and live == game_id:
                return int(sb)
        return None

    @classmethod
    async def _on_file(cls, path: Path) -> None:
        if not _flag("postgame.auto_capture"):
            return
        data = postgame_files.load_json(path)
        if data is None:
            return
        # A HUD-replay file is not recorded data. find_file rejects it too — this
        # check only avoids burning a capture attempt (and a _done slot) on it.
        if data.get("Loaded from HUD", 0) != 0:
            return
        gid = norm_game_id(data.get("GameID"))
        if not gid:
            return
        sb = cls._board_carrying(gid)
        if sb is None:
            return
        key = (sb, gid)
        if key in cls._done:
            return

        # Claimed BEFORE the await: two writes to the same file land as two
        # events, and both would otherwise reach capture() and queue on its lock.
        cls._done.add(key)
        logger.info("[PostGame] stat file for game {} landed — auto-capturing board {}", gid, sb)
        try:
            result = await PostGame.capture(sb, by="auto")
        except Exception:
            cls._done.discard(key)
            logger.exception("[PostGame] auto-capture crashed for board {}", sb)
            return
        if not result.get("success"):
            # Released, not kept: the usual failure is a file still being written,
            # and the `modified` event that follows is the retry.
            cls._done.discard(key)
            logger.warning("[PostGame] auto-capture declined for board {}: {}",
                           sb, result.get("reason"))

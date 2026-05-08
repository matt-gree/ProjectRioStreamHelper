import asyncio
import time

from loguru import logger
from server import socketio
from server.rio.game_pool import (
    OngoingGamePool,
    CompletedGamePool,
    apply_completed_game_dict,
)
from server.rio import stats_api
from server.rio.game_pool import _sanitize_row
from server.rio.stats_tracker import StatsTracker
from server.settings import Settings
from server.state import State


async def _mirror_to_state(sb_id: int, **fields):
    """Mirror rotation fields into State so overlays can subscribe to
    `scoreboards.rotation.{sb_id}.*` like any other state-backed data.

    Settings remains the persistence layer (used by resume-on-startup);
    State is just a live broadcast view for overlays + the React store.
    Pass only the fields that actually changed.
    """
    if not fields:
        return
    entries = [
        (f"scoreboards.rotation.{sb_id}.{k}", v) for k, v in fields.items()
    ]
    await State.SetBatch(entries)
    await State.Save()


class RotationManager:
    """Manages game rotation for scoreboards.

    Each scoreboard can have an independent rotation that cycles through
    a list of game_ids at a configurable interval. Supports both ongoing
    and completed API games.
    """

    # {scoreboard_number: RotationState}
    _rotations: dict[int, "RotationState"] = {}
    _prefetch_task: asyncio.Task | None = None
    _resume_task: asyncio.Task | None = None

    @classmethod
    async def Start(cls):
        """Initialize rotation manager. Auto-resumes rotations that were active in the previous session."""
        rotation_settings = Settings.Get("scoreboards.rotation", {})
        sources = Settings.Get("scoreboards.sources", {})
        active = set(Settings.Get("scoreboards.active", [1]))

        # Only resume rotations whose scoreboard still exists AND whose
        # current source type is "rotator". Otherwise a stale rotation can
        # keep writing into a scoreboard the user has reassigned.
        to_resume = {}
        for sb_id_str, config in rotation_settings.items():
            try:
                sb_id = int(sb_id_str)
            except (TypeError, ValueError):
                continue
            if sb_id not in active:
                continue
            if sources.get(sb_id_str, {}).get("type") != "rotator":
                # Drop the stale enabled flag so we don't keep skipping it.
                if config.get("enabled"):
                    await Settings.Set(f"scoreboards.rotation.{sb_id}.enabled", False)
                continue
            if config.get("enabled", False) and config.get("game_ids"):
                to_resume[sb_id] = config

        if not to_resume:
            logger.info("[RotationManager] Initialized (no rotations to resume)")
            return

        # Resume in the background so startup isn't blocked by the API call
        cls._resume_task = asyncio.create_task(cls._resume_rotations(to_resume))
        logger.info("[RotationManager] Initialized (resuming {} rotation(s) in background)", len(to_resume))

    @classmethod
    async def _resume_rotations(cls, to_resume: dict):
        """Restart previously active rotations.

        Each rotation refetches its own completed games using its persisted
        filters (scoreboards.rotation.{sb_id}.filters); there is no shared
        snapshot, so two rotations on different filters resume independently.
        """
        resumed = []
        for sb_id, config in to_resume.items():
            try:
                await cls.start_rotation(sb_id)
                resumed.append(sb_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[RotationManager] Failed to resume rotation for scoreboard {}", sb_id)
                config["enabled"] = False
                await Settings.Set(f"scoreboards.rotation.{sb_id}", config)

        if resumed:
            logger.info("[RotationManager] Resumed rotations for scoreboards: {}", resumed)
        else:
            logger.info("[RotationManager] All resume attempts failed")

    @classmethod
    async def Stop(cls):
        """Stop all active rotations, preserving enabled state for next session."""
        # Cancel the background resume task if it's still running
        if cls._resume_task and not cls._resume_task.done():
            cls._resume_task.cancel()
            try:
                await cls._resume_task
            except asyncio.CancelledError:
                pass
            cls._resume_task = None

        # Record which rotations were active so they can resume on next start
        active_ids = [sb_id for sb_id, state in cls._rotations.items()
                      if state.task and not state.task.done()]
        for sb_id in list(cls._rotations.keys()):
            await cls.stop_rotation(sb_id)
        # Restore enabled flag for rotations that were running at shutdown
        for sb_id in active_ids:
            await Settings.Set(f"scoreboards.rotation.{sb_id}.enabled", True)
        logger.info("[RotationManager] Stopped ({} rotations marked for resume)", len(active_ids))

    @classmethod
    async def get_config(cls, sb_id: int) -> dict:
        """Get rotation config for a scoreboard."""
        return Settings.Get(f"scoreboards.rotation.{sb_id}", {
            "enabled": False,
            "interval": 30,
            "game_ids": [],
            "current_index": 0,
            "poll_interval": 0,
            "source_pool": "both",
            "filters": {},
            # Snapshot of the completed-game dicts the user selected at Start.
            # This is the authoritative source of truth for what the rotation
            # rotates through — `filters` only seeds the auto-poll's
            # discovery of newly-matching games, not the base list. Persisting
            # the dicts means resume after a server restart works even if the
            # selection spans multiple search filter combinations (which is
            # the common case in the manual browser).
            "cached_games": [],
        })

    @classmethod
    async def set_config(cls, sb_id: int, config: dict):
        """Update rotation config. Merges with existing."""
        current = await cls.get_config(sb_id)
        current.update(config)
        await Settings.Set(f"scoreboards.rotation.{sb_id}", current)

        # Mirror only the fields the overlay needs into State. Filtering to
        # the touched keys keeps the broadcast small for partial updates
        # (e.g. interval-only edits don't re-send cached_games).
        mirror_keys = {"cached_games", "game_ids", "current_index", "enabled"}
        to_mirror = {k: current[k] for k in mirror_keys if k in config and k in current}
        if to_mirror:
            await _mirror_to_state(sb_id, **to_mirror)

        # If rotation is running, restart it with new config
        if sb_id in cls._rotations:
            await cls.stop_rotation(sb_id)
            if current.get("enabled", False) and current.get("game_ids"):
                await cls.start_rotation(sb_id)

    @classmethod
    async def start_rotation(cls, sb_id: int):
        """Start rotating games on a scoreboard."""
        if sb_id in cls._rotations:
            await cls.stop_rotation(sb_id)

        config = await cls.get_config(sb_id)
        game_ids = list(config.get("game_ids", []))
        interval = config.get("interval", 30)
        source_pool = config.get("source_pool", "both")
        poll_interval = config.get("poll_interval", 0)
        filters = config.get("filters", {}) or {}
        cached_games = config.get("cached_games", []) or []
        current_index = (config.get("current_index", 0) % len(game_ids)) if game_ids else 0

        # Hydrate the rotation's completed-game cache from the persisted
        # snapshot. This is the authoritative store the rotator reads from —
        # we never overwrite the user's game_ids with a filter refetch.
        completed_games = {
            g.get("game_id"): g for g in cached_games if g.get("game_id") is not None
        }

        state = RotationState(
            sb_id=sb_id,
            game_ids=game_ids,
            interval=interval,
            current_index=current_index,
            source_pool=source_pool,
            poll_interval=poll_interval,
            filters=filters,
        )
        state.completed_games = completed_games

        if not state.game_ids:
            logger.warning("[RotationManager] No games available for sb {}", sb_id)
            return

        state.task = asyncio.create_task(state.run())
        cls._rotations[sb_id] = state

        await Settings.Set(f"scoreboards.rotation.{sb_id}.enabled", True)
        # Push the live snapshot the overlay needs in one batch.
        await _mirror_to_state(
            sb_id,
            enabled=True,
            game_ids=state.game_ids,
            current_index=state.current_index,
            cached_games=cached_games,
        )
        await cls._emit_status(sb_id)

        # Stats are intentionally not collected for rotator scoreboards:
        # game-mode-wide character stats don't say much about a single
        # completed game, and the prefetch + per-tick push added cost without
        # value. Re-enable by restoring the _prefetch_rotation_stats task and
        # the push_api_stats_for_scoreboard call in RotationState._apply_current.
        logger.info("[RotationManager] Started rotation for scoreboard {} "
                     "({}s interval, {} games)", sb_id, interval, len(game_ids))

    @classmethod
    async def stop_rotation(cls, sb_id: int):
        """Stop rotation on a scoreboard."""
        state = cls._rotations.pop(sb_id, None)
        if state and state.task and not state.task.done():
            state.task.cancel()
            try:
                await state.task
            except asyncio.CancelledError:
                pass

        await Settings.Set(f"scoreboards.rotation.{sb_id}.enabled", False)
        await _mirror_to_state(sb_id, enabled=False)
        await cls._emit_status(sb_id)
        logger.info("[RotationManager] Stopped rotation for scoreboard {}", sb_id)

    @classmethod
    async def next_game(cls, sb_id: int):
        """Manually advance to the next game."""
        state = cls._rotations.get(sb_id)
        if state:
            await state.advance(1)
            await cls._emit_status(sb_id)

    @classmethod
    async def prev_game(cls, sb_id: int):
        """Manually go to the previous game."""
        state = cls._rotations.get(sb_id)
        if state:
            await state.advance(-1)
            await cls._emit_status(sb_id)

    @classmethod
    def get_status(cls, sb_id: int) -> dict:
        """Get current rotation status."""
        state = cls._rotations.get(sb_id)
        if not state:
            return {"active": False, "scoreboard": sb_id}
        # If the task crashed or finished, the rotation isn't actually running
        # even though it's still tracked in the dict. Report inactive.
        if state.task is None or state.task.done():
            return {"active": False, "scoreboard": sb_id}
        return {
            "active": True,
            "scoreboard": sb_id,
            "current_index": state.current_index,
            "current_game_id": state.game_ids[state.current_index] if state.game_ids else None,
            "total_games": len(state.game_ids),
            "interval": state.interval,
            "next_advance_at": state.next_advance_at,
        }

    @classmethod
    async def _emit_status(cls, sb_id: int):
        await socketio.emit("v1.rotation.status", cls.get_status(sb_id))


class RotationState:
    """State for a single scoreboard's rotation."""

    def __init__(self, sb_id: int, game_ids: list, interval: float,
                 current_index: int = 0, source_pool: str = "both",
                 poll_interval: float = 0, filters: dict | None = None):
        self.sb_id = sb_id
        self.game_ids = game_ids
        self.interval = interval
        self.current_index = current_index
        self.source_pool = source_pool
        self.poll_interval = poll_interval
        self.filters: dict = filters or {}
        # Per-rotation cache of completed games matching `filters`. Populated
        # by fetch_games(); used by _apply_current to look up the current
        # game without consulting the manual-browser singleton pool.
        self.completed_games: dict = {}
        self.task: asyncio.Task | None = None
        self._poll_task: asyncio.Task | None = None
        # Unix timestamp (seconds) when the next automatic advance is scheduled.
        # Updated after each successful apply so the UI can render a countdown.
        self.next_advance_at: float | None = None

    async def run(self):
        """Main rotation loop.

        Exceptions inside _apply_current / advance are logged and the loop
        continues to the next interval — a single bad game should never
        kill the whole rotation.
        """
        # Start poll task if configured
        if self.poll_interval > 0:
            self._poll_task = asyncio.create_task(self._poll_loop())

        try:
            # Apply the current game immediately
            try:
                await self._apply_current()
            except Exception:
                logger.exception(
                    "[RotationState] Initial apply failed for sb {} (game {})",
                    self.sb_id,
                    self.game_ids[self.current_index] if self.game_ids else None,
                )
            while True:
                await asyncio.sleep(self.interval)
                try:
                    await self.advance(1)
                except Exception:
                    logger.exception(
                        "[RotationState] advance failed for sb {} (index {} game {})",
                        self.sb_id,
                        self.current_index,
                        self.game_ids[self.current_index] if self.game_ids else None,
                    )
        except asyncio.CancelledError:
            if self._poll_task and not self._poll_task.done():
                self._poll_task.cancel()
            raise

    async def _poll_loop(self):
        """Periodically check for new games to add to rotation."""
        while True:
            try:
                await asyncio.sleep(self.poll_interval)
                await self._refresh_game_list()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[RotationState] Poll error for sb {}", self.sb_id)

    async def _refresh_game_list(self):
        """Poll-driven additive refresh.

        The rotation's authoritative game list (game_ids + completed_games
        cache) is set at Start time from what the user selected in the modal.
        This poll *augments* that: it refetches `filters` and adds any new
        matching games (and ongoing-pool ids if source_pool includes ongoing).
        It never removes the user's existing selections. With poll_interval=0
        this loop never runs.
        """
        try:
            additions: list[int] = []

            # Completed: refetch filters, add any new ids to cache + game_ids
            if self.source_pool in ("completed", "both") and self.filters:
                df = await stats_api.fetch_completed_games(**(self.filters or {}))
                if not df.empty:
                    for _, row in df.iterrows():
                        game = _sanitize_row(row.to_dict())
                        gid = game.get("game_id")
                        if gid is None or gid in self.completed_games:
                            continue
                        game["source_type"] = "rotator"
                        game["game_completed"] = True
                        self.completed_games[gid] = game
                        additions.append(gid)

            # Ongoing pool is shared and live; pick up any new ids
            if self.source_pool in ("ongoing", "both"):
                for g in OngoingGamePool.list_games():
                    gid = g.get("game_id")
                    if gid and gid not in self.game_ids and gid not in additions:
                        additions.append(gid)

            if additions:
                self.game_ids = [*self.game_ids, *additions]
                cached = list(self.completed_games.values())
                await Settings.Set(
                    f"scoreboards.rotation.{self.sb_id}.game_ids", self.game_ids,
                )
                # Persist the augmented completed-games cache so resume sees
                # the additions too.
                await Settings.Set(
                    f"scoreboards.rotation.{self.sb_id}.cached_games", cached,
                )
                await _mirror_to_state(
                    self.sb_id,
                    game_ids=self.game_ids,
                    cached_games=cached,
                )
        except Exception:
            logger.exception("[RotationState] _refresh_game_list failed for sb {}", self.sb_id)

    async def advance(self, direction: int = 1):
        """Move to next/previous game in rotation."""
        if not self.game_ids:
            return
        self.current_index = (self.current_index + direction) % len(self.game_ids)
        await Settings.Set(f"scoreboards.rotation.{self.sb_id}.current_index",
                           self.current_index)
        await _mirror_to_state(self.sb_id, current_index=self.current_index)
        await self._apply_current()

    async def _apply_current(self):
        """Apply the current game to the scoreboard and push stats."""
        if not self.game_ids:
            return

        # Self-cancel if the scoreboard's source is no longer "rotator".
        # Catches lingering tasks left over from earlier code paths that
        # didn't stop the rotation on source change. Without this, an
        # orphaned task keeps writing into a scoreboard the user has
        # reassigned (e.g. flipping a live_game scoreboard between two of
        # the rotator's old games).
        current_type = Settings.Get(f"scoreboards.sources.{self.sb_id}.type")
        if current_type != "rotator":
            logger.warning(
                "[RotationState] sb {} source is {!r}, not 'rotator'; "
                "self-cancelling lingering rotation task",
                self.sb_id, current_type,
            )
            await Settings.Set(f"scoreboards.rotation.{self.sb_id}.enabled", False)
            await _mirror_to_state(self.sb_id, enabled=False)
            # Schedule cleanup outside this task — stop_rotation cancels
            # self.task, so calling it inline would cancel us mid-await.
            asyncio.create_task(RotationManager.stop_rotation(self.sb_id))
            return

        game_id = self.game_ids[self.current_index]

        # Ongoing pool is shared (no filters); completed lookup uses this
        # rotation's own cache so two rotations on different filters can
        # legitimately resolve different game_ids.
        if OngoingGamePool.get_game(game_id):
            await OngoingGamePool.apply_game_to_scoreboard(game_id, self.sb_id)
        elif game_id in self.completed_games:
            await apply_completed_game_dict(self.completed_games[game_id], self.sb_id)
        else:
            logger.warning("[RotationState] Game {} not found in rotation's cache or ongoing pool", game_id)
            await RotationManager._emit_status(self.sb_id)
            return

        # Stats deliberately not pushed — see RotationManager.start_rotation.

        # Schedule the next advance so the UI can show an accurate countdown.
        self.next_advance_at = time.time() + self.interval
        await RotationManager._emit_status(self.sb_id)

import asyncio

from loguru import logger
from server import socketio
from server.settings import Settings


class RotationManager:
    """Manages game rotation for scoreboards.

    Each scoreboard can have an independent rotation that cycles through
    a list of game_ids at a configurable interval. Supports both ongoing
    and completed API games.
    """

    # {scoreboard_number: RotationState}
    _rotations: dict[int, "RotationState"] = {}

    @classmethod
    async def Start(cls):
        """Initialize rotation manager. Rotations do not auto-resume across restarts."""
        # Clear any stale enabled flags from previous session
        rotation_settings = await Settings.Get("scoreboards.rotation", {})
        for sb_id_str, config in rotation_settings.items():
            if config.get("enabled", False):
                config["enabled"] = False
                await Settings.Set(f"scoreboards.rotation.{sb_id_str}", config)
        logger.info("[RotationManager] Initialized (rotations cleared from previous session)")

    @classmethod
    async def Stop(cls):
        """Stop all active rotations."""
        for sb_id in list(cls._rotations.keys()):
            await cls.stop_rotation(sb_id)
        logger.info("[RotationManager] Stopped")

    @classmethod
    async def get_config(cls, sb_id: int) -> dict:
        """Get rotation config for a scoreboard."""
        return await Settings.Get(f"scoreboards.rotation.{sb_id}", {
            "enabled": False,
            "interval": 30,
            "game_ids": [],
            "current_index": 0,
            "poll_interval": 0,
            "source_pool": "both",
        })

    @classmethod
    async def set_config(cls, sb_id: int, config: dict):
        """Update rotation config. Merges with existing."""
        current = await cls.get_config(sb_id)
        current.update(config)
        await Settings.Set(f"scoreboards.rotation.{sb_id}", current)

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
        game_ids = config.get("game_ids", [])
        if not game_ids:
            return

        interval = config.get("interval", 30)
        current_index = config.get("current_index", 0) % len(game_ids)
        source_pool = config.get("source_pool", "both")
        poll_interval = config.get("poll_interval", 0)

        state = RotationState(
            sb_id=sb_id,
            game_ids=game_ids,
            interval=interval,
            current_index=current_index,
            source_pool=source_pool,
            poll_interval=poll_interval,
        )
        state.task = asyncio.create_task(state.run())
        cls._rotations[sb_id] = state

        await Settings.Set(f"scoreboards.rotation.{sb_id}.enabled", True)
        await cls._emit_status(sb_id)
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
        return {
            "active": True,
            "scoreboard": sb_id,
            "current_index": state.current_index,
            "current_game_id": state.game_ids[state.current_index] if state.game_ids else None,
            "total_games": len(state.game_ids),
            "interval": state.interval,
        }

    @classmethod
    async def _emit_status(cls, sb_id: int):
        await socketio.emit("v1.rotation.status", cls.get_status(sb_id))


class RotationState:
    """State for a single scoreboard's rotation."""

    def __init__(self, sb_id: int, game_ids: list, interval: float,
                 current_index: int = 0, source_pool: str = "both",
                 poll_interval: float = 0):
        self.sb_id = sb_id
        self.game_ids = game_ids
        self.interval = interval
        self.current_index = current_index
        self.source_pool = source_pool
        self.poll_interval = poll_interval
        self.task: asyncio.Task | None = None
        self._poll_task: asyncio.Task | None = None

    async def run(self):
        """Main rotation loop."""
        # Start poll task if configured
        if self.poll_interval > 0:
            self._poll_task = asyncio.create_task(self._poll_loop())

        try:
            # Apply the current game immediately
            await self._apply_current()
            while True:
                await asyncio.sleep(self.interval)
                await self.advance(1)
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
        """Refresh game list from the pools based on source_pool setting."""
        from server.rio.game_pool import OngoingGamePool, CompletedGamePool

        new_ids = []
        if self.source_pool in ("ongoing", "both"):
            new_ids.extend(g.get("game_id") for g in OngoingGamePool.list_games()
                           if g.get("game_id"))
        if self.source_pool in ("completed", "both"):
            new_ids.extend(g.get("game_id") for g in CompletedGamePool.list_games()
                           if g.get("game_id"))

        if new_ids and new_ids != self.game_ids:
            self.game_ids = new_ids
            self.current_index = self.current_index % len(self.game_ids)
            await Settings.Set(f"scoreboards.rotation.{self.sb_id}.game_ids", self.game_ids)

    async def advance(self, direction: int = 1):
        """Move to next/previous game in rotation."""
        if not self.game_ids:
            return
        self.current_index = (self.current_index + direction) % len(self.game_ids)
        await Settings.Set(f"scoreboards.rotation.{self.sb_id}.current_index",
                           self.current_index)
        await self._apply_current()

    async def _apply_current(self):
        """Apply the current game to the scoreboard."""
        if not self.game_ids:
            return

        from server.rio.game_pool import OngoingGamePool, CompletedGamePool

        game_id = self.game_ids[self.current_index]

        # Try ongoing first, then completed
        if OngoingGamePool.get_game(game_id):
            await OngoingGamePool.apply_game_to_scoreboard(game_id, self.sb_id)
        elif CompletedGamePool.get_game(game_id):
            await CompletedGamePool.apply_game_to_scoreboard(game_id, self.sb_id)
        else:
            logger.warning("[RotationState] Game {} not found in any pool", game_id)

        await RotationManager._emit_status(self.sb_id)

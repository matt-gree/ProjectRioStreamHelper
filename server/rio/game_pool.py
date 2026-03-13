import asyncio

from loguru import logger
from server import socketio
from server.rio.provider import apply_parsed_game_to_state
from server.settings import Settings
from server.state import State


class RioGamePool:
    """Shared pool of ongoing Project Rio games fetched from the API.

    One singleton polls the API periodically. Individual scoreboards
    select games from this pool by game_id rather than making their
    own API calls.

    Stubbed until pyrio.api is available.
    """

    games: dict = {}  # game_id -> parsed game dict
    _poll_task: asyncio.Task | None = None
    _poll_interval: float = 10.0

    @classmethod
    async def Start(cls, poll_interval: float = 10.0):
        cls._poll_interval = poll_interval
        cls._poll_task = asyncio.create_task(cls._poll_loop())
        logger.info("[RioGamePool] Started polling (interval={}s)", poll_interval)

    @classmethod
    async def Stop(cls):
        if cls._poll_task and not cls._poll_task.done():
            cls._poll_task.cancel()
            try:
                await cls._poll_task
            except asyncio.CancelledError:
                pass
        logger.info("[RioGamePool] Stopped")

    @classmethod
    async def _poll_loop(cls):
        while True:
            try:
                await cls._fetch_games()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[RioGamePool] Poll error")
            await asyncio.sleep(cls._poll_interval)

    @classmethod
    async def _fetch_games(cls):
        """Fetch ongoing games from Project Rio API.

        TODO: Replace with actual pyrio.api call when available:
            from server.rio.pyrio.api import fetch_ongoing_games
            raw_games = await fetch_ongoing_games()
            new_games = {}
            for g in raw_games:
                parsed = RioGameDataProvider.parse_game_data(g)
                new_games[g["game_id"]] = parsed
            cls.games = new_games
            await socketio.emit('v1.game_pool.update', cls.list_games())
        """
        pass

    @classmethod
    def get_game(cls, game_id: str) -> dict | None:
        return cls.games.get(game_id)

    @classmethod
    def list_games(cls) -> list:
        return list(cls.games.values())

    @classmethod
    async def apply_game_to_scoreboard(cls, game_id: str, scoreboard_number: int) -> bool:
        """Apply a specific API game's data to a scoreboard's state."""
        game = cls.get_game(game_id)
        if not game:
            return False

        await apply_parsed_game_to_state(game, scoreboard_number)

        # Update the scoreboard's source config
        await Settings.Set(f"scoreboards.sources.{scoreboard_number}",
                           {"type": "api", "api_game_id": game_id})
        return True

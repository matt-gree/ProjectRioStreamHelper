import asyncio
import time

from loguru import logger
from server import socketio
from server.bindings import get_binding, is_rotating
from server.rio.game_pool import (
    OngoingGamePool,
    apply_completed_game_dict,
)
from server.rio import stats_api
from server.rio.game_pool import _sanitize_row
from server.settings import Settings
from server.state import State


async def _mirror_to_state(sb_id: int, **fields):
    """Mirror pool/playback fields into State so overlays can subscribe to
    `scoreboards.rotation.{sb_id}.*` like any other state-backed data — this
    is the contract `public/layout/rotator/ticker.html` reads
    (`cached_games`, `game_ids`), so the key names/shapes here are load-bearing,
    not just internal UI plumbing.

    Settings remains the persistence layer (used by resume-on-startup for
    `pool`/`playback` config); State is a live broadcast view for overlays +
    the React store. Pass only the fields that actually changed.
    """
    if not fields:
        return
    entries = [
        (f"scoreboards.rotation.{sb_id}.{k}", v) for k, v in fields.items()
    ]
    await State.SetBatch(entries)
    await State.Save()


def _chip_kwargs(chip: dict) -> dict:
    """A filter chip's non-empty fields, shaped for stats_api.fetch_completed_games."""
    return {k: v for k, v in {
        "tag": chip.get("tag") or None,
        "username": chip.get("username") or None,
        "vs_username": chip.get("vs_username") or None,
        "limit_games": chip.get("limit_games"),
    }.items() if v}


def _game_display_fields(game: dict) -> tuple[str, str]:
    """(away, home) usernames from either a live or completed game dict —
    the two shapes use different field names."""
    away = game.get("away_user") or game.get("away_player") or ""
    home = game.get("home_user") or game.get("home_player") or ""
    return away, home


def _chip_matches(game: dict, chip: dict) -> bool:
    """Whether a single game dict matches one filter chip (tags AND
    username/vs_username, all optional — an empty chip matches nothing so an
    accidental blank chip can't silently pull in every game)."""
    tags = chip.get("tag") or []
    usernames = chip.get("username") or []
    vs_usernames = chip.get("vs_username") or []
    if not tags and not usernames and not vs_usernames:
        return False

    if tags:
        mode = game.get("game_mode_name") or game.get("game_mode") or game.get("tags") or ""
        game_tags = mode if isinstance(mode, list) else [mode]
        if not any(t in game_tags for t in tags):
            return False

    away, home = _game_display_fields(game)
    if usernames and not (away in usernames or home in usernames):
        return False
    if vs_usernames and not (away in vs_usernames or home in vs_usernames):
        return False
    return True


class PoolManager:
    """Manages the continuously-evaluated game pool + rotate playback for
    scoreboards bound with `playback.mode == "rotate"`.

    Renamed from RotationManager as part of the pool+playback unification
    (see ~/.claude/plans/pool-playback-unification.md) — a running "rotation"
    is now a `PoolState` driven by `scoreboards.binding.{N}.pool`/`.playback`
    instead of the old flat `scoreboards.rotation.{N}` config.
    """

    # {scoreboard_number: PoolState}
    _rotations: dict[int, "PoolState"] = {}
    _resume_task: asyncio.Task | None = None

    @classmethod
    async def Start(cls):
        """Initialize the pool manager. Auto-resumes boards that were rotating
        at shutdown."""
        active = set(Settings.Get("scoreboards.active", [1]))
        bindings = Settings.Get("scoreboards.binding", {}) or {}

        # Resume any board that was rotating at shutdown, as long as it still
        # exists, is still bound to rotate, isn't HUD transport (board 1 with
        # HUD on is always HUD regardless of a stray stored playback.mode —
        # a resumed rotation must never fight the HUD writer for score.1.*),
        # and has a non-empty pool config (at least one filter or a pinned
        # game — an empty pool would just spin doing nothing).
        from server.bindings import transport
        to_resume = []
        for sb_id_str in bindings:
            try:
                sb_id = int(sb_id_str)
            except (TypeError, ValueError):
                continue
            if sb_id not in active or transport(sb_id) == "hud" or not is_rotating(sb_id):
                continue
            binding = get_binding(sb_id)
            # Only resume boards that were actively cycling at shutdown — a
            # user Stop clears `running` while leaving the board in rotate mode.
            if not binding["playback"].get("running"):
                continue
            pool_cfg = binding["pool"]
            if pool_cfg.get("filters") or pool_cfg.get("pinned"):
                to_resume.append(sb_id)

        if not to_resume:
            logger.info("[PoolManager] Initialized (no rotations to resume)")
            return

        cls._resume_task = asyncio.create_task(cls._resume_rotations(to_resume))
        logger.info("[PoolManager] Initialized (resuming {} rotation(s) in background)", len(to_resume))

    @classmethod
    async def _resume_rotations(cls, sb_ids: list[int]):
        resumed = []
        for sb_id in sb_ids:
            try:
                await cls.start_rotation(sb_id)
                resumed.append(sb_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[PoolManager] Failed to resume rotation for scoreboard {}", sb_id)

        if resumed:
            logger.info("[PoolManager] Resumed rotations for scoreboards: {}", resumed)
        else:
            logger.info("[PoolManager] All resume attempts failed")

    @classmethod
    async def Stop(cls):
        """Stop all active rotations. Playback config (mode=rotate) survives
        in Settings regardless, so Start()'s resume check picks them back up —
        there's no separate "enabled" flag to restore."""
        if cls._resume_task and not cls._resume_task.done():
            cls._resume_task.cancel()
            try:
                await cls._resume_task
            except asyncio.CancelledError:
                pass
            cls._resume_task = None

        count = len(cls._rotations)
        for sb_id in list(cls._rotations.keys()):
            await cls.stop_rotation(sb_id, user_stop=False)
        logger.info("[PoolManager] Stopped ({} rotation(s))", count)

    @classmethod
    async def get_config(cls, sb_id: int) -> dict:
        """Pool + playback config for a scoreboard (defaults-filled)."""
        return get_binding(sb_id)

    @classmethod
    async def set_pool(cls, sb_id: int, updates: dict):
        """Merge `updates` into the scoreboard's pool config and, if a
        rotation is currently running, trigger an immediate recompute rather
        than waiting for the next scheduled tick."""
        current = get_binding(sb_id)["pool"]
        merged = {**current, **updates}
        await Settings.Set(f"scoreboards.binding.{sb_id}.pool", merged)
        state = cls._rotations.get(sb_id)
        if state:
            state.pool_cfg = merged
            await state.refresh_now()

    @classmethod
    async def set_playback(cls, sb_id: int, updates: dict):
        """Merge `updates` into the scoreboard's playback config."""
        current = get_binding(sb_id)["playback"]
        merged = {**current, **updates}
        await Settings.Set(f"scoreboards.binding.{sb_id}.playback", merged)
        state = cls._rotations.get(sb_id)
        if state and "interval" in updates:
            state.interval = merged["interval"]

    @classmethod
    async def pin_game(cls, sb_id: int, game_id, game: dict | None = None):
        """Add a game to the pool's pinned list (always-included regardless
        of filter). `game` is the full dict from the frontend's search result
        — needed to resolve a *completed* game's display fields later, since
        there's no fetch-by-id endpoint for completed games (only filtered
        search); live games resolve fresh from OngoingGamePool every tick so
        don't need caching."""
        pool_cfg = get_binding(sb_id)["pool"]
        pinned = list(pool_cfg.get("pinned") or [])
        if game_id not in pinned:
            pinned.append(game_id)
        updates = {"pinned": pinned}
        if game and not OngoingGamePool.get_game(game_id):
            cache = dict(pool_cfg.get("pinned_cache") or {})
            cache[str(game_id)] = game
            updates["pinned_cache"] = cache
        await cls.set_pool(sb_id, updates)

    @classmethod
    async def unpin_game(cls, sb_id: int, game_id):
        pool_cfg = get_binding(sb_id)["pool"]
        pinned = [g for g in (pool_cfg.get("pinned") or []) if g != game_id]
        cache = dict(pool_cfg.get("pinned_cache") or {})
        cache.pop(str(game_id), None)
        await cls.set_pool(sb_id, {"pinned": pinned, "pinned_cache": cache})

    @classmethod
    async def exclude_game(cls, sb_id: int, game_id):
        pool_cfg = get_binding(sb_id)["pool"]
        excluded = list(pool_cfg.get("excluded") or [])
        if game_id not in excluded:
            excluded.append(game_id)
        await cls.set_pool(sb_id, {"excluded": excluded})

    @classmethod
    async def unexclude_game(cls, sb_id: int, game_id):
        pool_cfg = get_binding(sb_id)["pool"]
        excluded = [g for g in (pool_cfg.get("excluded") or []) if g != game_id]
        await cls.set_pool(sb_id, {"excluded": excluded})

    @classmethod
    async def start_rotation(cls, sb_id: int):
        """Start rotating a scoreboard's pool. Puts the binding into
        playback.mode="rotate" if it wasn't already."""
        if sb_id in cls._rotations:
            await cls.stop_rotation(sb_id, user_stop=False)

        binding = get_binding(sb_id)
        if binding["playback"].get("mode") != "rotate":
            await Settings.Set(f"scoreboards.binding.{sb_id}.playback.mode", "rotate")
            binding["playback"]["mode"] = "rotate"
        # Mark actively-cycling so a restart resumes it; a user Stop clears this.
        await Settings.Set(f"scoreboards.binding.{sb_id}.playback.running", True)

        state = PoolState(
            sb_id=sb_id,
            pool_cfg=binding["pool"],
            interval=binding["playback"].get("interval", 30),
        )
        cls._rotations[sb_id] = state

        # Initial recompute before starting the background loop so status/
        # first-apply doesn't race an empty member set.
        await state.refresh_now()
        if not state.game_ids:
            logger.warning("[PoolManager] No games in pool for sb {} at start", sb_id)

        state.task = asyncio.create_task(state.run())
        await cls._emit_status(sb_id)
        logger.info(
            "[PoolManager] Started rotation for scoreboard {} ({}s interval, {} games)",
            sb_id, state.interval, len(state.game_ids),
        )

    @classmethod
    async def stop_rotation(cls, sb_id: int, user_stop: bool = True):
        """Stop the running rotation on a scoreboard.

        `user_stop=True` (an explicit Stop press or a switch to single mode)
        clears the persisted `running` flag so it won't resume on startup —
        but leaves `playback.mode` as "rotate" so the UI stays on the Rotator
        tab. Pass `user_stop=False` when merely pausing for shutdown or
        orphan-cleanup, so resume-on-startup still picks it back up.
        """
        state = cls._rotations.pop(sb_id, None)
        if state:
            if state.task and not state.task.done():
                state.task.cancel()
                try:
                    await state.task
                except asyncio.CancelledError:
                    pass
            if state.refresh_task and not state.refresh_task.done():
                state.refresh_task.cancel()
                try:
                    await state.refresh_task
                except asyncio.CancelledError:
                    pass

        if user_stop:
            await Settings.Set(f"scoreboards.binding.{sb_id}.playback.running", False)
        await _mirror_to_state(sb_id, game_ids=[], cached_games=[])
        await cls._emit_status(sb_id)
        logger.info("[PoolManager] Stopped rotation for scoreboard {}", sb_id)

    @classmethod
    async def preview_pool(cls, sb_id: int) -> dict:
        """Recompute pool membership from the current config and mirror it into
        State *without* starting the cycle — so the UI can show how many games
        the filter matches (and let the user exclude some) before pressing
        Start. If a rotation is already running, this just forces its refresh."""
        state = cls._rotations.get(sb_id)
        if state:
            await state.refresh_now()
            return cls.get_status(sb_id)

        binding = get_binding(sb_id)
        tmp = PoolState(
            sb_id=sb_id,
            pool_cfg=binding["pool"],
            interval=binding["playback"].get("interval", 30),
        )
        members = await tmp._compute_members()
        ids = list(members.keys())
        await _mirror_to_state(
            sb_id,
            game_ids=ids,
            cached_games=[members[gid] for gid in ids],
        )
        return {"active": False, "scoreboard": sb_id, "total_games": len(ids)}

    @classmethod
    async def next_game(cls, sb_id: int):
        state = cls._rotations.get(sb_id)
        if state:
            await state.advance(1)
            await cls._emit_status(sb_id)

    @classmethod
    async def prev_game(cls, sb_id: int):
        state = cls._rotations.get(sb_id)
        if state:
            await state.advance(-1)
            await cls._emit_status(sb_id)

    @classmethod
    def get_status(cls, sb_id: int) -> dict:
        state = cls._rotations.get(sb_id)
        if not state:
            return {"active": False, "scoreboard": sb_id}
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


class PoolState:
    """Runtime state for one scoreboard's continuously-evaluated pool +
    rotate playback.

    Renamed from RotationState. The pool's membership (`game_ids`/`members`)
    is *derived* from `pool_cfg` (filters/scope/pinned/excluded) — recomputed
    on start and on every refresh tick — rather than being the persisted
    source of truth the way the old model's hand-curated `game_ids` was.
    Only `pool_cfg`/`playback.interval`/`playback.current_index` are
    persisted; the resolved member list is runtime-only and gets rebuilt on
    resume, same as any other derived cache.
    """

    def __init__(self, sb_id: int, pool_cfg: dict, interval: float):
        self.sb_id = sb_id
        self.pool_cfg = pool_cfg
        self.interval = interval
        self.game_ids: list = []
        self.members: dict = {}
        self.current_index = 0
        self.task: asyncio.Task | None = None
        self.refresh_task: asyncio.Task | None = None
        # Unix timestamp (seconds) when the next automatic advance is scheduled.
        self.next_advance_at: float | None = None

    async def run(self):
        """Main loop: apply the current game immediately, then advance on
        `interval`. A parallel `_refresh_loop` recomputes pool membership on
        its own (usually slower) cadence — see `refresh_now`/`_refresh_loop`.
        """
        refresh_interval = self.pool_cfg.get("refresh_interval", 0) or 0
        if refresh_interval > 0:
            self.refresh_task = asyncio.create_task(self._refresh_loop(refresh_interval))

        try:
            try:
                await self._apply_current()
            except Exception:
                logger.exception(
                    "[PoolState] Initial apply failed for sb {} (game {})",
                    self.sb_id, self.game_ids[self.current_index] if self.game_ids else None,
                )
            while True:
                await asyncio.sleep(self.interval)
                try:
                    await self.advance(1)
                except Exception:
                    logger.exception(
                        "[PoolState] advance failed for sb {} (index {})",
                        self.sb_id, self.current_index,
                    )
        except asyncio.CancelledError:
            if self.refresh_task and not self.refresh_task.done():
                self.refresh_task.cancel()
            raise

    async def _refresh_loop(self, refresh_interval: float):
        while True:
            try:
                await asyncio.sleep(refresh_interval)
                await self.refresh_now()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[PoolState] Refresh error for sb {}", self.sb_id)

    async def _compute_members(self) -> dict:
        """pinned ∪ scope-filtered matches − excluded, resolved to game dicts.

        Live matches are filtered from the already-live `OngoingGamePool`
        (no extra API calls). Completed matches are fetched per filter chip
        via the Project Rio API — this is the only network-bound part of a
        recompute, gated by the caller on `refresh_interval`.
        """
        scope = self.pool_cfg.get("scope", "both")
        excluded = set(self.pool_cfg.get("excluded") or [])
        filters = self.pool_cfg.get("filters") or []
        result: dict = {}

        for gid in self.pool_cfg.get("pinned") or []:
            if gid in excluded:
                continue
            game = OngoingGamePool.get_game(gid)
            if not game:
                cache = self.pool_cfg.get("pinned_cache") or {}
                game = cache.get(gid) or cache.get(str(gid))
            if game:
                result[gid] = game

        if scope in ("live", "both") and filters:
            for game in OngoingGamePool.list_games():
                gid = game.get("game_id")
                if gid is None or gid in excluded or gid in result:
                    continue
                if any(_chip_matches(game, chip) for chip in filters):
                    result[gid] = game

        if scope in ("completed", "both") and filters:
            for chip in filters:
                kwargs = _chip_kwargs(chip)
                if not kwargs:
                    continue
                try:
                    df = await stats_api.fetch_completed_games(**kwargs)
                except Exception:
                    logger.exception(
                        "[PoolState] completed fetch failed for sb {} chip {}",
                        self.sb_id, chip.get("id"),
                    )
                    continue
                if df.empty:
                    continue
                for _, row in df.iterrows():
                    game = _sanitize_row(row.to_dict())
                    gid = game.get("game_id")
                    if gid is None or gid in excluded or gid in result:
                        continue
                    game["source_type"] = "pool"
                    game["game_completed"] = True
                    result[gid] = game

        return result

    async def refresh_now(self):
        """Recompute pool membership and apply add/remove — the core of the
        continuously-evaluated pool model (replaces the old additive-only
        `_refresh_game_list`).

        Scope-exit rule: if the *currently-displayed* game fell out of scope,
        it is kept for this recompute (finishes its turn) and only dropped on
        the recompute after `advance()` has moved off it — never yanked
        mid-display.
        """
        new_members = await self._compute_members()

        current_id = self.game_ids[self.current_index] if self.game_ids else None
        if current_id is not None and current_id not in new_members and current_id in self.members:
            new_members[current_id] = self.members[current_id]

        old_ids = set(self.game_ids)
        new_ids = set(new_members.keys())
        added = new_ids - old_ids
        removed = old_ids - new_ids

        # Preserve existing order for retained ids; append newly-added ones.
        self.game_ids = [gid for gid in self.game_ids if gid in new_ids] + \
                         [gid for gid in new_members if gid not in old_ids]
        self.members = new_members

        if current_id is not None and current_id in self.game_ids:
            self.current_index = self.game_ids.index(current_id)
        elif self.game_ids:
            self.current_index = self.current_index % len(self.game_ids)
        else:
            self.current_index = 0

        if added or removed or not old_ids:
            await Settings.Set(
                f"scoreboards.binding.{self.sb_id}.playback.current_index", self.current_index,
            )
            await _mirror_to_state(
                self.sb_id,
                game_ids=self.game_ids,
                cached_games=[self.members[gid] for gid in self.game_ids],
                current_index=self.current_index,
            )
            await PoolManager._emit_status(self.sb_id)

        # If nothing is currently applied (fresh start) or the applied game
        # just changed identity via reordering, re-apply.
        if current_id is None and self.game_ids:
            await self._apply_current()

    async def advance(self, direction: int = 1):
        """Move to next/previous game in the pool."""
        if not self.game_ids:
            return
        self.current_index = (self.current_index + direction) % len(self.game_ids)
        await Settings.Set(
            f"scoreboards.binding.{self.sb_id}.playback.current_index", self.current_index,
        )
        await _mirror_to_state(self.sb_id, current_index=self.current_index)
        await self._apply_current()

    async def _apply_current(self):
        """Apply the current game to the scoreboard."""
        if not self.game_ids:
            return

        # Self-cancel if this scoreboard's binding has been switched away from
        # rotate out of band — without this an orphaned task keeps writing
        # into a scoreboard the user has reassigned.
        if not is_rotating(self.sb_id):
            logger.warning(
                "[PoolState] sb {} no longer rotating; self-cancelling lingering task",
                self.sb_id,
            )
            asyncio.create_task(PoolManager.stop_rotation(self.sb_id, user_stop=False))
            return

        game_id = self.game_ids[self.current_index]

        if OngoingGamePool.get_game(game_id):
            await OngoingGamePool.apply_game_to_scoreboard(game_id, self.sb_id)
        elif game_id in self.members:
            await apply_completed_game_dict(self.members[game_id], self.sb_id)
        else:
            logger.warning("[PoolState] Game {} not found in pool members or ongoing pool", game_id)
            await PoolManager._emit_status(self.sb_id)
            return

        self.next_advance_at = time.time() + self.interval
        await PoolManager._emit_status(self.sb_id)

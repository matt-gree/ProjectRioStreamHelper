import platform
from pathlib import Path

from loguru import logger
from server.rio.pyrio.lookup import lookup
from server.rio.pyrio.team_name_algo import team_name

from server.rio.hud_watcher import HudWatcher
from server.rio.stats_tracker import StatsTracker
from server.settings import Settings
from server.state import State


def get_default_hud_file_path() -> Path:
    """Returns the OS-specific path to Project Rio's decoded.hud.json file."""
    system = platform.system()

    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Project Rio" / "HudFiles" / "decoded.hud.json"
    elif system == "Windows":
        return Path.home() / "Documents" / "Project Rio" / "HudFiles" / "decoded.hud.json"
    else:
        return Path("/invalid/path")


async def get_user_hud_path() -> Path | None:
    """Get user-configured HUD path from settings, falling back to OS default."""
    user_path = await Settings.Get("project_rio.hud_path", "")
    if user_path:
        path = Path(user_path)
        if path.exists() and path.is_file() and path.suffix == ".json":
            return path

    default = get_default_hud_file_path()
    if default.exists():
        return default

    return None


async def apply_parsed_game_to_state(parsed: dict, scoreboard_number: int):
    """Write parsed game data into State under score.{scoreboard_number}.

    Shared by RioGameDataProvider (HUD) and RioGamePool (API).
    """
    sb = f"score.{scoreboard_number}"

    await State.Set(f"{sb}.score_left", parsed.get("team1score", 0))
    await State.Set(f"{sb}.score_right", parsed.get("team2score", 0))
    await State.Set(f"{sb}.inning", parsed.get("inning", 1))
    await State.Set(f"{sb}.half_inning", parsed.get("half_inning", "Top"))
    await State.Set(f"{sb}.outs", parsed.get("outs", 0))
    await State.Set(f"{sb}.strikes", parsed.get("strikes", 0))
    await State.Set(f"{sb}.balls", parsed.get("balls", 0))
    await State.Set(f"{sb}.batter", parsed.get("batter", ""))
    await State.Set(f"{sb}.pitcher", parsed.get("pitcher", ""))
    await State.Set(f"{sb}.cbRioRunnerOn1", parsed.get("runnerOn1", False))
    await State.Set(f"{sb}.cbRioRunnerOn2", parsed.get("runnerOn2", False))
    await State.Set(f"{sb}.cbRioRunnerOn3", parsed.get("runnerOn3", False))

    entrants = parsed.get("entrants", [[{}], [{}]])
    for team_idx in range(2):
        team_num = team_idx + 1
        player = entrants[team_idx][0] if entrants[team_idx] else {}
        prefix = f"{sb}.team.{team_num}.player.1"

        await State.Set(f"{prefix}.rioName", player.get("rioName", ""))
        await State.Set(f"{prefix}.msb_team", player.get("msb_team", ""))
        await State.Set(f"{prefix}.rio_captainIndex", player.get("captainIndex", 0))

        roster = player.get("roster", [])
        for char_idx, char_name in enumerate(roster):
            await State.Set(f"{prefix}.character.{char_idx}.name", char_name)

    await State.Save()


class RioGameDataProvider:
    """Async singleton that watches the Project Rio HUD file and pushes
    game state updates to the central State store.

    Ported from the Qt-based RioGameDataProvider with the same 3-layer
    player side preservation logic (pin, back-to-back, manual swap).
    """

    # Singleton state
    hud_watcher: HudWatcher | None = None
    current_game: dict | None = None

    # Player side preservation state
    _prev_player_sides: dict = {}
    _prev_inning: int | None = None
    _sides_swapped: bool = False
    _user_overridden: bool = False

    @classmethod
    async def Start(cls):
        """Resolve HUD path and start the file watcher."""
        hud_path = await get_user_hud_path()
        if not hud_path:
            logger.warning(f"[RioGameDataProvider] HUD file not found. "
                           f"Set project_rio.hud_path in settings or place file at {get_default_hud_file_path()}")
            return

        cls.hud_watcher = HudWatcher(hud_path, on_update=cls._on_hud_game_update)
        cls.hud_watcher.start()

        # Do an initial read
        game = await cls.hud_watcher.reload()
        if game:
            await cls._on_hud_game_update(game)

    @classmethod
    async def Stop(cls):
        """Stop the file watcher."""
        if cls.hud_watcher:
            await cls.hud_watcher.stop()
            cls.hud_watcher = None

    @classmethod
    async def ReloadHudPath(cls):
        """Re-read the HUD path from settings and restart the watcher if changed."""
        new_path = await get_user_hud_path()
        if not new_path:
            logger.warning("[RioGameDataProvider] No valid HUD path found")
            return

        if cls.hud_watcher:
            if cls.hud_watcher.hud_file == new_path:
                return
            await cls.Stop()

        cls.hud_watcher = HudWatcher(new_path, on_update=cls._on_hud_game_update)
        cls.hud_watcher.start()
        game = await cls.hud_watcher.reload()
        if game:
            await cls._on_hud_game_update(game)

    @classmethod
    async def FetchHUDGame(cls) -> dict | None:
        """Immediate one-shot read of the HUD file. Updates state and returns parsed game."""
        await cls.ReloadHudPath()
        if cls.hud_watcher and cls.hud_watcher.latest_game_data:
            game_json = cls.hud_watcher.latest_game_data
            StatsTracker.on_hud_update(game_json)
            parsed = cls.parse_game_data(game_json)
            parsed = cls._preserve_player_sides(parsed)
            cls.current_game = parsed
            await cls._apply_game_to_state(parsed)

            target = await Settings.Get("scoreboards.hud_target", 1)
            await StatsTracker.push_stats_to_state(target, cls._sides_swapped)
            return parsed
        return None

    @classmethod
    def parse_game_data(cls, game_json: dict) -> dict:
        """Convert a Project Rio game JSON into a TSH-compatible data format.

        Ported directly from the old RioGameDataProvider.parse_game_data().
        """
        data = {"entrants": [[{}], [{}]]}

        try:
            data["team1score"] = game_json["away_score"]
            data["team2score"] = game_json["home_score"]

            for i in range(2):
                team = "home" if i == 1 else "away"
                roster = [
                    game_json[f"{team}_roster_{j}_char"]
                    for j in range(9)
                ]
                data["entrants"][i][0]["roster"] = roster
                data["entrants"][i][0]["captainIndex"] = game_json[f"{team}_captain"]
                data["entrants"][i][0]["rioName"] = game_json[f"{team}_player"]
                data["entrants"][i][0]["msb_team"] = cls._get_msb_team_name(
                    roster, game_json[f"{team}_captain"]
                )

            batter_index = game_json["batter"]
            pitcher_index = game_json["pitcher"]

            if game_json["half_inning"] == 0:
                data["half_inning"] = "Top"
                data["batter"] = data["entrants"][0][0]["roster"][batter_index]
                data["pitcher"] = data["entrants"][1][0]["roster"][pitcher_index]
            else:
                data["half_inning"] = "Bottom"
                data["batter"] = data["entrants"][1][0]["roster"][batter_index]
                data["pitcher"] = data["entrants"][0][0]["roster"][pitcher_index]

            data["inning"] = game_json["inning"]
            data["outs"] = game_json["outs"]
            data["strikes"] = game_json.get("strikes", 0)
            data["balls"] = game_json.get("balls", 0)

            data["runnerOn1"] = game_json["runner_on_first"]
            data["runnerOn2"] = game_json["runner_on_second"]
            data["runnerOn3"] = game_json["runner_on_third"]

            data["game_mode"] = game_json.get("tag_set", -1)

        except Exception as e:
            logger.error(f"[RioGameDataProvider] Failed to parse game data: {e}")

        return data

    @classmethod
    def _reset_side_preservation(cls):
        """Reset side preservation state when HUD target changes."""
        cls._prev_player_sides = {}
        cls._prev_inning = None
        cls._sides_swapped = False
        cls._user_overridden = False
        StatsTracker.reset()

    @classmethod
    async def _apply_game_to_state(cls, parsed: dict):
        """Push all parsed game data into the HUD target scoreboard."""
        target = await Settings.Get("scoreboards.hud_target", 1)
        await apply_parsed_game_to_state(parsed, target)

    # --- Player side preservation (3-layer system) ---

    @classmethod
    async def _on_hud_game_update(cls, game_json: dict):
        """Callback from HudWatcher when the HUD file changes."""
        # Check for new game before parsing (uses raw inning from game_json)
        current_inning = game_json.get("inning", 1)
        if cls._is_new_game(current_inning):
            await StatsTracker.on_new_game(game_json)

        # Update HUD stats on every event
        StatsTracker.on_hud_update(game_json)

        parsed = cls.parse_game_data(game_json)
        parsed = cls._preserve_player_sides(parsed)
        cls.current_game = parsed
        await cls._apply_game_to_state(parsed)

        # Push merged stats to state after game data
        target = await Settings.Get("scoreboards.hud_target", 1)
        await StatsTracker.push_stats_to_state(target, cls._sides_swapped)

    @classmethod
    def _is_new_game(cls, current_inning: int) -> bool:
        """Detect new game by inning number decreasing."""
        if cls._prev_inning is None:
            return True
        return current_inning < cls._prev_inning

    @classmethod
    def _swap_entrants(cls, parsed: dict) -> dict:
        """Swap entrants[0] and entrants[1] along with their scores."""
        parsed["entrants"].reverse()
        parsed["team1score"], parsed["team2score"] = parsed["team2score"], parsed["team1score"]
        return parsed

    @classmethod
    async def toggle_sides_swapped(cls):
        """Called by UI swap action to toggle the persistent swap flag."""
        cls._sides_swapped = not cls._sides_swapped
        cls._user_overridden = True
        logger.info(f"[RIO] Manual swap toggled, sides_swapped={cls._sides_swapped}, user override active")

        # Re-apply current game with new swap state
        if cls.hud_watcher and cls.hud_watcher.latest_game_data:
            parsed = cls.parse_game_data(cls.hud_watcher.latest_game_data)
            parsed = cls._preserve_player_sides(parsed)
            cls.current_game = parsed
            await cls._apply_game_to_state(parsed)

            # Re-push stats with new swap state
            target = await Settings.Get("scoreboards.hud_target", 1)
            await StatsTracker.push_stats_to_state(target, cls._sides_swapped)

    @classmethod
    async def _pin_wants_swap(cls, player0: str, player1: str) -> bool | None:
        """Check if the pinned player setting requires a swap."""
        pinned_player = (await Settings.Get("project_rio.pinned_player", "")).strip()
        if not pinned_player:
            return None
        pinned_side = await Settings.Get("project_rio.pinned_side", "Team 1")
        pinned_index = 0 if pinned_side == "Team 1" else 1

        if player0 == pinned_player:
            return pinned_index == 1
        elif player1 == pinned_player:
            return pinned_index == 0
        return None

    @classmethod
    def _preserve_player_sides(cls, parsed: dict) -> dict:
        """Ensure consistent team sides across all HUD events in a game.

        On new game (inning decreased):
          - Reset _user_overridden flag
          - Pinned player or back-to-back detection determines initial sides
          - Set _sides_swapped flag for the duration of this game

        On mid-game events:
          - If user manually swapped (_user_overridden), respect their choice
          - Otherwise apply _sides_swapped (which pin or auto-detect set)
        """
        current_inning = parsed.get("inning", 1)
        player0 = parsed["entrants"][0][0].get("rioName", "")
        player1 = parsed["entrants"][1][0].get("rioName", "")

        # Pin check needs to be sync here since this is called from sync context
        # We use the cached settings value directly
        pinned_player = Settings.settings.get("project_rio", {}).get("pinned_player", "").strip()
        pin_swap = None
        if pinned_player:
            pinned_side = Settings.settings.get("project_rio", {}).get("pinned_side", "Team 1")
            pinned_index = 0 if pinned_side == "Team 1" else 1
            if player0 == pinned_player:
                pin_swap = pinned_index == 1
            elif player1 == pinned_player:
                pin_swap = pinned_index == 0

        if cls._is_new_game(current_inning):
            cls._user_overridden = False
            cls._sides_swapped = False

            if pin_swap is not None:
                if pin_swap:
                    cls._sides_swapped = True
                    logger.info("[RIO] New game: pinned player placed on configured side")
            else:
                if cls._prev_player_sides:
                    prev_side_0 = cls._prev_player_sides.get(player0)
                    prev_side_1 = cls._prev_player_sides.get(player1)
                    if prev_side_0 == 1 or prev_side_1 == 0:
                        cls._sides_swapped = True
                        logger.info("[RIO] New game: auto-swapping sides to keep returning player in place")

        elif cls._user_overridden and pin_swap is not None:
            if cls._sides_swapped == pin_swap:
                cls._user_overridden = False
                logger.info("[RIO] User swapped back to pinned position, clearing override")

        if cls._sides_swapped:
            parsed = cls._swap_entrants(parsed)

        # Update tracking (re-read after potential swap)
        player0 = parsed["entrants"][0][0].get("rioName", "")
        player1 = parsed["entrants"][1][0].get("rioName", "")
        cls._prev_player_sides = {player0: 0, player1: 1}
        cls._prev_inning = current_inning
        return parsed

    @classmethod
    def _get_msb_team_name(cls, roster: list, captain_index: int) -> str:
        """Generate the MSB team name from roster composition."""
        try:
            return team_name(roster, roster[captain_index])
        except Exception:
            return ""

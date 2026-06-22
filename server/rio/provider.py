import platform
from pathlib import Path

from loguru import logger
from server.rio.pyrio.lookup import LookupDicts
from server.rio.pyrio.team_name_algo import team_name

from server.rio.hud_watcher import HudWatcher
from server.rio.stats_tracker import StatsTracker
from server.settings import Settings
from server.state import State


# Map pyrio's human-readable stadium names to the slug values used by the
# frontend's STADIUM_OPTIONS / stadium renderer.
_STADIUM_SLUGS = {
    "Mario Stadium":  "mario_stadium",
    "Bowser Castle":  "bowser_castle",
    "Wario Palace":   "wario_palace",
    "Yoshi Park":     "yoshi_park",
    "Peach Garden":   "peach_garden",
    "DK Jungle":      "dk_jungle",
    "Toy Field":      "toy_field",
}


def _stadium_slug(val) -> str:
    """Resolve a stadium value to the frontend slug.

    Accepts an integer id (API ongoing feed), a human-readable name (HUD /
    completed games), or an already-resolved slug. Returns '' when unknown.
    """
    if val is None or val == "" or val == -1:
        return ""
    if isinstance(val, bool):
        return ""
    if isinstance(val, int):
        val = LookupDicts.STADIUM.get(val, "")
    return _STADIUM_SLUGS.get(val, val)


def _read_hud_targets() -> list[int]:
    """Active scoreboards whose source type is 'hud'."""
    active = Settings.Get("scoreboards.active", [1])
    sources = Settings.Get("scoreboards.sources", {})
    return [sb for sb in active if sources.get(str(sb), {}).get("type") == "hud"]


def get_default_hud_file_path() -> Path:
    """Returns the OS-specific path to Project Rio's decoded.hud.json file."""
    system = platform.system()

    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Project Rio" / "HudFiles" / "decoded.hud.json"
    elif system == "Windows":
        return Path.home() / "AppData" / "Roaming" / "Project Rio" / "HudFiles" / "decoded.hud.json"
    else:
        return Path("/invalid/path")


async def get_user_hud_path() -> Path | None:
    """Get user-configured HUD path from settings, falling back to OS default."""
    user_path = Settings.Get("project_rio.hud_path", "")
    if user_path:
        path = Path(user_path)
        if path.exists() and path.is_file() and path.suffix == ".json":
            return path

    default = get_default_hud_file_path()
    if default.exists():
        return default

    return None


async def apply_parsed_game_to_state(parsed: dict, scoreboard_number: int, home_team: int = 2):
    """Write parsed game data into State under score.{scoreboard_number}.

    Shared by RioGameDataProvider (HUD) and RioGamePool (API).
    Uses SetBatch to emit a single SocketIO event instead of 30+ individual ones.

    Args:
        home_team: Which team number (1 or 2) is the home team. Default 2.
                   When sides are swapped, pass 1 so the React UI calculates
                   batting/fielding teams correctly.
    """
    sb = f"score.{scoreboard_number}"

    entrants = parsed.get("entrants", [[{}], [{}]])
    left = entrants[0][0] if entrants[0] else {}
    right = entrants[1][0] if entrants[1] else {}

    entries = [
        (f"{sb}.home_team", home_team),
        (f"{sb}.game_id", parsed.get("game_id")),
        (f"{sb}.score_left", parsed.get("team1score", 0)),
        (f"{sb}.score_right", parsed.get("team2score", 0)),
        (f"{sb}.inning", parsed.get("inning", 1)),
        (f"{sb}.half_inning", parsed.get("half_inning", "Top")),
        (f"{sb}.outs", parsed.get("outs", 0)),
        (f"{sb}.strikes", parsed.get("strikes", 0)),
        (f"{sb}.balls", parsed.get("balls", 0)),
        (f"{sb}.batter", parsed.get("batter", "")),
        (f"{sb}.pitcher", parsed.get("pitcher", "")),
        (f"{sb}.batter_roster_index", parsed.get("batter_roster_index", -1)),
        (f"{sb}.pitcher_roster_index", parsed.get("pitcher_roster_index", -1)),
        (f"{sb}.batter_hand", parsed.get("batter_hand", 0)),
        (f"{sb}.pitcher_hand", parsed.get("pitcher_hand", 0)),
        (f"{sb}.batterSide", "left" if parsed.get("batter_hand") == 1 else "right"),
        (f"{sb}.cbRioRunnerOn1", parsed.get("runnerOn1", False)),
        (f"{sb}.cbRioRunnerOn2", parsed.get("runnerOn2", False)),
        (f"{sb}.cbRioRunnerOn3", parsed.get("runnerOn3", False)),
        (f"{sb}.runner1Name", parsed.get("runner1Name", "")),
        (f"{sb}.runner2Name", parsed.get("runner2Name", "")),
        (f"{sb}.runner3Name", parsed.get("runner3Name", "")),

        # All 9 fielding positions from the same diamond lookup.
        # Pitcher is also stored at score.{N}.pitcher for the DiamondPanel
        # and ActiveMatchupStats, but field.P keeps the namespace uniform.
        # These flip teams each half-inning, recomputed on every event.
        (f"{sb}.field.P",  parsed.get("field", {}).get("P",  "")),
        (f"{sb}.field.C",  parsed.get("field", {}).get("C",  "")),
        (f"{sb}.field.1B", parsed.get("field", {}).get("1B", "")),
        (f"{sb}.field.2B", parsed.get("field", {}).get("2B", "")),
        (f"{sb}.field.3B", parsed.get("field", {}).get("3B", "")),
        (f"{sb}.field.SS", parsed.get("field", {}).get("SS", "")),
        (f"{sb}.field.LF", parsed.get("field", {}).get("LF", "")),
        (f"{sb}.field.CF", parsed.get("field", {}).get("CF", "")),
        (f"{sb}.field.RF", parsed.get("field", {}).get("RF", "")),

        # Game-level metadata now sourced from HUD + ongoing API alike.
        (f"{sb}.star_chance", parsed.get("star_chance", False)),
        (f"{sb}.stadium", _stadium_slug(parsed.get("stadium_id"))),
        (f"{sb}.innings_selected", parsed.get("innings_selected")),
        (f"{sb}.tag_set", parsed.get("tag_set")),
        # Live game — clear any completed-game framing left over on this slot.
        (f"{sb}.game_completed", False),

        # Per-inning runs for the box score. Reuses the same keys the completed
        # game linescore renders from, so overlays render live + final the same.
        (f"{sb}.away_linescore", left.get("inning_scores", [])),
        (f"{sb}.home_linescore", right.get("inning_scores", [])),
    ]

    for team_idx in range(2):
        team_num = team_idx + 1
        player = entrants[team_idx][0] if entrants[team_idx] else {}
        prefix = f"{sb}.player.{team_num}"

        entries.append((f"{prefix}.rioName", player.get("rioName", "")))
        entries.append((f"{prefix}.msb_team", player.get("msb_team", "")))
        entries.append((f"{prefix}.rio_captainIndex", player.get("captainIndex", 0)))
        # Explicit banner art (may differ from the roster-derived msb_team).
        entries.append((f"{prefix}.logo", player.get("logo", "")))
        entries.append((f"{prefix}.port", player.get("port")))
        entries.append((f"{prefix}.team_stars", player.get("team_stars", 0)))

        roster = player.get("roster", [])
        batting_hands = player.get("batting_hands", [])
        fielding_hands = player.get("fielding_hands", [])
        is_starred = player.get("is_starred", [])
        positions = player.get("positions", [])
        entries.append((f"{prefix}.batting_hands", batting_hands))
        entries.append((f"{prefix}.fielding_hands", fielding_hands))
        for char_idx, char_name in enumerate(roster):
            entries.append((f"{prefix}.character.{char_idx}.name", char_name))
            if char_idx < len(is_starred):
                entries.append((f"{prefix}.character.{char_idx}.is_starred", is_starred[char_idx]))
            if char_idx < len(positions):
                entries.append((f"{prefix}.character.{char_idx}.position", positions[char_idx]))

    await State.SetBatch(entries)
    await State.Save()


def _linescore_side(linescore, side: int) -> list:
    """Extract one side's per-inning run list from a linescore value.

    TODO: Remove list branch once all users are on the updated Project Rio
    server that standardizes linescore as {"0": [...], "1": [...]}. The list
    form [[away...], [home...]] was returned by older server builds and caused
    AttributeError crashes in rotation advance (v1.1.0 bug).
    """
    if not linescore:
        return []
    if isinstance(linescore, list):
        return linescore[side] if side < len(linescore) else []
    return linescore.get(str(side), [])


async def apply_completed_game_to_state(game: dict, scoreboard_number: int):
    """Write completed game data into State under score.{scoreboard_number}.

    Completed games from the /games API have limited data compared to HUD/ongoing:
    - No full roster — only captain is available (placed in character slot 0)
    - No live game state (batter, pitcher, runners, count)
    - Includes final scores, ELO changes, timestamps, stadium, game mode
    """
    sb = f"score.{scoreboard_number}"

    # Convert pandas Timestamps to ISO strings if present
    def _ts(val):
        if hasattr(val, "isoformat"):
            return val.isoformat()
        return val

    stadium_slug = _stadium_slug(game.get("stadium", ""))

    entries = [
        # Home team designation (completed games always away=1, home=2)
        (f"{sb}.home_team", 2),

        # Scores
        (f"{sb}.score_left", game.get("away_score", 0)),
        (f"{sb}.score_right", game.get("home_score", 0)),

        # Game metadata. source_type is owned by Settings (per-scoreboard
        # source config); don't mirror it into State here — that would
        # silently override the user's selected source.
        (f"{sb}.game_id", game.get("game_id")),
        (f"{sb}.game_completed", True),
        (f"{sb}.date_time_start", _ts(game.get("date_time_start"))),
        (f"{sb}.date_time_end", _ts(game.get("date_time_end"))),
        (f"{sb}.innings_played", game.get("innings_played", 0)),
        (f"{sb}.innings_selected", game.get("innings_selected", 0)),
        (f"{sb}.stadium", stadium_slug),
        (f"{sb}.game_mode", game.get("game_mode", "")),

        # Linescore (per-inning runs, returned by API with include_linescore=1).
        # API returns {"0": [away innings...], "1": [home innings...]} but may
        # also return a list [[away...], [home...]] for some game records.
        (f"{sb}.away_linescore", _linescore_side(game.get("linescore"), 0)),
        (f"{sb}.home_linescore", _linescore_side(game.get("linescore"), 1)),

        # ELO
        (f"{sb}.winner_incoming_elo", game.get("winner_incoming_elo")),
        (f"{sb}.winner_result_elo", game.get("winner_result_elo")),
        (f"{sb}.loser_incoming_elo", game.get("loser_incoming_elo")),
        (f"{sb}.loser_result_elo", game.get("loser_result_elo")),

        # Winner/loser (processed columns from pyrio)
        (f"{sb}.winner_user", game.get("winner_user", "")),
        (f"{sb}.loser_user", game.get("loser_user", "")),
        (f"{sb}.winner_score", game.get("winner_score", 0)),
        (f"{sb}.loser_score", game.get("loser_score", 0)),

        # Final inning state (game is over)
        (f"{sb}.inning", game.get("innings_played", 9)),
        (f"{sb}.half_inning", "Final"),
        (f"{sb}.outs", 0),
        (f"{sb}.strikes", 0),
        (f"{sb}.balls", 0),
        (f"{sb}.batter", ""),
        (f"{sb}.pitcher", ""),
        (f"{sb}.batter_roster_index", -1),
        (f"{sb}.pitcher_roster_index", -1),
        (f"{sb}.cbRioRunnerOn1", False),
        (f"{sb}.cbRioRunnerOn2", False),
        (f"{sb}.cbRioRunnerOn3", False),
        (f"{sb}.runner1Name", ""),
        (f"{sb}.runner2Name", ""),
        (f"{sb}.runner3Name", ""),

        # Clear in-play display state that completed games don't provide.
        # Without these, the previous live game's values bleed through.
        (f"{sb}.batter_hand", 0),
        (f"{sb}.pitcher_hand", 0),
        (f"{sb}.batterSide", "right"),
        (f"{sb}.star_chance", False),
        (f"{sb}.tag_set", None),
        (f"{sb}.field.P",  ""),
        (f"{sb}.field.C",  ""),
        (f"{sb}.field.1B", ""),
        (f"{sb}.field.2B", ""),
        (f"{sb}.field.3B", ""),
        (f"{sb}.field.SS", ""),
        (f"{sb}.field.LF", ""),
        (f"{sb}.field.CF", ""),
        (f"{sb}.field.RF", ""),
    ]

    # Team data — captain only, no full roster
    away_captain = game.get("away_captain", "")
    home_captain = game.get("home_captain", "")
    team_data = [
        (game.get("away_user", ""), away_captain),
        (game.get("home_user", ""), home_captain),
    ]

    for team_idx, (username, captain) in enumerate(team_data):
        team_num = team_idx + 1
        prefix = f"{sb}.player.{team_num}"

        entries.append((f"{prefix}.rioName", username))
        entries.append((f"{prefix}.msb_team", ""))
        entries.append((f"{prefix}.rio_captainIndex", 0))
        # Completed games carry no live banner/port/star data — clear any
        # values left over from a previous live game on this scoreboard.
        entries.append((f"{prefix}.logo", ""))
        entries.append((f"{prefix}.port", None))
        entries.append((f"{prefix}.team_stars", 0))
        entries.append((f"{prefix}.batting_hands", []))
        entries.append((f"{prefix}.fielding_hands", []))

        # Captain in slot 0, clear remaining slots and all stale per-character data.
        entries.append((f"{prefix}.character.0.name", captain))
        entries.append((f"{prefix}.character.0.position", ""))
        entries.append((f"{prefix}.character.0.is_starred", False))
        for char_idx in range(1, 9):
            entries.append((f"{prefix}.character.{char_idx}.name", None))
            entries.append((f"{prefix}.character.{char_idx}.position", ""))
            entries.append((f"{prefix}.character.{char_idx}.is_starred", False))

    await State.SetBatch(entries)
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

    # Cached HUD-target list — avoids re-scanning settings on every HUD event.
    # Derived from per-scoreboard source.type == "hud"; refreshed in
    # _reset_side_preservation (called whenever sources change).
    _hud_targets: list[int] = []

    # Player side preservation state
    _prev_player_sides: dict = {}
    _prev_inning: int | None = None
    _sides_swapped: bool = False
    _user_overridden: bool = False

    @classmethod
    async def Start(cls):
        """Resolve HUD path and start the file watcher."""
        cls._hud_targets = _read_hud_targets()

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
        """Re-read the HUD path from settings and restart the watcher if changed.

        Returns True if the file was successfully read and state was updated,
        False if the watcher started but the initial read failed.
        Raises if no valid path is found.
        """
        new_path = await get_user_hud_path()
        if not new_path:
            raise FileNotFoundError("No valid HUD path found")

        if cls.hud_watcher:
            if cls.hud_watcher.hud_file == new_path:
                # Path unchanged — force a re-read
                game = await cls.hud_watcher.reload()
                if game:
                    await cls._on_hud_game_update(game)
                    return True
                return False
            await cls.Stop()

        cls.hud_watcher = HudWatcher(new_path, on_update=cls._on_hud_game_update)
        cls.hud_watcher.start()
        game = await cls.hud_watcher.reload()
        if game:
            await cls._on_hud_game_update(game)
            return True
        err = cls.hud_watcher.last_error or "unknown reason"
        logger.warning(f"[RioGameDataProvider] Watcher started but initial read of {new_path} failed: {err}")
        return False

    @classmethod
    async def FetchHUDGame(cls) -> dict | None:
        """Immediate one-shot read of the HUD file. Updates state and returns parsed game."""
        await cls.ReloadHudPath()
        if cls.hud_watcher and cls.hud_watcher.latest_game_data:
            game_json = cls.hud_watcher.latest_game_data
            for sb in cls._hud_targets:
                StatsTracker.on_hud_update(game_json, sb)
            parsed = cls.parse_game_data(game_json)
            parsed = cls._preserve_player_sides(parsed)
            cls.current_game = parsed
            await cls._apply_game_to_state(parsed)

            for sb in cls._hud_targets:
                await StatsTracker.push_stats_to_state(sb, cls._sides_swapped)
            return parsed
        return None

    @classmethod
    def _resolve_char(cls, c) -> str:
        """Convert a character value to a name string.

        Handles both integer IDs (from the Project Rio API / HUD file) and
        string names (already resolved). Returns '' for None.
        """
        if c is None:
            return ''
        if isinstance(c, int):
            return LookupDicts.CHAR_NAME.get(c, str(c))
        return str(c)

    @classmethod
    def _resolve_logo(cls, v) -> str:
        """Convert a team-logo value to its in-game name string.

        Handles both integer ids (API ongoing feed) and name strings (HUD).
        Returns '' for None. This is the explicit team-banner art, distinct
        from the roster-derived team name (see _get_msb_team_name).
        """
        if v is None or v == "":
            return ''
        if isinstance(v, bool):
            return ''
        if isinstance(v, int):
            return LookupDicts.LOGO.get(v, '')
        return str(v)

    @classmethod
    def _resolve_position(cls, v) -> str:
        """Convert a fielding-position value to its abbreviation string.

        Handles both integer ids (API ongoing feed) and abbreviation strings
        (HUD). Returns '' for None/invalid.
        """
        if v is None or v == "":
            return ''
        if isinstance(v, bool):
            return ''
        if isinstance(v, int):
            name = LookupDicts.POSITION.get(v, '')
            return '' if name in ('Inv', 'None') else name
        return str(v)

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
                # Resolve character IDs to name strings; handles both int IDs
                # (from the API / HUD file) and already-resolved string names.
                roster = [
                    cls._resolve_char(game_json[f"{team}_roster_{j}_char"])
                    for j in range(9)
                ]
                positions_raw = game_json.get(f"{team}_fielding_positions", [])
                entrant = data["entrants"][i][0]
                entrant["roster"] = roster
                entrant["batting_hands"] = [
                    game_json.get(f"{team}_roster_{j}_batting_hand", 0) for j in range(9)
                ]
                entrant["fielding_hands"] = [
                    game_json.get(f"{team}_roster_{j}_fielding_hand", 0) for j in range(9)
                ]
                entrant["is_starred"] = [
                    game_json.get(f"{team}_roster_{j}_is_starred", False) for j in range(9)
                ]
                entrant["positions"] = [
                    cls._resolve_position(positions_raw[j]) if j < len(positions_raw) else ""
                    for j in range(9)
                ]
                # Position-indexed diamond: index 0=P..8=RF -> roster slot there
                # (or None). The HUD path supplies it directly via pyrio's
                # HudObj.defensive_diamond(); the API ongoing feed has no such
                # field, so derive it from the resolved positions instead.
                diamond = game_json.get(f"{team}_defensive_diamond")
                if not isinstance(diamond, list):
                    diamond = [None] * 9
                    for slot, pos in enumerate(entrant["positions"]):
                        idx = LookupDicts.POSITION_INDEX.get(pos)
                        if idx is not None:
                            diamond[idx] = slot
                entrant["diamond"] = diamond
                entrant["captainIndex"] = game_json[f"{team}_captain"]
                entrant["rioName"] = game_json[f"{team}_player"]
                entrant["msb_team"] = cls._get_msb_team_name(
                    roster, game_json[f"{team}_captain"]
                )
                # Explicit in-game banner art — independent of the roster-derived
                # team name; players sometimes pick a banner on purpose.
                entrant["logo"] = cls._resolve_logo(game_json.get(f"{team}_logo"))
                entrant["port"] = game_json.get(f"{team}_port")
                entrant["team_stars"] = game_json.get(f"{team}_stars", 0)
                entrant["inning_scores"] = list(game_json.get(f"{team}_inning_scores", []) or [])

            batter_index = game_json["batter"]
            data["batter_roster_index"] = batter_index

            half = game_json["half_inning"]
            # Batting side: Top (0) → away, Bottom (1) → home.
            batting_idx = 0 if half == 0 else 1
            fielding_idx = 1 - batting_idx
            if half == 0:
                data["half_inning"] = "Top"
            else:
                data["half_inning"] = "Bottom"
            data["batter"] = data["entrants"][batting_idx][0]["roster"][batter_index]

            # Place every fielding-team defender onto the diamond the same way:
            # diamond is position-indexed (0=P..8=RF) -> roster slot, resolved to
            # a character name. The pitcher is just position 0 — no special case.
            fielding_entrant = data["entrants"][fielding_idx][0]
            fielding_roster = fielding_entrant["roster"]
            fielding_diamond = fielding_entrant.get("diamond", [None] * 9)
            field = {}
            for pos_idx, label in LookupDicts.POSITION.items():
                if not isinstance(pos_idx, int) or label == "Inv":
                    continue
                slot = fielding_diamond[pos_idx] if pos_idx < len(fielding_diamond) else None
                field[label] = (
                    fielding_roster[slot]
                    if isinstance(slot, int) and 0 <= slot < len(fielding_roster)
                    else ""
                )
            data["field"] = field
            # Pitcher is diamond position 0 — same lookup method as every other
            # fielder. roster_index and hand all resolve from the same slot so
            # pitcher name, hand, and stats always refer to the same player.
            diamond_pitcher_slot = fielding_diamond[0]
            data["pitcher"] = field.get("P", "")
            data["pitcher_roster_index"] = diamond_pitcher_slot
            data["batter_hand"] = data["entrants"][batting_idx][0]["batting_hands"][batter_index]
            data["pitcher_hand"] = fielding_entrant["fielding_hands"][diamond_pitcher_slot]

            data["inning"] = game_json["inning"]
            data["outs"] = game_json["outs"]
            data["strikes"] = game_json.get("strikes", 0)
            data["balls"] = game_json.get("balls", 0)

            data["runnerOn1"] = game_json["runner_on_first"]
            data["runnerOn2"] = game_json["runner_on_second"]
            data["runnerOn3"] = game_json["runner_on_third"]

            # Runner names: resolve from the batting team's roster + per-base
            # roster index. Works for both HUD and API ongoing feeds (the API no
            # longer ships runner_*_name strings). Falls back to any name string
            # the source did provide.
            batting_roster = data["entrants"][batting_idx][0]["roster"]

            def _runner_name(base_word: str, base_num: int) -> str:
                loc = game_json.get(f"runner_on_{base_word}_roster")
                if isinstance(loc, int) and 0 <= loc < len(batting_roster):
                    return batting_roster[loc]
                return cls._resolve_char(game_json.get(f"runner_{base_num}b_name", ""))

            data["runner1Name"] = _runner_name("first", 1) if data["runnerOn1"] else ""
            data["runner2Name"] = _runner_name("second", 2) if data["runnerOn2"] else ""
            data["runner3Name"] = _runner_name("third", 3) if data["runnerOn3"] else ""

            # Game-level metadata (now available from both HUD and ongoing API).
            data["star_chance"] = bool(game_json.get("star_chance", False))
            data["stadium_id"] = game_json.get("stadium_id")
            data["innings_selected"] = game_json.get("innings_selected")
            data["first_batting_team"] = game_json.get("first_batting_team")
            data["tag_set"] = game_json.get("tag_set")
            data["game_mode"] = game_json.get("tag_set", -1)

        except Exception as e:
            logger.error(f"[RioGameDataProvider] Failed to parse game data: {e}")

        return data

    @classmethod
    def refresh_hud_targets(cls):
        """Re-scan settings for the current HUD-target list.

        Call after any change to scoreboards.sources or scoreboards.active so
        the HUD watcher stops writing into demoted/removed scoreboards and
        starts writing into newly-promoted ones, without otherwise disturbing
        side-preservation state.
        """
        cls._hud_targets = _read_hud_targets()

    @classmethod
    def _reset_side_preservation(cls):
        """Reset side preservation state when HUD target changes."""
        cls._prev_player_sides = {}
        cls._prev_inning = None
        cls._sides_swapped = False
        cls._user_overridden = False
        cls._hud_targets = _read_hud_targets()
        for sb in cls._hud_targets:
            StatsTracker.reset_scoreboard(sb)

    @classmethod
    async def _apply_game_to_state(cls, parsed: dict):
        """Push parsed game data to every HUD-target scoreboard."""
        home_team = 1 if cls._sides_swapped else 2
        for sb in cls._hud_targets:
            await apply_parsed_game_to_state(parsed, sb, home_team=home_team)

    # --- Player side preservation (3-layer system) ---

    @classmethod
    async def _on_hud_game_update(cls, game_json: dict):
        """Callback from HudWatcher when the HUD file changes."""
        # Check for new game before parsing (uses raw inning from game_json)
        current_inning = game_json.get("inning", 1)
        is_new_game = cls._is_new_game(current_inning)

        # On a new game, auto-select the game mode from the HUD's tag set so
        # web stats fetch automatically — and the per-scoreboard game-mode
        # selectbox visually reflects the mode actually being played. Mirrors
        # the live-API assignment path, which already does this from the game's
        # mode. Done before on_new_game so its stats fetch uses the new tag.
        if is_new_game:
            await cls._apply_hud_game_mode(game_json)

        for sb in cls._hud_targets:
            if is_new_game:
                await StatsTracker.on_new_game(
                    game_json,
                    sb,
                    await_fetch=False,
                    sides_swapped=cls._sides_swapped,
                )
            StatsTracker.on_hud_update(game_json, sb)

        parsed = cls.parse_game_data(game_json)
        parsed = cls._preserve_player_sides(parsed)
        cls.current_game = parsed
        # Mirror current swap state into each slot so background fetches push
        # with the correct team mapping when they land.
        for sb in cls._hud_targets:
            StatsTracker.set_sides_swapped(sb, cls._sides_swapped)
        await cls._apply_game_to_state(parsed)

        for sb in cls._hud_targets:
            await StatsTracker.push_stats_to_state(sb, cls._sides_swapped)

    @classmethod
    async def _apply_hud_game_mode(cls, game_json: dict):
        """Set each HUD-target scoreboard's game-mode tag from the HUD tag set.

        Resolves the HUD game's TagSetID to its game-mode name and writes it to
        scoreboards.sources.{sb}.stats_tag. This drives the stats fetch and
        updates the UI selectbox. If the id can't be resolved (unknown/inactive
        mode) the existing manual selection is left untouched.
        """
        from server.rio import stats_api  # local import avoids cycle at module load

        tag_set_id = game_json.get("tag_set")
        name = await stats_api.resolve_tag_set_name(tag_set_id)
        if not name:
            return
        for sb in cls._hud_targets:
            current = Settings.Get(f"scoreboards.sources.{sb}.stats_tag", None)
            if current != name:
                await Settings.Set(f"scoreboards.sources.{sb}.stats_tag", name)

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

            # Re-push stats with new swap state to every HUD target
            for sb in cls._hud_targets:
                await StatsTracker.push_stats_to_state(sb, cls._sides_swapped)

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

        pinned_player = Settings.Get("project_rio.pinned_player", "").strip()
        pin_swap = None
        if pinned_player:
            pinned_side = Settings.Get("project_rio.pinned_side", "Team 1")
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

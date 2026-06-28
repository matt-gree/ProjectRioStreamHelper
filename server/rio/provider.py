import platform
from pathlib import Path

from loguru import logger
from server.rio.pyrio.lookup import LookupDicts
from server.rio.pyrio.team_name_algo import team_name

from server.rio import hit_visualizer
from server.rio.hud_watcher import HudWatcher
from server.rio.resurface import RESURFACE_MAP as _RESURFACE_MAP
from server.rio.stats_tracker import StatsTracker
from server.match import Match
from server.participants import Participants
from server.settings import Settings
from server.state import State


def _apply_resurface(entries: list[tuple]) -> None:
    """Enrich a pending SetBatch with saved address-book data, in place.

    Scans `entries` for any `…player.{T}.rioName` write with a non-empty value,
    matches it against the participant registry, and appends the resolved
    enrichment fields to the SAME batch (so HUD, Live API, and Rotator games all
    resurface a known player with no extra SocketIO events). Reads the in-memory
    registry only — safe on the hot path. Never overwrites a key the game itself
    already set, and only writes non-empty registry values.
    """
    existing = {k for k, _ in entries}
    additions: list[tuple] = []
    for key, value in entries:
        if not key.endswith(".rioName") or not value:
            continue
        row = Participants.MatchByRioName(value)
        if not row:
            continue
        prefix = key[: -len(".rioName")]
        display = row.get("display") or {}
        for src, dst in _RESURFACE_MAP.items():
            dst_key = f"{prefix}.{dst}"
            v = display.get(src)
            if v and dst_key not in existing:
                additions.append((dst_key, v))
                existing.add(dst_key)
    entries.extend(additions)


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


async def apply_parsed_game_to_state(parsed: dict, scoreboard_number: int, home_team: int = 2, side_reason: str = ""):
    """Write parsed game data into State under score.{scoreboard_number}.

    Shared by RioGameDataProvider (HUD) and RioGamePool (API).
    Uses SetBatch to emit a single SocketIO event instead of 30+ individual ones.

    Args:
        home_team: Which team number (1 or 2) is the home team. Default 2.
                   When sides are swapped, pass 1 so the React UI calculates
                   batting/fielding teams correctly.
        side_reason: Why the sides are ordered as they are — one of
                   manual|pin|match|back_to_back, or "" for raw feed order.
                   Mirrored to score.{N}.side_reason for the UI/overlays.
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
        # Why the sides are ordered as they are (manual|pin|match|back_to_back|"").
        (f"{sb}.side_reason", side_reason),
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

    _apply_resurface(entries)

    # Draft→Live reconciliation: for a board bound to a match, overlay the
    # producer's authored participant identity (rioName-keyed, so it's correct
    # regardless of which side the feed seated each player on) on top of the
    # resurface guess, then promote the match draft→live. Appended last so these
    # keys win over the feed/resurface writes; live data already in `entries`
    # stays authoritative for everything else.
    entries.extend(
        Match.identity_entries(
            scoreboard_number, left.get("rioName", ""), right.get("rioName", "")
        )
    )
    await State.SetBatch(entries)
    await State.Save()
    await Match.note_live(scoreboard_number)


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


async def apply_completed_game_to_state(game: dict, scoreboard_number: int, side_reason: str = ""):
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
        (f"{sb}.side_reason", side_reason),

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

    _apply_resurface(entries)
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

    # Hit visualizer: dedupe repeat HUD frames of the same contact, and a
    # monotonic counter the overlay watches to retrigger its animation.
    _last_hit_sig: tuple | None = None
    _hit_counter: int = 0

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
            swaps = await cls._apply_game_to_state(parsed)
            await cls._maybe_apply_hit(game_json)

            for sb in cls._hud_targets:
                await StatsTracker.push_stats_to_state(sb, swaps.get(sb, cls._sides_swapped))
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
            # Carry the GameID forward so score.{N}.game_id is populated on the
            # HUD path (post-game capture matches the stat file by this id). The
            # Live-API path sets game_id on its own game dict; the HUD parse
            # otherwise drops it here.
            data["game_id"] = game_json.get("game_id")

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
    def _orient_copy(cls, parsed: dict) -> dict:
        """A side-swapped shallow copy of `parsed` (entrants reversed, scores
        flipped) — same semantics as `_swap_entrants` but non-destructive, so
        one board's match orientation can't disturb another's."""
        p = dict(parsed)
        p["entrants"] = list(reversed(parsed["entrants"]))
        p["team1score"], p["team2score"] = (
            parsed.get("team2score", 0),
            parsed.get("team1score", 0),
        )
        return p

    @classmethod
    async def _apply_game_to_state(cls, parsed: dict) -> dict:
        """Push parsed game data to every HUD-target scoreboard.

        Side orientation is decided PER BOARD by the precedence cascade in
        `_decide` (manual > pin > match > back-to-back), so a match-bound board
        can seat the authored sides while an unbound board still follows
        pin/back-to-back. Each board's `side_reason` is written to State so the
        UI/overlays can show why the order is what it is. Returns a
        {scoreboard: sides_swapped} map so the caller pushes stats with the same
        per-board orientation.
        """
        entrants = parsed.get("entrants") or [[{}], [{}]]
        raw_left = entrants[0][0].get("rioName", "") if entrants[0] else ""
        raw_right = entrants[1][0].get("rioName", "") if entrants[1] else ""

        swaps: dict[int, bool] = {}
        for sb in cls._hud_targets:
            swapped, reason = cls._decide(raw_left, raw_right, sb=sb)
            board = cls._orient_copy(parsed) if swapped else parsed
            await apply_parsed_game_to_state(
                board, sb, home_team=1 if swapped else 2, side_reason=reason,
            )
            swaps[sb] = swapped

        # current_game + back-to-back tracking use the global (match-agnostic)
        # orientation — the "streamer's side" reference that should be stable
        # across games regardless of any per-board match binding.
        g_swapped, _ = cls._decide(raw_left, raw_right, sb=None)
        cls.current_game = cls._orient_copy(parsed) if g_swapped else parsed
        gl, gr = (raw_right, raw_left) if g_swapped else (raw_left, raw_right)
        cls._prev_player_sides = {gl: 0, gr: 1}
        cls._prev_inning = parsed.get("inning", 1)
        return swaps

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
        swaps = await cls._apply_game_to_state(parsed)
        # Mirror the PER-BOARD swap state into each slot so background fetches and
        # the stats push use the same orientation as the live data just written —
        # a match-bound board may differ from the global pin/back-to-back swap.
        for sb in cls._hud_targets:
            StatsTracker.set_sides_swapped(sb, swaps.get(sb, cls._sides_swapped))
        await cls._maybe_apply_hit(game_json)

        for sb in cls._hud_targets:
            await StatsTracker.push_stats_to_state(sb, swaps.get(sb, cls._sides_swapped))

    @classmethod
    async def _maybe_apply_hit(cls, game_json: dict):
        """Compute and push the hit visualizer payload for a new contact.

        Fires for every batted ball (fair/foul/out). Deduped by contact
        signature so repeat HUD frames of the same contact don't re-push;
        a fresh contact bumps ``hit.id`` so overlays re-animate. The producer
        decides what to actually show.
        """
        if not cls._hud_targets:
            return
        hit = hit_visualizer.build_hit(game_json)
        if hit is None:
            return
        sig = hit.pop("_sig", None)
        if sig == cls._last_hit_sig:
            return
        cls._last_hit_sig = sig
        cls._hit_counter += 1
        hit["id"] = cls._hit_counter

        entries = []
        for sb in cls._hud_targets:
            for key, value in hit.items():
                entries.append((f"score.{sb}.hit.{key}", value))
        await State.SetBatch(entries)
        await State.Save()

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

        # Re-apply current game with new swap state. A manual swap sets
        # _user_overridden, so _apply_game_to_state skips match orientation and
        # every board honors the user's flip (swaps == global state).
        if cls.hud_watcher and cls.hud_watcher.latest_game_data:
            parsed = cls.parse_game_data(cls.hud_watcher.latest_game_data)
            parsed = cls._preserve_player_sides(parsed)
            cls.current_game = parsed
            swaps = await cls._apply_game_to_state(parsed)

            # Re-push stats with new swap state to every HUD target
            for sb in cls._hud_targets:
                await StatsTracker.push_stats_to_state(sb, swaps.get(sb, cls._sides_swapped))

    @classmethod
    def _pin_swap(cls, left: str, right: str) -> bool | None:
        """Pinned-player ("player lock") orientation. True=swap, False=already
        correct, None=pinned player not in this game / no pin set."""
        pinned = Settings.Get("project_rio.pinned_player", "").strip()
        if not pinned:
            return None
        side = Settings.Get("project_rio.pinned_side", "Team 1")
        idx = 0 if side == "Team 1" else 1
        if left == pinned:
            return idx == 1
        if right == pinned:
            return idx == 0
        return None

    @classmethod
    def _b2b_swap(cls, left: str, right: str) -> bool | None:
        """Back-to-back ("repeated game") orientation: keep a returning player on
        the side they were last on. True=swap, False=already correct, None=no
        prior game / neither player returning."""
        if not cls._prev_player_sides:
            return None
        ps_left = cls._prev_player_sides.get(left)
        ps_right = cls._prev_player_sides.get(right)
        if ps_left is None and ps_right is None:
            return None
        if ps_left == 1 or ps_right == 0:
            return True
        return False

    @classmethod
    def _decide(cls, left: str, right: str, sb=None, allow_manual: bool = True) -> tuple:
        """Resolve side orientation for one board as (sides_swapped, reason).

        Precedence (highest first): manual > pin > match > back_to_back > none.
        `reason` names the deciding layer (or "" when nothing governs the order)
        and is mirrored into score.{N}.side_reason. Pass `sb=None` for the global
        (match-agnostic) orientation used for back-to-back tracking; pass
        `allow_manual=False` to seed the manual base on a new game.
        """
        if allow_manual and cls._user_overridden:
            return cls._sides_swapped, "manual"
        pin = cls._pin_swap(left, right)
        if pin is not None:
            return pin, "pin"
        if sb is not None:
            mo = Match.orientation_for_sides(sb, left, right)
            if mo is not None:
                return mo, "match"
        b2b = cls._b2b_swap(left, right)
        if b2b is not None:
            return b2b, "back_to_back"
        return False, ""

    @classmethod
    def _preserve_player_sides(cls, parsed: dict) -> dict:
        """PRE-step for the side cascade — runs once per HUD event.

        Updates only the manual-override state machine; it does NOT swap
        `parsed` (per-board orientation, including pin/match/back-to-back, is
        applied in `_apply_game_to_state` via `_decide`). Returns `parsed`
        unchanged (raw away/home order).

        - New game (inning decreased): clear the manual override and reseed the
          manual base (`_sides_swapped`) from pin→back-to-back, so a later swap-
          button click flips from the sensible default.
        - Mid-game: if the user manually swapped back to the pinned orientation,
          release the override so pin/match resume control.
        """
        current_inning = parsed.get("inning", 1)
        entrants = parsed.get("entrants") or [[{}], [{}]]
        left = entrants[0][0].get("rioName", "") if entrants[0] else ""
        right = entrants[1][0].get("rioName", "") if entrants[1] else ""

        if cls._is_new_game(current_inning):
            cls._user_overridden = False
            cls._sides_swapped, _ = cls._decide(left, right, sb=None, allow_manual=False)
        elif cls._user_overridden:
            pin = cls._pin_swap(left, right)
            if pin is not None and cls._sides_swapped == pin:
                cls._user_overridden = False
                logger.info("[RIO] User swapped back to pinned position, clearing override")
        return parsed

    @classmethod
    def _get_msb_team_name(cls, roster: list, captain_index: int) -> str:
        """Generate the MSB team name from roster composition."""
        try:
            return team_name(roster, roster[captain_index])
        except Exception:
            return ""

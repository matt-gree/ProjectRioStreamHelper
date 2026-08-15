import asyncio
import os
import platform
from pathlib import Path

from loguru import logger
from server.rio.pyrio.lookup import LookupDicts
from server.rio.pyrio.team_name_algo import team_name

from server.rio import hit_visualizer
from server.rio.hud_watcher import HudWatcher
from server.rio.resurface import RESURFACE_MAP as _RESURFACE_MAP
from server.rio import stats_api
from server.rio.stats_tracker import StatsTracker
from server.match import Match
from server.participants import Participants
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get


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


def _clear_unresurfaced_prefix(entries: list[tuple], sb: str) -> None:
    """Blank a side's address-book prefix if resurface didn't just set one.

    Call AFTER `_apply_resurface()`. Every apply_* path already re-clears the
    fields a new player brings no data for (logo, port, roster, ...) so the
    previous occupant's values don't linger — but `.team` (the prefix/sponsor
    tag) is written ONLY by resurface, on a match. Without this, a player with
    no prefix of their own would silently keep whatever tag the last player in
    this slot had.
    """
    present = {k for k, _ in entries}
    for team_num in (1, 2):
        key = f"{sb}.player.{team_num}.team"
        if key not in present:
            entries.append((key, ""))


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
    """Scoreboards that mirror the local HUD game.

    HUD is a global transport on board 1 (see server/bindings.py), so this is
    `[1]` when board 1 is active and hud_enabled, else `[]`.
    """
    from server.bindings import hud_target_scoreboards
    return hud_target_scoreboards()


def get_default_hud_file_path() -> Path:
    """Returns the OS-specific path to Project Rio's decoded.hud.json file."""
    system = platform.system()

    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Project Rio" / "HudFiles" / "decoded.hud.json"
    elif system == "Windows":
        # %APPDATA%, not a hardcoded ~/AppData/Roaming. They are the same on a
        # stock install and different on any machine with a roaming profile or
        # folder redirection, where AppData lives on a network share — and
        # Project Rio writes to the variable, so guessing the literal path is
        # how PRSH ends up watching a file nothing will ever write. This also
        # feeds the StatFiles dir for post-game capture (server/postgame_files),
        # so the guess costs the producer two features, not one.
        # Same resolution order as server/paths.py:_frozen_writable_root.
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / "Project Rio" / "HudFiles" / "decoded.hud.json"
    else:
        return Path("/invalid/path")


async def get_user_hud_path() -> Path | None:
    """Get user-configured HUD path from settings, falling back to OS default.

    PRSH_HUD_FILE (isolated agent/CI runs — see server/paths.py) is
    authoritative and skips the existence check: the watcher watches the
    parent directory, so the file may not exist until a replay writes it.
    The parent directory must exist at startup.
    """
    override = os.environ.get("PRSH_HUD_FILE")
    if override:
        return Path(override).expanduser()

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
        # Game mode as a NAME, the same key completed games land it in — so an
        # overlay slot for "what mode is this" works in both states instead of
        # only after the game ends. The id→name map is the cache the boot fetch
        # and _apply_hud_game_mode already fill; this reads it synchronously and
        # accepts "" until it is warm rather than putting a Rio round-trip on
        # the per-frame path (see stats_api.game_mode_name).
        (f"{sb}.game_mode", stats_api.game_mode_name(parsed.get("tag_set"))),
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

        # Manual name override (producer-set, per display slot). When present it
        # BECOMES the slot's identity: it wins over the feed name here, so it
        # also drives resurface (scans .rioName entries below) and the match
        # identity gate, and stats fetch/push read it back from State. The feed
        # keeps writing roster/scores/gameplay; only the name is pinned. Cleared
        # on a new HUD game (see `_clear_name_overrides`).
        override = deep_get(State.state, f"{prefix}.rioName_override", "")
        eff_rio = override or player.get("rioName", "")
        entries.append((f"{prefix}.rioName", eff_rio))
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
    _clear_unresurfaced_prefix(entries, sb)

    # Draft→Live reconciliation: for a board bound to a match, overlay the
    # producer's authored participant identity (rioName-keyed, so it's correct
    # regardless of which side the feed seated each player on) on top of the
    # resurface guess, then promote the match draft→live. Appended last so these
    # keys win over the feed/resurface writes; live data already in `entries`
    # stays authoritative for everything else.
    # Overrides drive identity, so the match gate sees the pinned names too
    # (left → display slot 1, right → display slot 2).
    eff_left = deep_get(State.state, f"{sb}.player.1.rioName_override", "") or left.get("rioName", "")
    eff_right = deep_get(State.state, f"{sb}.player.2.rioName_override", "") or right.get("rioName", "")
    entries.extend(
        Match.identity_entries(scoreboard_number, eff_left, eff_right)
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


def _completed_roster(roster_ids, captain: str) -> tuple[list, int]:
    """Resolve a completed game's roster to (names, captain_index).

    `roster_ids` is away_roster/home_roster from the /games API: nine character
    IDs in roster order. It ships in the DEFAULT response — there is no
    include_roster parameter to add (passing one changes nothing) — and pyrio's
    _process_games leaves the column untouched, so it arrives here as a plain
    list.

    The captain is a member of the roster rather than a thing beside it, so its
    index comes from finding it. That is what makes the captain ring land on the
    right character; before the roster was available the index could only be
    hardcoded to 0, which was right only by luck.

    Falls back to the pre-roster shape — captain alone in slot 0 — when a record
    has no roster (older games, or a shape change upstream). Overlays already
    handle a one-name roster, so a missing roster degrades instead of breaking.
    """
    names = []
    for cid in roster_ids if isinstance(roster_ids, (list, tuple)) else []:
        try:
            names.append(LookupDicts.CHAR_NAME.get(int(cid), ""))
        except (TypeError, ValueError):
            names.append("")
    if not any(names):
        return ([captain] if captain else []), 0
    cap_idx = names.index(captain) if captain in names else 0
    return names, cap_idx


async def apply_completed_game_to_state(game: dict, scoreboard_number: int, side_reason: str = ""):
    """Write completed game data into State under score.{scoreboard_number}.

    Completed games from the /games API differ from HUD/ongoing:
    - No live game state (batter, pitcher, runners, count)
    - No MSB team / controller port — overlays fall back to the captain icon
      and the default side colours
    - Includes final scores, ELO changes, timestamps, stadium, game mode
    - DOES include both rosters: away_roster/home_roster are in the default
      /games/ response (no include_roster param — that is a no-op), as nine
      character IDs in roster order.
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

    team_data = [
        (game.get("away_user", ""), game.get("away_captain", ""), game.get("away_roster")),
        (game.get("home_user", ""), game.get("home_captain", ""), game.get("home_roster")),
    ]

    for team_idx, (username, captain, roster_ids) in enumerate(team_data):
        team_num = team_idx + 1
        prefix = f"{sb}.player.{team_num}"

        roster, cap_idx = _completed_roster(roster_ids, captain)

        entries.append((f"{prefix}.rioName", username))
        entries.append((f"{prefix}.msb_team", ""))
        entries.append((f"{prefix}.rio_captainIndex", cap_idx))
        # Completed games carry no live banner/port/star data — clear any
        # values left over from a previous live game on this scoreboard.
        entries.append((f"{prefix}.logo", ""))
        entries.append((f"{prefix}.port", None))
        entries.append((f"{prefix}.team_stars", 0))
        entries.append((f"{prefix}.batting_hands", []))
        entries.append((f"{prefix}.fielding_hands", []))

        # Roster in order; clear any slot this game doesn't fill, along with the
        # per-character data completed games never carry.
        for char_idx in range(9):
            name = roster[char_idx] if char_idx < len(roster) else None
            entries.append((f"{prefix}.character.{char_idx}.name", name))
            entries.append((f"{prefix}.character.{char_idx}.position", ""))
            entries.append((f"{prefix}.character.{char_idx}.is_starred", False))

    _apply_resurface(entries)
    _clear_unresurfaced_prefix(entries, sb)
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
    # Derived transport: board 1 when project_rio.hud_enabled (see
    # server/bindings.py); refreshed in _reset_side_preservation (called
    # whenever the HUD toggle or active scoreboards change).
    _hud_targets: list[int] = []

    # True when a new-game frame could not resolve its game mode because the
    # mode list had not arrived yet (cold start). Makes the next frame try
    # again; see _apply_hud_game_mode.
    _game_mode_unresolved: bool = False

    # Player side preservation state
    _prev_player_sides: dict = {}
    _prev_inning: int | None = None
    _prev_game_id = None
    _sides_swapped: bool = False
    _user_overridden: bool = False

    # The producer has cleared the board by hand and the feed's cached frame no
    # longer describes what is on air.
    #
    # `hud_watcher.latest_game_data` is the last frame Project Rio wrote, and it
    # outlives a hand reset — deliberately, because several paths re-seat it (the
    # HUD toggle, /scoreboards/reset, the explicit re-read). But a MANUAL SWAP
    # also re-applied it, so resetting a board and then swapping sides brought
    # the whole game back (user report, 2026-08-08). A swap is not a request for
    # the feed's data; it is a request to flip whatever is on the board.
    #
    # Set by release_feed() (the desk's Reset), cleared by the next real frame
    # from the watcher or by an explicit re-read — so Reset clears and Re-read
    # restores, which is the pairing the desk already offers.
    _feed_released: bool = False

    # Serializes the two entry points that read-modify-write the shared side
    # state (_sides_swapped/_user_overridden/current_game): a HUD frame landing
    # mid-swap would otherwise interleave with toggle_sides_swapped and apply a
    # half-toggled orientation. Created lazily so it binds to the running event
    # loop (tests reset it).
    _update_lock: asyncio.Lock | None = None

    @classmethod
    def _lock(cls) -> asyncio.Lock:
        if cls._update_lock is None:
            cls._update_lock = asyncio.Lock()
        return cls._update_lock

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
        # The stat directory is a sibling of the HUD file's, so auto-capture was
        # left watching the old rig's folder. Imported here, not at module level:
        # postgame_files resolves its directory THROUGH this module.
        from server.postgame_watch import StatFileWatcher
        await StatFileWatcher.Restart()
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
            # An explicit re-read is the producer asking for the feed back, so it
            # ends a hand reset's hold on the board (see _feed_released).
            cls._feed_released = False
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

        Call after any change to project_rio.hud_enabled or scoreboards.active so
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
        cls._prev_game_id = None
        cls._sides_swapped = False
        cls._user_overridden = False
        # Every caller of this re-seats the current frame right after (the HUD
        # toggle, /scoreboards/reset), so a hand reset's hold is over.
        cls._feed_released = False
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
        `_decide` (manual > match > pin > back-to-back), so a match-bound board
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
        # Only track a real id — a frame without one must not blind the next
        # comparison (None would never mismatch).
        if parsed.get("game_id"):
            cls._prev_game_id = parsed["game_id"]
        return swaps

    # --- Per-game match identity gate (Phase B) ---

    @classmethod
    def _conflict_active(cls, sb: int) -> bool:
        """Whether board ``sb`` currently carries an active match conflict."""
        score = State.state.get("score", {}) or {}
        sc = score.get(str(sb)) or score.get(sb) or {}
        mc = sc.get("match_conflict") if isinstance(sc, dict) else None
        return bool(isinstance(mc, dict) and mc.get("active"))

    @classmethod
    async def _clear_conflict(cls, sb: int) -> None:
        """Blank a board's match_conflict (only writes when one is set)."""
        if cls._conflict_active(sb):
            await State.Set(f"score.{sb}.match_conflict", None)
            await State.Save()

    @classmethod
    async def _retire_match_from_board(cls, sb: int, m) -> None:
        """Auto-retire a decided match off board ``sb`` when different players
        start a game: unbind + blank the projection so the board follows the raw
        feed, and stamp the match ``post``. The match object survives (its final
        series is preserved) — retiring is a producer-visible outcome, not a
        delete.

        Adopting a queued "next" match is left to the producer (the Production
        draft bar); there is no server-side match queue to auto-promote from.
        """
        logger.info("[Match] board {} auto-retiring decided match {} (new game, "
                    "different players)", sb, m)
        await State.Unset(f"score.{sb}.match")
        await State.Set(f"match.{m}.stage", "post")
        await State.Save()
        await Match.clear_scoreboard(sb)
        await cls._clear_conflict(sb)

    @classmethod
    async def _gate_board(cls, sb: int, left: str, right: str) -> None:
        """Apply the identity gate outcome for one board against live players
        ``left``/``right``: raise/clear the conflict flag or auto-retire a
        decided match. Orientation itself is handled elsewhere (`_decide`); this
        only manages the conflict flag + retire, never the live data."""
        res = Match.gate_state(sb, left, right)
        status = res.get("status")
        if status == "conflict":
            await State.Set(f"score.{sb}.match_conflict", {
                "active": True,
                "matchId": res["matchId"],
                "expected": res["expected"],
                "feed": res["feed"],
            })
            await State.Save()
            logger.warning("[Match] board {} gate conflict: feed {} vs expected {}",
                           sb, res["feed"], res["expected"])
        elif status == "retire":
            await cls._retire_match_from_board(sb, res["matchId"])
        else:  # ok / nogate — the live players belong here; drop stale conflict
            await cls._clear_conflict(sb)

    @classmethod
    async def _evaluate_match_gates(cls, parsed: dict) -> None:
        """Run the identity gate for every bound HUD-target board on a new game.

        Conflicts are written to score.{N}.match_conflict for the app-wide
        notification; a clean resolve clears any stale conflict; a decided-match
        mismatch auto-retires.
        """
        entrants = parsed.get("entrants") or [[{}], [{}]]
        left = entrants[0][0].get("rioName", "") if entrants[0] else ""
        right = entrants[1][0].get("rioName", "") if entrants[1] else ""

        for sb in cls._hud_targets:
            await cls._gate_board(sb, left, right)

    @classmethod
    async def evaluate_match_gate_for_board(cls, sb: int) -> None:
        """Re-run the identity gate for a single board against the *current* live
        HUD game.

        The new-game path (`_evaluate_match_gates`) only fires on an inning
        reset, so a conflict introduced mid-game — by binding or re-binding a
        match to a board that already has a live game — would otherwise stay
        silent until the next new game (or an app restart re-reading the HUD).
        Callers on the bind/match-mutation paths invoke this so the warning
        surfaces immediately. No-op for boards with no live HUD game.
        """
        if sb not in cls._hud_targets or cls.current_game is None:
            return
        entrants = cls.current_game.get("entrants") or [[{}], [{}]]
        left = entrants[0][0].get("rioName", "") if entrants[0] else ""
        right = entrants[1][0].get("rioName", "") if entrants[1] else ""
        await cls._gate_board(sb, left, right)

    # --- Player side preservation (3-layer system) ---

    @classmethod
    async def _on_hud_game_update(cls, game_json: dict):
        """Callback from HudWatcher when the HUD file changes.

        Serialized with toggle_sides_swapped by _update_lock so a HUD frame
        never interleaves with a manual swap's read-modify-write.
        """
        async with cls._lock():
            await cls._on_hud_game_update_impl(game_json)

    @classmethod
    def release_feed(cls):
        """Stop treating the cached HUD frame as what is on the board.

        Called when the producer clears a HUD board by hand. See _feed_released.
        """
        if not cls._feed_released:
            logger.info("[RIO] HUD feed released — board cleared by hand")
        cls._feed_released = True

    @classmethod
    async def _on_hud_game_update_impl(cls, game_json: dict):
        # A real frame from the watcher is the feed speaking again, so it takes
        # the board back from a hand reset. The watcher is OS-event driven, so
        # this only fires when Project Rio actually rewrites the file — a reset
        # holds for as long as the game is genuinely not moving.
        cls._feed_released = False

        # Check for new game before parsing (uses raw inning from game_json)
        current_inning = game_json.get("inning", 1)
        is_new_game = cls._is_new_game(current_inning, game_json.get("game_id"))

        # On a new game, auto-select the game mode from the HUD's tag set so
        # web stats fetch automatically — and the per-scoreboard game-mode
        # selectbox visually reflects the mode actually being played. Mirrors
        # the live-API assignment path, which already does this from the game's
        # mode. Done before on_new_game so its stats fetch uses the new tag.
        if is_new_game:
            # A fresh HUD game reverts every manual name override back to the
            # HUD value (the override is scoped to a single game).
            await cls._clear_name_overrides()
            await cls._apply_hud_game_mode(game_json)
        elif cls._game_mode_unresolved:
            # The new-game frame gave up on the mode within its budget (cold
            # start: the modes had not arrived yet). Retry on following frames,
            # or the game plays out with no stats tag — which is what "skipping
            # API stats fetch" in the log means. Only retried while the answer
            # was "we never got to look"; a genuinely unknown mode settles.
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
        # Per-game identity gate: on a new game, check the live players against
        # each bound match's fixture — raise/clear conflicts, auto-retire a
        # decided match when different players take the board. Match-agnostic
        # boards short-circuit to nogate.
        if is_new_game:
            await cls._evaluate_match_gates(parsed)
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
        scoreboards.binding.{sb}.stats_tag. This drives the stats fetch and
        updates the UI selectbox. If the id can't be resolved (unknown/inactive
        mode) the existing manual selection is left untouched.
        """
        from server.rio import stats_api  # local import avoids cycle at module load

        tag_set_id = game_json.get("tag_set")
        # Budgeted: this runs INSIDE the HUD frame handler, before the frame is
        # parsed and written to state, and under the provider lock — so an
        # unresolved tag does not merely delay itself, it holds the scoreboard
        # (and every queued frame behind it) off air. The mode is a nicety; the
        # board is the product.
        name = await stats_api.resolve_tag_set_name(
            tag_set_id, timeout=stats_api.LIVE_RESOLVE_TIMEOUT
        )
        if not name:
            # Worth another go next frame only if the modes hadn't loaded yet.
            cls._game_mode_unresolved = not stats_api.modes_ready()
            return
        cls._game_mode_unresolved = False
        from server.bindings import sync_stats_tag
        for sb in cls._hud_targets:
            # Skips a board whose mode the producer picked (server/bindings.py
            # sync_stats_tag) — an override sticks against the feed, like a name
            # override, and the console says so.
            await sync_stats_tag(sb, name)

    @classmethod
    def _is_new_game(cls, current_inning: int, game_id=None) -> bool:
        """Detect a new game: the HUD GameID changed, or the inning decreased.

        GameID is authoritative when both frames carry one — it catches a new
        game that starts in the same inning the last frame showed (a rematch
        first-inning frame after a first-inning abandon, where the inning never
        decreases). The inning fallback covers frames without ids.
        """
        if cls._prev_inning is None:
            return True
        if game_id and cls._prev_game_id and str(game_id) != str(cls._prev_game_id):
            return True
        return current_inning < cls._prev_inning

    @classmethod
    async def _clear_name_overrides(cls):
        """Drop every manual name override on the HUD-target boards.

        Called at the start of a new HUD game so a producer-pinned name reverts
        to the HUD value. Runs before the frame is applied so the fresh name
        flows through. No-op when nothing is overridden.
        """
        keys = [f"score.{sb}.player.{t}.rioName_override"
                for sb in cls._hud_targets for t in (1, 2)]
        stale = [k for k in keys if deep_get(State.state, k, "")]
        if stale:
            await State.UnsetBatch(stale)

    @classmethod
    def _swap_entrants(cls, parsed: dict) -> dict:
        """Swap entrants[0] and entrants[1] along with their scores."""
        parsed["entrants"].reverse()
        parsed["team1score"], parsed["team2score"] = parsed["team2score"], parsed["team1score"]
        return parsed

    @classmethod
    async def toggle_sides_swapped(cls):
        """Called by UI swap action to toggle the persistent swap flag.

        Serialized with _on_hud_game_update by _update_lock so the toggle +
        re-apply below is atomic w.r.t. incoming HUD frames.
        """
        async with cls._lock():
            await cls._toggle_sides_swapped_impl()

    @classmethod
    async def _toggle_sides_swapped_impl(cls):
        cls._sides_swapped = not cls._sides_swapped
        cls._user_overridden = True
        logger.info(f"[RIO] Manual swap toggled, sides_swapped={cls._sides_swapped}, user override active")

        # Re-apply current game with new swap state. A manual swap sets
        # _user_overridden, so _apply_game_to_state skips match orientation and
        # every board honors the user's flip (swaps == global state).
        #
        # A RELEASED feed takes the direct-swap branch below instead: the cached
        # frame is still there (the re-read needs it) but the producer has
        # cleared the board, so re-applying it here would resurrect a game they
        # just blanked. See _feed_released.
        if cls.hud_watcher and cls.hud_watcher.latest_game_data and not cls._feed_released:
            # Carry any manually-entered display identity (name/full_name/…) to
            # the other side BEFORE the feed re-apply. The re-apply rewrites the
            # game-derived fields (rioName, roster, scores) but never these, and
            # resurface only refills them for address-book players — so without
            # this a typed name for an UNREGISTERED player would stick to the old
            # side while their rioName moved. A registered player is re-resolved
            # from their swapped rioName in the same apply, landing on the same
            # value this pre-swap just set (no flicker).
            for sb in cls._hud_targets:
                await cls._swap_display_identity(sb)
            parsed = cls.parse_game_data(cls.hud_watcher.latest_game_data)
            parsed = cls._preserve_player_sides(parsed)
            cls.current_game = parsed
            swaps = await cls._apply_game_to_state(parsed)

            # Re-push stats with new swap state to every HUD target
            for sb in cls._hud_targets:
                await StatsTracker.push_stats_to_state(sb, swaps.get(sb, cls._sides_swapped))
        else:
            # No live HUD frame to re-orient (between games, or a paused feed) —
            # swap whatever is already on each HUD board directly, so a manual
            # swap still reaches the overlays and the UI. The address book links
            # a rioName to its full display identity, so the whole player object
            # swaps as one unit (nothing left behind); this is the single
            # authoritative swap the client now defers to entirely.
            for sb in cls._hud_targets:
                await cls._swap_current_state_sides(sb)
                StatsTracker.set_sides_swapped(sb, cls._sides_swapped)
                await StatsTracker.push_stats_to_state(sb, cls._sides_swapped)

    @classmethod
    async def _swap_display_identity(cls, sb: int) -> None:
        """Swap only the display-identity fields (name/team/full_name/pronoun/
        country/state/twitter/youtube) between the two sides of a board.

        Used by the manual swap's live-frame path: the feed re-apply carries the
        game data and address-book resurface carries registered players, but
        neither moves a manually-typed name for an UNREGISTERED player — this
        does. No-op if the board has no players.
        """
        score = State.state.get("score", {}) or {}
        sc = score.get(str(sb)) or score.get(sb) or {}
        players = sc.get("player") if isinstance(sc, dict) else None
        if not isinstance(players, dict):
            return
        p1 = players.get("1") or players.get(1) or {}
        p2 = players.get("2") or players.get(2) or {}
        entries = []
        # Carry a producer's name override with its side too, so a swap keeps the
        # pinned name attached to its content (the feed re-apply reads it back by
        # slot position). The no-frame path swaps whole player objects and gets
        # this for free.
        for f in set(_RESURFACE_MAP.values()) | {"rioName_override"}:
            entries.append((f"score.{sb}.player.1.{f}", p2.get(f, "")))
            entries.append((f"score.{sb}.player.2.{f}", p1.get(f, "")))
        if entries:
            await State.SetBatch(entries)
            await State.Save()

    @classmethod
    async def _swap_current_state_sides(cls, sb: int) -> None:
        """Swap the two sides already written to State for one HUD board.

        Used by the manual swap when no live HUD frame is available to re-orient
        from. Swaps the whole player objects (identity travels together via the
        address book), the scores, and the per-side linescores, and flips
        home_team. A no-op if the board has no score state yet.
        """
        score = State.state.get("score", {}) or {}
        sc = score.get(str(sb)) or score.get(sb) or {}
        if not isinstance(sc, dict) or not sc:
            return
        players = sc.get("player") or {}
        p1 = players.get("1") or players.get(1) or {}
        p2 = players.get("2") or players.get(2) or {}
        entries = [
            (f"score.{sb}.player.1", p2),
            (f"score.{sb}.player.2", p1),
            (f"score.{sb}.score_left", sc.get("score_right", 0)),
            (f"score.{sb}.score_right", sc.get("score_left", 0)),
            (f"score.{sb}.away_linescore", sc.get("home_linescore", [])),
            (f"score.{sb}.home_linescore", sc.get("away_linescore", [])),
            (f"score.{sb}.home_team", 1 if int(sc.get("home_team", 2) or 2) == 2 else 2),
            (f"score.{sb}.side_reason", "manual"),
        ]
        await State.SetBatch(entries)
        await State.Save()

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

        Precedence (highest first): manual > match > pin > back_to_back > none.
        A bound match encodes *both* sides, so it strictly supersedes the pin on
        that board (Phase B) — `orientation_for_sides` returns None for an
        unbound board (or one whose live players don't match the fixture), so the
        pin stays authoritative for every unbound HUD board and as the fallback
        when a bound game's players don't resolve. `reason` names the deciding
        layer (or "" when nothing governs the order) and is mirrored into
        score.{N}.side_reason. Pass `sb=None` for the global (match-agnostic)
        orientation used for back-to-back tracking; pass `allow_manual=False` to
        seed the manual base on a new game.
        """
        if allow_manual and cls._user_overridden:
            return cls._sides_swapped, "manual"
        if sb is not None:
            mo = Match.orientation_for_sides(sb, left, right)
            if mo is not None:
                return mo, "match"
        pin = cls._pin_swap(left, right)
        if pin is not None:
            return pin, "pin"
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

        if cls._is_new_game(current_inning, parsed.get("game_id")):
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

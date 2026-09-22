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
from server.rio.apply import apply_parsed_game_to_state, clear_game_entries
from server.rio.stats_tracker import StatsTracker
from server.match import Match
from server.participants import Participants
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get

# Where a hand clear's HUD release is remembered across restarts — the
# fingerprint of the frame that was on the board (see _released_frame). App-wide,
# like the HUD transport itself: one file, one cached frame.
RELEASED_FRAME_KEY = "rio_hud.released_frame"

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
        # feeds the StatFiles dir for post-game capture (server/postgame/files.py),
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


async def release_and_clear_game(scoreboard_number: int, *, reproject: bool = True) -> None:
    """Blank board ``sb`` back to a resting game, then hand it back to its fixture.

    THE RE-PROJECTION IS THE POINT, and its absence was a real bug on air. The
    Match projector owns ``score.{N}.player.{T}.*`` jointly with the feed and runs
    only on a bind or a fixture mutation — so a clear, which was ~120 plain state
    writes from the browser, blanked the bound fixture's names with nothing left to
    restore them. The board went on reporting ``M2 · Alice vs Bob`` in its fixture
    slot while the scoreboard drew no names at all, and the producer's workaround
    was to know to clear BEFORE binding and never after.

    Order matters: blank first, re-project second. The projector's feed-shared rule
    reads the board it is writing onto, and a board with no ``game_id`` is one it
    will write its full key set to — so the fixture comes back complete, picks
    included, rather than deferring to the game that was just cleared.

    On a HUD board it also RELEASES the feed. The server keeps the last frame
    Project Rio wrote (the re-read needs it), but a manual swap re-orients that
    frame and re-applies it, so clearing without releasing meant the next swap
    brought the whole game back. Clear releases, Re-read HUD restores; nothing in
    between puts the feed back on the board on its own.
    """
    from server.bindings import transport

    released: list[tuple] = []
    if transport(scoreboard_number) == "hud":
        # App-wide, like the `/rio/release` endpoint the client used to call for
        # this: there is one cached HUD frame, not one per board. The entry it
        # hands back is what keeps the clear through a restart.
        released = RioGameDataProvider.release_feed()

    await State.SetBatch(clear_game_entries(scoreboard_number) + released)
    await State.Save()

    # `reproject=False` is for a caller that is about to project anyway — today
    # `bind_board`, which clears BEFORE it writes the new `score.{N}.match`, so the
    # fixture in scope here is still the OUTGOING one. Re-projecting it would put
    # the previous match back on the board for the moment between the clear and the
    # bind, which is both wasted work and the wrong fixture.
    if not reproject:
        return
    m = Match.scoreboard_match(scoreboard_number)
    if m:
        await Match.project_scoreboard(scoreboard_number, m)
        await State.Save()


def pin_swap(left: str, right: str) -> bool | None:
    """The `pin` layer of the side cascade, for one pairing.

    True=swap, False=already correct, None=the address book has nothing to say
    about these two. `left`/`right` are raw rioNames in feed order; True means
    put `right` on side 1.

    ONE STATEMENT OF THE RULE, imported by everything that orients a pairing —
    the HUD cascade (`_decide`), the API pools, and the pool endpoint. It was
    two copies reading the same settings pair, which agreed only because neither
    had changed since they were written.

    A pin is now a fact about a PERSON (`prefs.side`), so unlike the old app-wide
    lock both players can carry one, and the two can disagree:

    - one pinned → satisfy it, whichever side of the feed they arrived on;
    - both pinned to OPPOSITE sides → they agree about the arrangement, satisfy
      both;
    - both pinned to the SAME side → unsatisfiable, so the layer ABSTAINS and
      the cascade falls through to back-to-back. Picking a winner here could
      only be arbitrary, and an arbitrary pin is worse than none: the producer
      would see one of their two pins silently lose every game. `side_reason`
      then names whatever actually decided, which is the honest answer.
    """
    want_left = Participants.PreferredSide(left)
    want_right = Participants.PreferredSide(right)
    if want_left is None and want_right is None:
        return None
    if want_left is not None and want_right is not None and want_left == want_right:
        return None
    # One of the two is set; the other, if set, is its complement. Reduce to
    # "which side does the LEFT player want" and the swap falls out.
    if want_left is None:
        want_left = 1 if want_right == 2 else 2
    return want_left == 2


def _feed_names(parsed: dict | None) -> tuple[str, str]:
    """The (left, right) rioNames of a parsed frame, in the order it carries them."""
    entrants = (parsed or {}).get("entrants") or [[{}], [{}]]
    left = entrants[0][0].get("rioName", "") if entrants[0] else ""
    right = entrants[1][0].get("rioName", "") if entrants[1] else ""
    return left, right


class RioGameDataProvider:
    """Async singleton that watches the Project Rio HUD file and pushes
    game state updates to the central State store.

    Ported from the Qt-based RioGameDataProvider with the same 3-layer
    player side preservation logic (pin, back-to-back, manual swap).
    """

    # Singleton state
    hud_watcher: HudWatcher | None = None
    current_game: dict | None = None

    # The last frame in RAW feed order (away/home as Project Rio reported it).
    # `current_game` is the same frame already globally oriented, which is the
    # wrong input to `_decide` — re-deciding a board needs the raw order back.
    _raw_game: dict | None = None

    # Cached HUD-target list — avoids re-scanning settings on every HUD event.
    # Derived transport: board 1 when project_rio.hud_enabled (see
    # server/bindings.py); refreshed in _reset_side_preservation (called
    # whenever the HUD toggle or active scoreboards change).
    _hud_targets: list[int] = []

    # True when a new-game frame could not resolve its game mode because the
    # mode list had not arrived yet (cold start). Makes the next frame try
    # again; see _apply_hud_game_mode.
    _game_mode_unresolved: bool = False
    # One-shot: look the game mode up again on the next frame even though it is
    # not a new game. Set by an explicit re-read (ReloadHudPath) — the mode is
    # only resolved on a NEW game, so Clear game (which blanks the mode with the
    # game, bindings.clear_stats_tag) then Re-read HUD brought the game back
    # with no mode: same game id, same inning, nothing asked again.
    _game_mode_resync: bool = False

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

    # ...and WHICH frame was released, so the hold survives a restart.
    #
    # `_feed_released` is memory, and the boot read (`Start`) re-applies whatever
    # is in decoded.hud.json — which after a finished game is that game's last
    # frame, forever. So clearing a board and relaunching PRSH put the cleared
    # game straight back (user report, 2026-09-18). The fingerprint is the frame's
    # `game_id:event_num`, persisted at RELEASED_FRAME_KEY: a frame that matches it
    # is the one the producer cleared, re-read from disk, and nothing but an
    # explicit re-read may apply it. A frame that DIFFERS is Project Rio writing
    # again — a new event or a new game — and takes the board back as before.
    _released_frame: str | None = None

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
        # A board cleared in a previous session stays cleared through this
        # boot's read of the same frame (see _released_frame).
        cls._released_frame = deep_get(State.state, RELEASED_FRAME_KEY) or None

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

        # Both callers are the producer asking for the feed (Re-read HUD, a new
        # HUD path), so a durable release ends here rather than holding the
        # frame they just asked for — and the game mode is looked up again,
        # since the mode is part of the game they asked to have back.
        await cls._forget_release()
        cls._game_mode_resync = True

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
        from server.postgame.watch import StatFileWatcher
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
        """Immediate one-shot read of the HUD file. Updates state and returns parsed game.

        `ReloadHudPath` already applies the frame, through the same locked path a
        watcher event takes — and ends a hand reset's hold on the board, since an
        explicit re-read is the producer asking for the feed back. This used to
        apply it a second time, outside the lock.
        """
        if await cls.ReloadHudPath():
            return cls.current_game
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
        """Convert a Project Rio game JSON into the board's state shape.

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
            # Whether the source frame was the last of its game. HUD-only: the
            # ongoing API feed has no frame to read it off, and says a game
            # ended by dropping it (`live_following`) or re-reporting it
            # completed. Defaulting False rather than omitting keeps the
            # downstream write unconditional, so the flag can never latch on
            # from a previous frame. See HudWatcher._game_over.
            data["game_over"] = bool(game_json.get("game_over", False))
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
        raw_left, raw_right = _feed_names(parsed)

        # The frame in RAW feed order, kept so one board can be re-decided later
        # without another frame (see reorient_board). `current_game` below is
        # already globally oriented, which is the wrong input for `_decide`.
        cls._raw_game = parsed

        swaps: dict[int, bool] = {}
        for sb in cls._hud_targets:
            swaps[sb] = await cls._apply_board(parsed, sb)

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

    @classmethod
    async def _apply_board(cls, parsed: dict, sb: int) -> bool:
        """Run the cascade for ONE board and write the frame in that orientation.

        Returns whether the board's sides ended up swapped, so the caller can
        push stats the same way round.
        """
        raw_left, raw_right = _feed_names(parsed)
        swapped, reason = cls._decide(raw_left, raw_right, sb=sb)
        board = cls._orient_copy(parsed) if swapped else parsed
        await apply_parsed_game_to_state(
            board, sb, home_team=1 if swapped else 2, side_reason=reason,
        )
        return swapped

    @classmethod
    async def reorient_board(cls, sb: int) -> None:
        """Re-run the cascade for one board against the frame already on air.

        The cascade normally only runs when a FRAME arrives, so a change to the
        thing it consults — binding, unbinding or flipping a match — left the
        board describing the previous decision until the feed spoke again. During
        a busy game that is one frame; between games, on a paused feed or on a
        board whose game has stopped updating, it is forever.

        What that looked like: flipping a fixture's sides moved the projected
        names but not the live team, logo and roster underneath them, so the left
        side showed one player's name over the other's logo. And unbinding left
        `side_reason` reading `match` on a board with no match — the console
        explaining an orientation by a layer that was no longer there.

        Callers on the bind/flip/unbind paths invoke this so the board settles in
        the same breath as the change. No-op for a board with no live HUD frame,
        and for a producer who has cleared the board by hand (`_feed_released`) —
        a fixture edit is not a request to bring their game back.
        """
        if sb not in cls._hud_targets or cls._feed_released or cls._raw_game is None:
            return
        swapped = await cls._apply_board(cls._raw_game, sb)
        await StatsTracker.push_stats_to_state(sb, swapped)

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
        # No re-settle needed, unlike `_unbind_board`: the gate runs after the
        # frame is applied, and a retire means the fixture's players are not in
        # it, so the match layer never seated this frame in the first place.
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
        left, right = _feed_names(parsed)

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
        left, right = _feed_names(cls.current_game)
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

    @staticmethod
    def _frame_sig(game_json: dict | None) -> str | None:
        """A frame's identity for the durable release — `game_id:event_num`."""
        if not game_json:
            return None
        gid, ev = game_json.get("game_id"), game_json.get("event_num")
        if gid in (None, "") and ev in (None, ""):
            return None
        return f"{gid}:{ev}"

    @classmethod
    def release_feed(cls) -> list[tuple]:
        """Stop treating the cached HUD frame as what is on the board.

        Called when the producer clears a HUD board by hand. See _feed_released
        and _released_frame. Returns the state entry that makes the release
        survive a restart — the caller writes it in its own batch.
        """
        if not cls._feed_released:
            logger.info("[RIO] HUD feed released — board cleared by hand")
        cls._feed_released = True
        latest = cls.hud_watcher.latest_game_data if cls.hud_watcher else None
        cls._released_frame = cls._frame_sig(latest) or cls._released_frame
        return [(RELEASED_FRAME_KEY, cls._released_frame or "")]

    @classmethod
    async def _forget_release(cls) -> None:
        """The feed is back — drop the durable hold (no-op when there is none)."""
        if cls._released_frame is None and not deep_get(State.state, RELEASED_FRAME_KEY):
            return
        cls._released_frame = None
        await State.Set(RELEASED_FRAME_KEY, "")

    @classmethod
    async def _on_hud_game_update_impl(cls, game_json: dict):
        # The frame the producer cleared, read back off disk (the boot read, or a
        # file touch that changed nothing) — hold the board empty. Only an
        # explicit re-read (ReloadHudPath) forgets the release first.
        sig = cls._frame_sig(game_json)
        if cls._released_frame and sig == cls._released_frame:
            cls._feed_released = True
            return

        # A real frame from the watcher is the feed speaking again, so it takes
        # the board back from a hand reset. The watcher is OS-event driven, so
        # this only fires when Project Rio actually rewrites the file — a reset
        # holds for as long as the game is genuinely not moving.
        cls._feed_released = False
        await cls._forget_release()

        # Check for new game before parsing (uses raw inning from game_json)
        current_inning = game_json.get("inning", 1)
        is_new_game = cls._is_new_game(current_inning, game_json.get("game_id"))

        # On a new game, auto-select the game mode from the HUD's tag set so
        # web stats fetch automatically — and the per-scoreboard game-mode
        # selectbox visually reflects the mode actually being played. Mirrors
        # the live-API assignment path, which already does this from the game's
        # mode. Done before on_new_game so its stats fetch uses the new tag.
        resync, cls._game_mode_resync = cls._game_mode_resync, False
        if is_new_game:
            # A fresh HUD game reverts every manual name override back to the
            # HUD value (the override is scoped to a single game).
            await cls._clear_name_overrides()
            await cls._apply_hud_game_mode(game_json)
        elif resync:
            # An explicit re-read of the same game (see _game_mode_resync). A
            # producer's own pick still stands — sync_stats_tag skips it.
            await cls._apply_hud_game_mode(game_json)
        elif cls._game_mode_unresolved:
            # The new-game frame gave up on the mode within its budget (cold
            # start: the modes had not arrived yet). Retry on following frames,
            # or the game plays out with no stats tag — which is what "skipping
            # API stats fetch" in the log means. Only retried while the answer
            # was "we never got to look"; a genuinely unknown mode settles.
            # NO budget here: the new-game frame already spent one, and waiting
            # again on every following frame is a stall per frame for as long as
            # Project Rio is unreachable. The shared in-flight fetch keeps
            # running; a later frame finds its answer in the cache.
            await cls._apply_hud_game_mode(game_json, budget=0)

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
        parsed = cls._preserve_player_sides(parsed, is_new_game)
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
    async def _apply_hud_game_mode(cls, game_json: dict, budget: float | None = None):
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
            tag_set_id,
            timeout=stats_api.LIVE_RESOLVE_TIMEOUT if budget is None else budget,
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
    async def release_sides_override(cls):
        """Hand the sides back to the cascade — the way out of `manual`.

        Manual outranks every other layer and nothing a producer could press
        cleared it. `_preserve_player_sides` releases the override on a NEW GAME,
        or mid-game if a second swap happens to land on exactly what the pin
        wanted — neither of which is something a producer can ASK for. So a swap
        made to fix one frame, or made before a fixture was bound, outranked that
        fixture for the rest of the game with `side_reason` reading `manual`, and
        the only control on offer was a second swap, which lands on the other
        wrong answer half the time.

        Serialized with the HUD update path by `_update_lock`, like the toggle it
        reverses.
        """
        async with cls._lock():
            await cls._release_sides_override_impl()

    @classmethod
    async def _release_sides_override_impl(cls):
        if not cls._user_overridden:
            return

        live = (
            cls.hud_watcher.latest_game_data
            if cls.hud_watcher and not cls._feed_released
            else None
        )
        if not live:
            # No frame to re-orient from — between games, a paused feed, or a
            # board the producer has cleared by hand. Drop the flag so the next
            # frame follows the cascade and leave what is on air alone: handing
            # the sides back is not a request to bring a reset game with it (the
            # same call `reorient_board` declines to make on a released feed).
            cls._user_overridden = False
            logger.info("[RIO] Sides handed back to the cascade (no live frame to re-orient)")
            return

        parsed = cls.parse_game_data(live)
        left, right = _feed_names(parsed)

        # A RELEASE IS NOT A FLIP. The toggle knows every board moves — manual
        # decides them all the same way — so it carries display identity across
        # all of them blindly. Here a match-bound board can move while the pinned
        # board beside it stays exactly where it is, so ask each board what it is
        # showing now and what the cascade wants instead, and only carry the ones
        # that actually change.
        before = {sb: cls._decide(left, right, sb=sb)[0] for sb in cls._hud_targets}

        cls._user_overridden = False
        # Reseed the manual BASE from the cascade, so the next swap flips from
        # what is now on air rather than from the orientation just abandoned —
        # the same reseed `_preserve_player_sides` does on a new game.
        cls._sides_swapped, _ = cls._decide(left, right, sb=None, allow_manual=False)
        after = {sb: cls._decide(left, right, sb=sb)[0] for sb in cls._hud_targets}
        logger.info(
            f"[RIO] Sides handed back to the cascade, sides_swapped={cls._sides_swapped}"
        )

        # Carry a manually-typed name for an UNREGISTERED player with its side,
        # before the re-apply rewrites the game-derived fields around it.
        for sb in cls._hud_targets:
            if before.get(sb) != after.get(sb):
                await cls._swap_display_identity(sb)

        parsed = cls._preserve_player_sides(parsed)
        swaps = await cls._apply_game_to_state(parsed)
        for sb in cls._hud_targets:
            await StatsTracker.push_stats_to_state(sb, swaps.get(sb, cls._sides_swapped))

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
        pin = pin_swap(left, right)
        if pin is not None:
            return pin, "pin"
        b2b = cls._b2b_swap(left, right)
        if b2b is not None:
            return b2b, "back_to_back"
        return False, ""

    @classmethod
    def _preserve_player_sides(cls, parsed: dict, is_new_game: bool | None = None) -> dict:
        """PRE-step for the side cascade — runs once per HUD event.

        Updates only the manual-override state machine; it does NOT swap
        `parsed` (per-board orientation, including pin/match/back-to-back, is
        applied in `_apply_game_to_state` via `_decide`). Returns `parsed`
        unchanged (raw away/home order). Pass `is_new_game` when the caller has
        already asked `_is_new_game` of this frame.

        - New game (inning decreased): clear the manual override and reseed the
          manual base (`_sides_swapped`) from pin→back-to-back, so a later swap-
          button click flips from the sensible default.
        - Mid-game: if the user manually swapped back to the pinned orientation,
          release the override so pin/match resume control.
        """
        left, right = _feed_names(parsed)
        if is_new_game is None:
            is_new_game = cls._is_new_game(parsed.get("inning", 1), parsed.get("game_id"))

        if is_new_game:
            cls._user_overridden = False
            cls._sides_swapped, _ = cls._decide(left, right, sb=None, allow_manual=False)
        elif cls._user_overridden:
            pin = pin_swap(left, right)
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

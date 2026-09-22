"""Writing a game into State, and clearing it again.

The two appliers — `apply_parsed_game_to_state` (a HUD or live API frame) and
`apply_completed_game_to_state` (a finished Rio record) — and their inverse,
`clear_game_entries`, which is derived from them rather than re-listed. Shared
by the HUD provider (./provider), the API pools (./game_pool) and the clear
(`release_and_clear_game`, ./provider).
"""
import re

from server.rio.pyrio.lookup import LookupDicts

from server.rio import stats_api
from server.rio.resurface import RESURFACE_MAP as _RESURFACE_MAP
from server.boards import RESTORED_AT_KEY, RESTORED_KEY
from server.match import Match
from server.participants import Participants
from server.state import State
from server.utils.deep_dict import deep_get
from server.league_logos import board_mode

_BOARD_OF_SIDE = re.compile(r"^score\.(\d+)\.player\.[12]\.rioName$")


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
    pending = dict(entries)
    additions: list[tuple] = []
    for key, value in entries:
        if not key.endswith(".rioName") or not value:
            continue
        # A league game asks the league's own book first, so its spelling of a
        # name wins in its own games (server/participants.py, "Lookup order").
        m = _BOARD_OF_SIDE.match(key)
        mode = board_mode(int(m.group(1)), pending) if m else ""
        row = Participants.resolve_for_mode(value, mode)
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


async def apply_parsed_game_to_state(parsed: dict, scoreboard_number: int, home_team: int = 2, side_reason: str = ""):
    """Write parsed game data into State under score.{scoreboard_number}.

    Shared by RioGameDataProvider (HUD) and OngoingGamePool (API).
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
        # Has the game on this board REACHED ITS END? Distinct from
        # `game_completed`, and deliberately not folded into it: that key means
        # "this slot holds a completed-game record from the API", and overlays
        # branch on it to draw final framing (scoreboard, scorecard, lower
        # third). Setting it at the last out would strip a live-looking board
        # the instant the third out lands — which is exactly the auto-clear the
        # console is built NOT to do. This key says the game is over and changes
        # nothing on air; what to do about it is the producer's call.
        #
        # Written by the HUD path only. An ongoing API game reaches this
        # function too and has no such frame to read, which is right: an ongoing
        # game that ends either drops out of the ongoing feed
        # (`live_following`) or reappears as a completed record
        # (`game_completed`). Hence the False default rather than a carry-over.
        (f"{sb}.game_over", bool(parsed.get("game_over", False))),

        # THIS FRAME IS AN EVENT, SO THE BOARD IS CURRENT. `restored` marks a game
        # that came off disk at boot rather than from a feed in this process (see
        # server/boards.py), and clearing it here is what makes the flag DECAY
        # instead of needing a producer to dismiss it: the first real frame of the
        # next game retires last night's without anyone pressing anything.
        #
        # False on every frame, including the boot read — which is why
        # `Boards.mark_restored()` runs AFTER the provider starts rather than
        # before, and why no apply path needed a new argument.
        (f"{sb}.{RESTORED_KEY}", False),
        (f"{sb}.{RESTORED_AT_KEY}", ""),

        # Per-inning runs for the box score. Reuses the same keys the completed
        # game linescore renders from, so overlays render live + final the same.
        (f"{sb}.away_linescore", left.get("inning_scores", [])),
        (f"{sb}.home_linescore", right.get("inning_scores", [])),
    ]

    eff_names: list[str] = []
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
        eff_names.append(eff_rio)
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
    entries.extend(Match.identity_entries(scoreboard_number, *eff_names))
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
    - Includes final scores, timestamps, stadium, game mode
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
        # A record fetched from the API is current, whatever its age as a GAME
        # (see the live batch above for why the flag decays here too).
        (f"{sb}.{RESTORED_KEY}", False),
        (f"{sb}.{RESTORED_AT_KEY}", ""),
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


# Nine fielding slots, in the order the diamond is written above.
_FIELD_POSITIONS = ("P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF")


def clear_game_entries(scoreboard_number: int) -> list[tuple]:
    """Every key a game writes, at its RESTING value — the inverse of BOTH
    appliers above, and deliberately next to them.

    THIS LIST EXISTED THREE TIMES AND HAD ALREADY DRIFTED. The board desk built it
    in the browser and sent ~120 keys over the socket; ``test_state_completeness``
    kept a second copy described as mirroring the first; and the live writer above
    is the third, the only one that actually defines what needs clearing. The two
    copies disagreed about ``player.{T}.name`` — and BOTH of them missed six more:
    ``full_name``, ``pronoun``, ``country``, ``state``, ``twitter`` and ``youtube``
    are written by ``_apply_resurface`` every frame and were cleared by nobody, so
    clearing a board left the previous player's pronouns and socials on air under
    whatever came next.

    So the resurface targets are DERIVED from ``RESURFACE_MAP`` rather than
    re-listed: adding an address-book field to the map now clears itself, which is
    the only way this stays true. Everything else is stated once, here.

    Pure — it builds the batch and writes nothing, so a caller can fold it into a
    batch of its own (see ``release_and_clear_game``).
    """
    base = f"score.{scoreboard_number}"
    entries: list[tuple] = [
        (f"{base}.score_left", 0),
        (f"{base}.score_right", 0),
        (f"{base}.inning", 1),
        (f"{base}.half_inning", "Top"),
        (f"{base}.outs", 0),
        (f"{base}.strikes", 0),
        (f"{base}.balls", 0),
        (f"{base}.cbRioRunnerOn1", False),
        (f"{base}.cbRioRunnerOn2", False),
        (f"{base}.cbRioRunnerOn3", False),
        (f"{base}.runner1Name", ""),
        (f"{base}.runner2Name", ""),
        (f"{base}.runner3Name", ""),
        (f"{base}.batter", ""),
        (f"{base}.pitcher", ""),
        (f"{base}.batter_hand", 0),
        (f"{base}.pitcher_hand", 0),
        (f"{base}.batterSide", "right"),
        (f"{base}.batter_roster_index", -1),
        (f"{base}.pitcher_roster_index", -1),
        (f"{base}.star_chance", False),
        (f"{base}.game_completed", False),
        (f"{base}.game_over", False),
        # A cleared board holds no game, so it cannot hold one that came off disk.
        (f"{base}.{RESTORED_KEY}", False),
        (f"{base}.{RESTORED_AT_KEY}", ""),
        (f"{base}.game_id", None),
        (f"{base}.home_team", 2),
        (f"{base}.innings_selected", None),
        (f"{base}.stadium", ""),
        (f"{base}.tag_set", None),
        # The resolved name beside tag_set's raw id. Both feeds write it, so both
        # have to be cleared or an overlay keeps naming the old mode.
        (f"{base}.game_mode", ""),
        (f"{base}.side_reason", ""),
        (f"{base}.away_linescore", []),
        (f"{base}.home_linescore", []),
    ]
    # THE COMPLETED-GAME PATH WRITES SEVEN MORE, and the clear covered none of
    # them: a board can hold either kind of game, so the inverse has to invert
    # both appliers. `innings_played` is the worst of it — the scoreboard sizes its
    # linescore from it (`linescoreColumns`), so a cleared board drew a table for
    # the game that was just cleared — and `date_time_*` is what `meta-date`
    # renders.
    entries.extend([
        (f"{base}.date_time_start", ""),
        (f"{base}.date_time_end", ""),
        (f"{base}.innings_played", 0),
        (f"{base}.winner_user", ""),
        (f"{base}.loser_user", ""),
        (f"{base}.winner_score", 0),
        (f"{base}.loser_score", 0),
    ])
    for pos in _FIELD_POSITIONS:
        entries.append((f"{base}.field.{pos}", ""))
    for team in (1, 2):
        side = f"{base}.player.{team}"
        entries.extend([
            (f"{side}.rioName", ""),
            (f"{side}.msb_team", ""),
            (f"{side}.rio_captainIndex", -1),
            (f"{side}.logo", ""),
            (f"{side}.port", None),
            (f"{side}.team_stars", 0),
            (f"{side}.batting_hands", []),
            (f"{side}.fielding_hands", []),
        ])
        # Derived, never re-listed — see the docstring.
        for target in _RESURFACE_MAP.values():
            entries.append((f"{side}.{target}", ""))
        for i in range(9):
            entries.extend([
                (f"{side}.character.{i}.name", ""),
                (f"{side}.character.{i}.is_starred", False),
                (f"{side}.character.{i}.position", ""),
            ])
    return entries

"""A game frame: one moment of a live game, in the shape the board pipeline reads.

Two sources describe a live game: the local HUD file (``pyrio.read_hud`` →
``HUDSnapshot``) and Rio web's live feed (``RioClient.live_games`` →
``LiveGame``). Both become the same flat, JSON-safe dict here, which
``RioGameDataProvider.parse_game_data`` turns into a board's state and which
the API game pool stores and broadcasts as-is.

Everything about reading Rio's data is pyrio's: which side is batting, the
fielding positions, the play a file reports, whether the game is over. This
module only lays the answers out under PRSH's frame keys:

- per side (``away`` / ``home``): ``{side}_player``, ``_score``, ``_captain``
  (roster spot), ``_stars``, ``_logo`` (team name), ``_port``,
  ``_inning_scores``, ``_fielding_positions`` (per roster spot, ``""`` for
  none), ``_defensive_diamond`` (per position P..RF, the roster spot there),
  and per roster spot ``{side}_roster_{i}_char`` (character name),
  ``_batting_hand`` / ``_fielding_hand`` (0 right, 1 left), ``_is_starred``,
  and on HUD frames ``_batting`` / ``_pitching`` (the game so far, as
  ``BattingLine`` / ``PitchingLine`` fields);
- the moment: ``inning``, ``half_inning`` (0 top, 1 bottom), ``outs``,
  ``balls``, ``strikes``, ``batter`` / ``pitcher`` (roster spots),
  ``runner_on_{first,second,third}`` and ``_roster``, ``star_chance``;
- the game: ``game_id``, ``tag_set``, ``stadium_id``, ``innings_selected``,
  ``event_num``, ``game_over``, ``play`` (the play a HUD frame reports, else
  None) and ``hit`` (its flight for the hit visualizer, else None).
"""
from __future__ import annotations

from dataclasses import asdict

from pyrio import AtBatResult, Bases, Event, Hand, HUDSnapshot, Position, Side
from pyrio.web import LiveGame

from server.rio import hit_visualizer

_SIDES = ((Side.AWAY, "away"), (Side.HOME, "home"))
_BASES = (("first", Bases.FIRST), ("second", Bases.SECOND), ("third", Bases.THIRD))


def _hand(hand: Hand | None) -> int:
    return 1 if hand is Hand.LEFT else 0


def _diamond(positions: list[Position | None]) -> list[int | None]:
    """Per position (P..RF), the roster spot playing it."""
    diamond: list[int | None] = [None] * len(Position)
    for spot, position in enumerate(positions):
        if position is not None:
            diamond[position.id] = spot
    return diamond


def play_summary(play: Event) -> dict:
    """What a container rule needs to know about a finished play.

    ``result`` is pyrio's label for it, which is Rio's own word ("HR",
    "Strikeout", "Single", …); ``server/automations.py`` maps its vocabulary
    onto those.
    """
    return {
        "result": "" if play.result is AtBatResult.NONE else play.result.label,
        "rbi": play.rbi,
        "runs": play.runs,
        "star": play.is_star_swing or play.is_star_pitch or play.is_moonshot,
    }


def frame_from_hud(hud: HUDSnapshot) -> dict:
    """The frame for a HUD file."""
    frame: dict = {
        # A string, as Rio writes it: 2.3.0's 64-bit ids don't survive a JS number.
        "game_id": None if hud.game_id is None else str(hud.game_id),
        "tag_set": hud.tag_set_id,
        "stadium_id": None if hud.stadium is None else hud.stadium.label,
        "innings_selected": hud.innings_selected,
        "event_num": f"{hud.event_number}{'b' if hud.is_play_over else ''}",
        "game_over": hud.is_game_over,
        "start_time": -1,
    }
    for side, name in _SIDES:
        team = hud.team(side)
        positions = [hud.fielding_positions.get(spot) for spot in team.roster]
        logo = hud.away_logo if side is Side.AWAY else hud.home_logo
        inning_runs = hud.away_inning_runs if side is Side.AWAY else hud.home_inning_runs
        frame.update({
            f"{name}_player": team.player,
            f"{name}_score": team.score,
            f"{name}_captain": team.captain.index,
            f"{name}_stars": hud.state.stars(side) or 0,
            f"{name}_logo": "" if logo is None else logo.label,
            f"{name}_port": hud.port(side),
            f"{name}_inning_scores": list(inning_runs or ()),
            f"{name}_fielding_positions": ["" if p is None else p.label for p in positions],
            f"{name}_defensive_diamond": _diamond(positions),
        })
        for spot in team.roster:
            prefix = f"{name}_roster_{spot.index}"
            frame.update({
                f"{prefix}_char": spot.character.label,
                f"{prefix}_batting_hand": _hand(spot.batting_hand),
                f"{prefix}_fielding_hand": _hand(spot.fielding_hand),
                f"{prefix}_is_starred": spot.is_superstar,
                f"{prefix}_batting": asdict(spot.batting),
                f"{prefix}_pitching": asdict(spot.pitching),
            })
    state = hud.state
    frame.update({
        "inning": state.inning,
        "half_inning": 0 if state.batting_side is Side.AWAY else 1,
        "outs": state.outs,
        "balls": state.balls,
        "strikes": state.strikes,
        "star_chance": state.is_star_chance,
        "batter": hud.batter_spot.index,
        "pitcher": hud.pitcher_spot.index,
    })
    on_base = {r.start_base: r.spot.index for r in hud.runners if r.start_base}
    for base, (word, _) in enumerate(_BASES, start=1):
        frame[f"runner_on_{word}"] = base in on_base
        frame[f"runner_on_{word}_roster"] = on_base.get(base, -1)
    play = hud.play
    frame["play"] = None if play is None else {"event": frame["event_num"], **play_summary(play)}
    frame["hit"] = None if play is None or hud.stadium is None else hit_visualizer.build_hit(
        play, hud.stadium
    )
    return frame


def frame_from_live(game: LiveGame) -> dict:
    """The frame for a game in Rio web's live feed.

    The feed has no game id; the game pool gives each game one. Only the
    current batter's and pitcher's game so far are reported, as
    ``batter_stats`` / ``pitcher_stats`` (``BattingLine`` / ``PitchingLine``
    fields, or ``None``).
    """
    frame: dict = {
        "tag_set": game.tag_set_id,
        "stadium_id": game.stadium.label,
        "innings_selected": game.innings_selected,
        # Unix seconds, as the feed sends it: the pool's synthetic game id hashes it.
        "start_time": int(game.start_time.timestamp()),
        "game_over": False,
        "play": None,
        "hit": None,
    }
    for side, name in _SIDES:
        team = game.team(side)
        positions = list(team.positions) or [None] * len(team.roster)
        frame.update({
            f"{name}_player": team.player,
            f"{name}_score": team.score,
            f"{name}_captain": team.captain_spot if team.captain_spot is not None else 0,
            f"{name}_stars": team.stars,
            f"{name}_logo": "" if team.logo is None else team.logo.label,
            f"{name}_port": None,
            f"{name}_inning_scores": list(team.inning_runs),
            f"{name}_fielding_positions": ["" if p is None else p.label for p in positions],
            f"{name}_defensive_diamond": _diamond(positions),
        })
        for index, character in enumerate(team.roster):
            prefix = f"{name}_roster_{index}"
            frame.update({
                f"{prefix}_char": character.label,
                # The feed reports only the batter's hand.
                f"{prefix}_batting_hand": (
                    _hand(game.batter_hand)
                    if side is game.batting_side and index == game.batter_spot
                    else 0
                ),
                f"{prefix}_fielding_hand": 0,
                f"{prefix}_is_starred": bool(team.is_superstar and team.is_superstar[index]),
            })
    frame.update({
        "inning": game.inning,
        "half_inning": 0 if game.batting_side is Side.AWAY else 1,
        "outs": game.outs,
        "balls": 0,
        "strikes": 0,
        "star_chance": game.is_star_chance,
        "batter": game.batter_spot,
        "pitcher": game.pitcher_spot,
        "batter_stats": None if game.batter_line is None else asdict(game.batter_line),
        "pitcher_stats": None if game.pitcher_line is None else asdict(game.pitcher_line),
    })
    for (word, base), spot in zip(_BASES, game.runner_spots, strict=True):
        frame[f"runner_on_{word}"] = base in game.bases
        frame[f"runner_on_{word}_roster"] = -1 if spot is None else spot
    return frame

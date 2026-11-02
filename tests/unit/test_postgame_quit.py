"""Capturing a game that was quit part way.

Runs a synthetic stat file through the real parser, because this is about what a
partial file produces. The score in a quit file is whatever it was when somebody
left, so nobody won: the box score goes on the board, the series does not move.
The filename is what says it was quit — on the pinned pyrio ``wasQuit`` is true of
every game, and "Quitter Team" stays "None" on a quit outside the pause menu.
"""
import orjson
import pytest

from server.match import Match, default_match
from server.postgame import PostGame
from server.postgame.watch import StatFileWatcher
from server.state import State
from server.utils.deep_dict import deep_get

GID = "b9ac74dcdeacc"
REST = f"20261031T130630_Alice-Vs-Bob_{GID}.json"


@pytest.fixture
def stat_dir(tmp_path, set_setting):
    set_setting("project_rio.hud_path",
                str(tmp_path / "HudFiles" / "decoded.hud.json"))
    d = tmp_path / "StatFiles" / "MarioSuperstarBaseball"
    d.mkdir(parents=True)
    return d


def character(team: str, slot: int, captain: int = 0) -> dict:
    return {
        "Team": team, "RosterID": slot, "CharID": "Yoshi", "Superstar": 0,
        "Captain": int(slot == captain), "Fielding Hand": "Right", "Batting Hand": "Left",
        "Defensive Stats": {
            "Batters Faced": 0, "Runs Allowed": 0, "Earned Runs": 0,
            "Batters Walked": 0, "Batters Hit": 0, "Hits Allowed": 0, "HRs Allowed": 0,
            "Pitches Thrown": 0, "Stamina": 10, "Was Pitcher": 0, "Strikeouts": 0,
            "Star Pitches Thrown": 0, "Big Plays": 0, "Outs Pitched": 0,
            "Batters Per Position": [], "Batter Outs Per Position": [],
            "Outs Per Position": [],
        },
        "Offensive Stats": {
            "At Bats": 0, "Hits": 0, "Singles": 0, "Doubles": 0, "Triples": 0,
            "Homeruns": 0, "Successful Bunts": 0, "Sac Flys": 0, "Strikeouts": 0,
            "Walks (4 Balls)": 0, "Walks (Hit)": 0, "RBI": 0, "Bases Stolen": 0,
            "Star Hits": 0,
        },
    }


def event(num: int, away: int, home: int) -> dict:
    return {"Event Num": num, "Inning": 2, "Half Inning": 0, "Away Score": away,
            "Home Score": home, "Star Chance": 0, "Result of AB": "None"}


def write_stat(d, prefix, *, away=4, home=1, quitter="None", events=None,
               selected=7, played=2, captain=0):
    data = {
        "GameID": GID, "Date - Start": "Sat Oct 31 13:03:47 2026",
        "Date - End": "Sat Oct 31 13:06:30 2026", "TagSetID": -1, "Netplay": 0,
        "Loaded from HUD": 0, "StadiumID": "Mario Stadium",
        "Away Player": "Alice", "Home Player": "Bob",
        "Away Score": away, "Home Score": home,
        "Innings Selected": selected, "Innings Played": played,
        "Quitter Team": quitter, "Average Ping": 0, "Lag Spikes": 0, "Version": "2.3.0",
        "Character Game Stats": {
            f"{name} Roster {slot}": character(team, slot, captain)
            for team, name in (("0", "Away"), ("1", "Home")) for slot in range(9)
        },
        "Events": [event(0, away, home)] if events is None else events,
    }
    p = d / f"{prefix}{REST}"
    p.write_bytes(orjson.dumps(data))
    return p


@pytest.fixture
async def board():
    """Board 1 carrying the game, bound to a Bo1 between Alice and Bob."""
    match = default_match()
    match["format"]["bestOf"] = 1
    match["player"]["1"]["rioName"] = "Alice"
    match["player"]["2"]["rioName"] = "Bob"
    await State.SetBatch([
        ("match.1", match),
        ("score.1.match", "1"),
        ("score.1.game_id", GID),
        ("score.1.player.1.rioName", "Alice"),
        ("score.1.player.2.rioName", "Bob"),
    ])


def series() -> tuple[int, int]:
    s = deep_get(State.state, "match.1.series") or {}
    return int(s.get("1") or 0), int(s.get("2") or 0)


@pytest.mark.parametrize("quitter", ["None", "Away", "Home"])
@pytest.mark.asyncio
async def test_a_quit_game_shows_its_score_and_crowns_nobody(stat_dir, board, quitter):
    """Alice is 4-1 up when the game stops. That goes on the board as it stood;
    it is not a win, whoever (if anyone) the file names as the quitter."""
    write_stat(stat_dir, "quit.decode.", quitter=quitter)

    result = await PostGame.capture(1)

    assert result["success"] is True
    assert result["sourceFile"] == f"quit.decode.{REST}"
    assert result["winnerSide"] == 0

    pg = deep_get(State.state, "postgame.1")
    assert pg["gameId"] == GID
    assert pg["meta"]["wasQuit"] is True
    assert pg["meta"]["quitter"] == quitter
    assert pg["meta"]["winnerSide"] == 0
    assert (pg["player"]["1"]["score"], pg["player"]["2"]["score"]) == (4, 1)
    assert pg["player"]["1"]["isWinner"] is False
    assert pg["player"]["2"]["isWinner"] is False


@pytest.mark.asyncio
async def test_a_quit_game_moves_the_match_on_but_not_the_series(stat_dir, board):
    """The game is over, so the fixture is between games. It is still undecided:
    the Bo1 has a game left to play, and the rematch is what credits it."""
    write_stat(stat_dir, "quit.decode.")

    await PostGame.capture(1)

    assert deep_get(State.state, "match.1.stage") == "post"
    assert series() == (0, 0)
    assert not deep_get(State.state, "match.1.decided")
    assert not deep_get(State.state, "match.1.credited")


@pytest.mark.asyncio
async def test_a_decoded_file_with_a_quit_twin_is_still_a_quit(stat_dir, board):
    """Earlier Project Rio writes both. Preferring the `decoded.` one must not turn
    the same game into a win that the quit file alone would not have been."""
    write_stat(stat_dir, "quit.decode.", events=[event(0, 4, 1), event(1, 4, 1)])
    write_stat(stat_dir, "decoded.")

    result = await PostGame.capture(1)

    assert result["sourceFile"] == f"decoded.{REST}"
    assert result["eventCount"] == 1
    assert result["winnerSide"] == 0
    assert deep_get(State.state, "postgame.1.meta.wasQuit") is True
    assert series() == (0, 0)


@pytest.mark.asyncio
async def test_the_watcher_captures_a_pair_once_whichever_file_it_sees_first(
    stat_dir, board,
):
    """Both files land inside one debounce, and a batch of changes has no order."""
    quit_file = write_stat(stat_dir, "quit.decode.")
    decoded = write_stat(stat_dir, "decoded.")

    await StatFileWatcher._on_file(quit_file)
    first = deep_get(State.state, "postgame.1.capturedAt")
    await StatFileWatcher._on_file(decoded)

    assert deep_get(State.state, "postgame.1.sourceFile") == decoded.name
    assert deep_get(State.state, "postgame.1.capturedAt") == first
    assert series() == (0, 0)


@pytest.mark.asyncio
async def test_a_quit_before_the_first_pitch_captures_an_empty_game(stat_dir, board):
    """No events at all, which the score and linescore code has to survive."""
    write_stat(stat_dir, "quit.decode.", away=0, home=0, events=[], played=1)

    result = await PostGame.capture(1)

    assert result["success"] is True
    assert result["eventCount"] == 0
    assert deep_get(State.state, "postgame.1.linescore") == {"1": [], "2": []}
    assert PostGame.character_abs(1, 1, 0)["success"] is True


@pytest.mark.asyncio
async def test_a_quit_with_no_rosters_set_up_is_declined_with_a_reason(stat_dir, board):
    """A quit early enough leaves no captain in the file, which pyrio refuses."""
    write_stat(stat_dir, "quit.decode.", away=0, home=0, events=[], captain=255)

    result = await PostGame.capture(1)

    assert result["success"] is False
    assert "No captain" in result["reason"]
    assert not deep_get(State.state, "postgame.1.present")


@pytest.mark.asyncio
async def test_a_quit_game_is_not_a_mercy(stat_dir, board):
    """pyrio reads a ten-run lead in a short game as a mercy, and a game left at
    12-0 in the 2nd looks just like one. The Game Summary prints that word."""
    write_stat(stat_dir, "quit.decode.", away=12, home=0)
    await PostGame.capture(1)
    assert deep_get(State.state, "postgame.1.meta.isMercy") is False


@pytest.mark.asyncio
async def test_a_finished_game_is_untouched(stat_dir, board):
    write_stat(stat_dir, "decoded.", played=7)

    result = await PostGame.capture(1)

    assert result["winnerSide"] == 1
    assert deep_get(State.state, "postgame.1.meta.wasQuit") is False
    assert deep_get(State.state, "postgame.1.player.1.isWinner") is True
    assert series() == (1, 0)


@pytest.mark.asyncio
async def test_a_rebuilt_capture_is_still_a_quit(stat_dir, board):
    """The cache rebuild after a restart re-derives the winner from the file."""
    write_stat(stat_dir, "quit.decode.")
    await PostGame.capture(1)
    PostGame._captured.pop(1, None)

    payload = PostGame.get_payload(1)

    assert payload["meta"]["winnerSide"] == 0
    assert payload["player"]["1"]["isWinner"] is False

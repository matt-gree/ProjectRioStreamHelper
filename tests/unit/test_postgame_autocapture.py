"""Auto-capture — the stat file landing IS the end-of-game signal.

``StatFileWatcher._on_file`` is the whole decision, so that is what these pin:
which board a file captures to, what makes it fire once and not per write, and
what stops it firing at all. The awatch plumbing around it is not tested — it is
the same ``watchfiles`` loop HudWatcher already runs.
"""
import orjson
import pytest

from server.postgame_watch import StatFileWatcher
from server.settings import Settings


@pytest.fixture
def stat_dir(tmp_path, set_setting):
    set_setting("project_rio.hud_path",
                str(tmp_path / "HudFiles" / "decoded.hud.json"))
    d = tmp_path / "StatFiles" / "MarioSuperstarBaseball"
    d.mkdir(parents=True)
    return d


def write_stat(d, gid, *, loaded_from_hud=0):
    p = d / f"decoded.Game_{gid}.json"
    p.write_bytes(orjson.dumps({"GameID": str(gid), "Loaded from HUD": loaded_from_hud}))
    return p


@pytest.fixture
def captures(monkeypatch):
    """Record capture() calls instead of parsing a real stat file."""
    calls = []

    async def fake_capture(sb, by="manual"):
        calls.append((sb, by))
        return {"success": True, "scoreboard": sb}

    monkeypatch.setattr("server.postgame_watch.PostGame.capture", fake_capture)
    return calls


@pytest.fixture
def boards(set_setting):
    """Two active boards carrying game ids 100 (board 1) and 200 (board 2)."""
    from server.state import State

    set_setting("scoreboards.active", [1, 2])
    State.state["score"] = {"1": {"game_id": "100"}, "2": {"game_id": 200}}


# --- which board a file captures to ---

@pytest.mark.asyncio
async def test_captures_to_the_board_carrying_that_game(stat_dir, captures, boards):
    """The file is matched to the board whose live game it is, NOT to board 1
    because it happens to be local — a two-board rig has to stay honest."""
    await StatFileWatcher._on_file(write_stat(stat_dir, 200))
    assert captures == [(2, "auto")]


@pytest.mark.asyncio
async def test_normalizes_the_id_across_feeds(stat_dir, captures, boards):
    """The HUD feed writes game_id as a string, the API path as an int. Both
    have to match a stat file's decimal GameID."""
    await StatFileWatcher._on_file(write_stat(stat_dir, 100))
    assert captures == [(1, "auto")]


@pytest.mark.asyncio
async def test_ignores_a_game_no_board_is_carrying(stat_dir, captures, boards):
    """A stat file for some earlier game (or one played while PRSH was closed)
    lands in the same directory and must not overwrite what is on air."""
    await StatFileWatcher._on_file(write_stat(stat_dir, 999))
    assert captures == []


# --- firing once ---

@pytest.mark.asyncio
async def test_fires_once_per_game_not_once_per_write(stat_dir, captures, boards):
    """A file is written in more than one syscall, so `added` is followed by
    `modified` for the same game."""
    p = write_stat(stat_dir, 100)
    await StatFileWatcher._on_file(p)
    await StatFileWatcher._on_file(p)
    assert captures == [(1, "auto")]


@pytest.mark.asyncio
async def test_a_cleared_capture_stays_cleared(stat_dir, captures, boards):
    """The producer clearing a capture they did not want must STICK: the file is
    still sitting in the directory, and any later write there would otherwise
    hand it straight back."""
    p = write_stat(stat_dir, 100)
    await StatFileWatcher._on_file(p)
    captures.clear()
    # …producer clears, then any other game's file lands in the same directory.
    await StatFileWatcher._on_file(p)
    assert captures == []


@pytest.mark.asyncio
async def test_a_declined_capture_can_be_retried(stat_dir, boards, monkeypatch):
    """The usual decline is a file still mid-write, and the `modified` event
    that follows is the retry — so a failure must not burn the game."""
    calls = []

    async def flaky(sb, by="manual"):
        calls.append(sb)
        return {"success": len(calls) > 1, "reason": "still writing"}

    monkeypatch.setattr("server.postgame_watch.PostGame.capture", flaky)
    p = write_stat(stat_dir, 100)
    await StatFileWatcher._on_file(p)
    await StatFileWatcher._on_file(p)
    assert calls == [1, 1]


# --- what stops it ---

@pytest.mark.parametrize("off", [False, "false", "False", "0", "off", ""])
@pytest.mark.asyncio
async def test_off_switch(stat_dir, captures, boards, set_setting, off):
    """Off however it was written. `PUT /settings?key=&value=` stores every value
    as a STRING, so a switch turned off through the REST route arrives as
    `"false"` — truthy, and an off switch that reads as on is worse than none."""
    set_setting("postgame.auto_capture", off)
    await StatFileWatcher._on_file(write_stat(stat_dir, 100))
    assert captures == []


@pytest.mark.parametrize("on", [True, "true", "1", "on"])
@pytest.mark.asyncio
async def test_on_however_it_was_written(stat_dir, captures, boards, set_setting, on):
    set_setting("postgame.auto_capture", on)
    await StatFileWatcher._on_file(write_stat(stat_dir, 100))
    assert captures == [(1, "auto")]


def test_on_by_default():
    """Shipped on: a producer who never finds the setting still gets the box
    score up at the final out."""
    assert Settings.Get("postgame.auto_capture") is True


@pytest.mark.asyncio
async def test_skips_a_hud_replay_file(stat_dir, captures, boards):
    """A HUD-replay file is not recorded data. find_file rejects it too — this
    only avoids burning a capture attempt on it."""
    await StatFileWatcher._on_file(write_stat(stat_dir, 100, loaded_from_hud=1))
    assert captures == []


@pytest.mark.asyncio
async def test_survives_an_unreadable_file(stat_dir, captures, boards):
    """Half-written JSON is normal in a directory being watched for writes."""
    p = stat_dir / "decoded.Game_100.json"
    p.write_bytes(b'{"GameID": "10')
    await StatFileWatcher._on_file(p)
    assert captures == []

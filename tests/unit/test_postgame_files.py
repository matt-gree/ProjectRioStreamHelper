"""postgame_files — stat-file selection for the post-game capture.

Pins the capture gate: a file is usable only when its **in-file** GameID
matches the just-finished game AND ``Loaded from HUD == 0``. The filename
GameID is a pre-filter only — a renamed or stale file must never slip through
on name alone.
"""
import os
import time

import orjson
import pytest

from server.postgame import files as pgf


# --- norm_game_id ---

@pytest.mark.parametrize("raw, expected", [
    (None, ""),
    ("", ""),
    (123456, "123456"),
    ("123456", "123456"),
    ("1,234,567", "1234567"),      # HUD feed writes comma-grouped strings
    ("  42 ", "42"),
])
def test_norm_game_id_canonicalizes_all_sources(raw, expected):
    assert pgf.norm_game_id(raw) == expected


# --- stat_dir resolution ---

def test_stat_dir_is_sibling_of_configured_hud_path(tmp_path, set_setting):
    set_setting("project_rio.hud_path",
                str(tmp_path / "HudFiles" / "decoded.hud.json"))
    # why: the HUD file itself may not exist right after a game ends —
    # resolution must not gate on existence.
    assert pgf.stat_dir() == tmp_path / "StatFiles" / "MarioSuperstarBaseball"


def test_stat_dir_honours_the_env_override_above_the_setting(tmp_path, set_setting, monkeypatch):
    """``PRSH_HUD_FILE`` is authoritative here exactly as it is in
    ``provider.get_user_hud_path`` — auto-capture WATCHES this directory, so an
    isolated agent/CI instance resolving past the override would sit on the
    developer's real Project Rio folder and capture their live games."""
    set_setting("project_rio.hud_path", str(tmp_path / "configured" / "decoded.hud.json"))
    monkeypatch.setenv("PRSH_HUD_FILE", str(tmp_path / "iso" / "HudFiles" / "decoded.hud.json"))
    assert pgf.stat_dir() == tmp_path / "iso" / "StatFiles" / "MarioSuperstarBaseball"


def test_stat_dir_falls_back_to_os_default_when_unset():
    from server.rio.provider import get_default_hud_file_path
    expected = (get_default_hud_file_path().parent.parent
                / "StatFiles" / "MarioSuperstarBaseball")
    assert pgf.stat_dir() == expected


# --- fixtures: a fake StatFiles dir ---

@pytest.fixture
def stat_dir(tmp_path, set_setting):
    set_setting("project_rio.hud_path",
                str(tmp_path / "HudFiles" / "decoded.hud.json"))
    d = tmp_path / "StatFiles" / "MarioSuperstarBaseball"
    d.mkdir(parents=True)
    return d


def write_stat(d, gid, *, name=None, loaded_from_hud=0, in_file_gid=None,
               age=0, **fields):
    """A decoded stat file; ``age`` seconds pushes its mtime into the past."""
    data = {"GameID": str(in_file_gid if in_file_gid is not None else gid),
            "Loaded from HUD": loaded_from_hud, **fields}
    p = d / (name or f"decoded.Game_{gid}.json")
    p.write_bytes(orjson.dumps(data))
    if age:
        t = time.time() - age
        os.utime(p, (t, t))
    return p


# --- candidate_files (filename pre-filter) ---

def test_candidates_empty_when_dir_missing(tmp_path, set_setting):
    set_setting("project_rio.hud_path",
                str(tmp_path / "HudFiles" / "decoded.hud.json"))
    assert pgf.candidate_files("42") == []


def test_candidates_filter_by_filename_gameid(stat_dir):
    keep = write_stat(stat_dir, 42)
    write_stat(stat_dir, 99)
    write_stat(stat_dir, 42, name="notdecoded_42.json")   # wrong prefix
    (stat_dir / "decoded.noid.json").write_bytes(b"{}")   # no trailing _<digits>
    assert pgf.candidate_files("42") == [keep]


def test_candidates_newest_first(stat_dir):
    old = write_stat(stat_dir, 42, name="decoded.old_42.json", age=100)
    new = write_stat(stat_dir, 42, name="decoded.new_42.json")
    assert pgf.candidate_files("42") == [new, old]


# --- find_file (the authoritative gate) ---

def test_find_file_no_game_id_yet(stat_dir):
    path, reason = pgf.find_file("")
    assert path is None and "No game id" in reason


def test_find_file_no_candidates(stat_dir):
    path, reason = pgf.find_file("42")
    assert path is None and "No stat file found" in reason


def test_find_file_matches_in_file_gameid(stat_dir):
    p = write_stat(stat_dir, 42)
    path, reason = pgf.find_file("42")
    assert (path, reason) == (p, None)


def test_find_file_rejects_filename_match_with_wrong_in_file_gameid(stat_dir):
    # why: the filename is a pre-filter only — a renamed/copied file whose
    # payload belongs to a different game must not be captured.
    write_stat(stat_dir, 42, in_file_gid=999)
    path, reason = pgf.find_file("42")
    assert path is None and "No usable stat file" in reason


def test_find_file_rejects_hud_replay(stat_dir):
    write_stat(stat_dir, 42, loaded_from_hud=1)
    path, reason = pgf.find_file("42")
    assert path is None and "HUD replay" in reason


def test_find_file_prefers_real_recording_over_newer_replay(stat_dir):
    real = write_stat(stat_dir, 42, name="decoded.real_42.json", age=100)
    write_stat(stat_dir, 42, name="decoded.replay_42.json", loaded_from_hud=1)
    path, reason = pgf.find_file("42")
    assert (path, reason) == (real, None)


def test_find_file_skips_unreadable_json_and_continues(stat_dir):
    good = write_stat(stat_dir, 42, name="decoded.good_42.json", age=100)
    (stat_dir / "decoded.corrupt_42.json").write_bytes(b"not json")
    path, reason = pgf.find_file("42")
    assert (path, reason) == (good, None)


def test_find_file_normalizes_comma_grouped_hud_gameid(stat_dir):
    p = write_stat(stat_dir, 1234567)
    path, reason = pgf.find_file("1,234,567")
    assert (path, reason) == (p, None)


# --- list_files (manual pick) ---

def test_list_files_empty_when_dir_missing(tmp_path, set_setting):
    set_setting("project_rio.hud_path",
                str(tmp_path / "HudFiles" / "decoded.hud.json"))
    assert pgf.list_files() == []


def test_list_files_descriptors_newest_first_skipping_replays(stat_dir):
    write_stat(stat_dir, 1, name="decoded.a_1.json", age=200,
               **{"Away Player": "A", "Home Player": "B",
                  "Away Score": 3, "Home Score": 5, "Date - End": "d1"})
    write_stat(stat_dir, 2, name="decoded.b_2.json", age=100, loaded_from_hud=1)
    write_stat(stat_dir, 3, name="decoded.c_3.json",
               **{"Away Player": "C", "Home Player": "D"})
    (stat_dir / "decoded.bad_4.json").write_bytes(b"nope")

    out = pgf.list_files()
    assert [d["gameId"] for d in out] == ["3", "1"]
    assert out[1] == {
        "file": "decoded.a_1.json", "gameId": "1",
        "awayPlayer": "A", "homePlayer": "B",
        "awayScore": 3, "homeScore": 5, "endDate": "d1",
    }


def test_list_files_respects_limit(stat_dir):
    for i in range(5):
        write_stat(stat_dir, i, name=f"decoded.g_{i}.json", age=i)
    assert len(pgf.list_files(limit=2)) == 2


# --- resolve_pick: the producer's override ---------------------------------
#
# The escape hatch for a game the automatic match cannot find. It takes a
# filename off a query string, so it is the one place in this module handling
# untrusted input.


def test_a_picked_file_is_captured_without_the_game_id_match(stat_dir):
    """The whole point of the override. `find_file` refuses a file whose GameID
    is not the board's — which is exactly the situation a producer reaches for
    this in."""
    picked = write_stat(stat_dir, 42)
    path, reason = pgf.resolve_pick(picked.name)
    assert (path, reason) == (picked.resolve(), None)


def test_a_pick_still_refuses_a_hud_replay(stat_dir):
    """Not a policy gate — such a file has no recorded stats in it, so accepting
    one trades a clear refusal for an empty box score."""
    replay = write_stat(stat_dir, 42, loaded_from_hud=1)
    path, reason = pgf.resolve_pick(replay.name)
    assert path is None
    assert "HUD replay" in reason


@pytest.mark.parametrize("attempt", [
    "../../../../etc/passwd",
    "..\\..\\secrets.json",
    "/etc/passwd",
    "subdir/../../escape.json",
])
def test_a_pick_cannot_escape_the_stat_directory(stat_dir, attempt):
    """Traversal cannot survive the basename, so these land as a missing file
    inside the folder rather than as a read outside it."""
    path, reason = pgf.resolve_pick(attempt)
    assert path is None
    assert reason


def test_a_pick_cannot_follow_a_symlink_out_of_the_folder(stat_dir, tmp_path):
    """The basename defeats traversal; this is what the resolved-parent check is
    for. A name with no separators in it can still point anywhere."""
    outside = tmp_path / "elsewhere.json"
    outside.write_bytes(orjson.dumps({"GameID": "42", "Loaded from HUD": 0}))
    link = stat_dir / "decoded.Game_42.json"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable")
    path, reason = pgf.resolve_pick(link.name)
    assert path is None
    assert "not in Project Rio" in reason


@pytest.mark.parametrize("empty", ["", "   ", None])
def test_an_empty_pick_is_refused_rather_than_falling_back(stat_dir, empty):
    """A blank name must not resolve to the directory itself, or to whatever the
    automatic match would have picked — a silent fallback would make the
    override's failure indistinguishable from its success."""
    path, reason = pgf.resolve_pick(empty)
    assert path is None
    assert reason


def test_a_pick_that_is_not_there_says_so(stat_dir):
    path, reason = pgf.resolve_pick("decoded.Game_999.json")
    assert path is None
    assert "999" in reason


# --- which selector a capture runs -----------------------------------------
#
# The branch itself, without standing up a parseable stat file: a capture with
# no `file` must go through the game-id match, and one WITH a file must not —
# re-applying that check would lock the escape hatch from the inside.


@pytest.mark.asyncio
async def test_capture_matches_by_game_id_when_no_file_is_picked(monkeypatch):
    from server.postgame import PostGame
    from server.state import State

    State.state["score"] = {"1": {"game_id": "42"}}
    seen = {}
    monkeypatch.setattr(pgf, "find_file",
                        lambda gid: (seen.update(find=gid), (None, "stop"))[1])
    monkeypatch.setattr(pgf, "resolve_pick",
                        lambda name: (seen.update(pick=name), (None, "stop"))[1])

    await PostGame.capture(1)

    assert seen == {"find": "42"}


@pytest.mark.asyncio
async def test_a_picked_file_bypasses_the_game_id_match_entirely(monkeypatch):
    from server.postgame import PostGame
    from server.state import State

    # A board on a DIFFERENT game — the mismatch is the situation the override
    # exists for, so the game id must not reach the selector at all.
    State.state["score"] = {"1": {"game_id": "42"}}
    seen = {}
    monkeypatch.setattr(pgf, "find_file",
                        lambda gid: (seen.update(find=gid), (None, "stop"))[1])
    monkeypatch.setattr(pgf, "resolve_pick",
                        lambda name: (seen.update(pick=name), (None, "stop"))[1])

    await PostGame.capture(1, file="decoded.Game_999.json")

    assert seen == {"pick": "decoded.Game_999.json"}


@pytest.mark.asyncio
async def test_a_refused_pick_reports_its_reason_rather_than_falling_back(monkeypatch):
    """A failed override must not quietly capture the automatically-matched game
    instead — that would make its failure indistinguishable from its success."""
    from server.postgame import PostGame
    from server.state import State

    State.state["score"] = {"1": {"game_id": "42"}}
    monkeypatch.setattr(pgf, "find_file", lambda gid: (_ for _ in ()).throw(
        AssertionError("fell back to the automatic match")))
    monkeypatch.setattr(pgf, "resolve_pick", lambda name: (None, "nope"))

    result = await PostGame.capture(1, file="decoded.Game_999.json")

    assert result["success"] is False
    assert result["reason"] == "nope"

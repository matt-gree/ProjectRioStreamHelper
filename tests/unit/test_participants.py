"""Participant registry — matching, start.gg upsert, and backup import/merge.

The registry is the join point for Match/Commentary/PlayerPlates/Matchup, so a
silent regression here mis-identifies people across every projected element.
Locks the two matchers (casefold rioName; startgg userId), the enrich-don't-
overwrite rule on re-import, and ImportRows' merge semantics (non-empty display
wins, identities only fill empty, id collisions regenerate).
"""
from server.participants import Participants


def _seed(pid, rio="", tag="", startgg_uid=None, **display):
    row = Participants._normalize({
        "id": pid,
        "identities": {
            "rioName": rio,
            "startgg": {"userId": startgg_uid} if startgg_uid else None,
        },
        "display": {"tag": tag, **display},
    }, pid)
    Participants.participants[pid] = row
    return row


# --- matchers ---

def test_match_by_rioname_is_case_insensitive_and_trimmed():
    _seed("p_1", rio="MattGree")
    assert Participants.MatchByRioName("  mattgree ")["id"] == "p_1"


def test_match_by_rioname_none_on_empty_or_miss():
    _seed("p_1", rio="MattGree")
    assert Participants.MatchByRioName("") is None
    assert Participants.MatchByRioName("   ") is None
    assert Participants.MatchByRioName("nobody") is None


def test_match_by_startgg_exact_userid_only():
    _seed("p_1", startgg_uid=42)
    assert Participants.MatchByStartGG(42)["id"] == "p_1"
    assert Participants.MatchByStartGG(43) is None
    assert Participants.MatchByStartGG(None) is None
    assert Participants.MatchByStartGG("") is None


# --- UpsertFromStartGG ---

async def test_upsert_creates_row_with_startgg_source_and_empty_rioname():
    row = await Participants.UpsertFromStartGG({
        "userId": 7, "gamerTag": "Zed", "prefix": "TSM", "pronoun": "he/him",
    })
    assert row["meta"]["source"] == "startgg"
    assert row["display"]["tag"] == "Zed"
    assert row["display"]["prefix"] == "TSM"
    # why: rioName is the local join key — start.gg never sets it; the user maps it.
    assert row["identities"]["rioName"] == ""
    assert row["identities"]["startgg"]["userId"] == 7


async def test_upsert_reimport_fills_empty_but_never_overwrites():
    _seed("p_1", startgg_uid=7, tag="ManualTag")
    row = await Participants.UpsertFromStartGG({
        "userId": 7, "gamerTag": "NewTag", "pronoun": "she/her",
    })
    assert row["id"] == "p_1"
    assert row["display"]["tag"] == "ManualTag"   # manual edit preserved
    assert row["display"]["pronoun"] == "she/her"  # empty field enriched


async def test_upsert_matches_gamertag_against_rioname_when_no_userid_link():
    # why: a player-only entrant (no start.gg account) still de-dupes against a
    # manually-created row whose rioName equals the gamerTag.
    _seed("p_1", rio="Zed")
    row = await Participants.UpsertFromStartGG({"userId": 7, "gamerTag": "Zed"})
    assert row["id"] == "p_1"
    assert row["identities"]["startgg"]["userId"] == 7


# --- ImportRows (backup restore) ---

def _export_row(pid, rio="", tag="", startgg_uid=None, **display):
    return {
        "id": pid,
        "identities": {
            "rioName": rio,
            "startgg": {"userId": startgg_uid} if startgg_uid else None,
        },
        "display": {"tag": tag, **display},
    }


async def test_import_replace_wipes_then_loads_exact_rows():
    _seed("p_old", rio="OldGuy")
    out = await Participants.ImportRows(
        [_export_row("p_new", rio="NewGuy", tag="NG")], replace=True)
    assert out == {"imported": 1, "created": 1, "updated": 0}
    assert set(Participants.participants) == {"p_new"}


async def test_import_merge_matches_by_startgg_userid_then_rioname():
    _seed("p_1", startgg_uid=7, tag="")
    _seed("p_2", rio="RioB", tag="")
    out = await Participants.ImportRows([
        _export_row("x_1", startgg_uid=7, tag="ViaUserId"),
        _export_row("x_2", rio="riob", tag="ViaRio"),  # casefold match
    ])
    assert out == {"imported": 2, "created": 0, "updated": 2}
    assert Participants.participants["p_1"]["display"]["tag"] == "ViaUserId"
    assert Participants.participants["p_2"]["display"]["tag"] == "ViaRio"


async def test_import_merge_display_nonempty_wins_but_empty_keeps_local():
    _seed("p_1", rio="RioA", tag="LocalTag", pronoun="they/them")
    await Participants.ImportRows(
        [_export_row("x_1", rio="RioA", tag="BackupTag", pronoun="")])
    row = Participants.participants["p_1"]
    assert row["display"]["tag"] == "BackupTag"        # non-empty incoming wins
    assert row["display"]["pronoun"] == "they/them"    # empty incoming keeps local


async def test_import_merge_identities_fill_empty_never_rewrite():
    # why: rioName is the join key — a restore must never rewrite it on a
    # matched row, only fill it where the local row had none.
    _seed("p_1", startgg_uid=7, rio="LocalRio")
    _seed("p_2", rio="RioB")
    await Participants.ImportRows([
        _export_row("x_1", startgg_uid=7, rio="BackupRio"),
        _export_row("x_2", rio="RioB", startgg_uid=99),
    ])
    assert Participants.participants["p_1"]["identities"]["rioName"] == "LocalRio"
    assert Participants.participants["p_2"]["identities"]["startgg"]["userId"] == 99


async def test_import_unmatched_row_with_colliding_id_gets_new_id():
    _seed("p_1", rio="Existing")
    out = await Participants.ImportRows([_export_row("p_1", rio="SomeoneElse")])
    assert out["created"] == 1
    assert Participants.participants["p_1"]["identities"]["rioName"] == "Existing"
    new_ids = [pid for pid in Participants.participants if pid != "p_1"]
    assert len(new_ids) == 1
    assert Participants.participants[new_ids[0]]["identities"]["rioName"] == "SomeoneElse"


async def test_import_skips_non_dict_rows_and_non_list_input():
    assert await Participants.ImportRows("nope") == \
        {"imported": 0, "created": 0, "updated": 0}
    out = await Participants.ImportRows(["junk", _export_row("p_9", rio="OK")])
    assert out["created"] == 1


async def test_export_import_round_trip():
    _seed("p_1", rio="RioA", tag="A", startgg_uid=7)
    snapshot = Participants.Export()
    Participants.participants = {}
    out = await Participants.ImportRows(snapshot["participants"], replace=True)
    assert out["created"] == 1
    row = Participants.participants["p_1"]
    assert row["identities"]["rioName"] == "RioA"
    assert row["display"]["tag"] == "A"

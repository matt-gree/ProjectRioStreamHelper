"""Participant registry — matching, start.gg upsert, and backup import/merge.

The registry is the join point for Match/Commentary/PlayerPlates/Matchup, so a
silent regression here mis-identifies people across every projected element.
Locks the two matchers (casefold rioName; startgg userId), the enrich-don't-
overwrite rule on re-import, and ImportRows' merge semantics (non-empty display
wins, identities only fill empty, id collisions regenerate).
"""
import pytest

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
    # A direct write goes around the class's own mutators, so it maintains the
    # join-key indexes itself — the same obligation `pin_player` has in conftest.
    Participants._index_row(row)
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


async def _bound_match(pid, sb=1):
    """A match whose side 1 resolves to `pid`, projected onto board `sb`."""
    from server.match import Match, default_match
    from server.state import State

    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["participantId"] = pid
    await State.Set(f"match.{m}", match)
    await State.Set(f"score.{sb}.match", m)
    await Match.project_scoreboard(sb, m)
    return m


# --- reprojection fan-out ---
#
# The registry is the join point, and the projectors are resolve-by-COPY: they
# read a row once and write the result into the keys overlays render. That is
# why an overlay never re-resolves — and why the copies go stale the moment the
# book changes. Each projector re-projected on its own config change and at
# boot, but nothing re-projected when the thing they all resolve AGAINST
# changed, so a producer correcting a name mid-broadcast watched the Address
# Book update and the overlay keep the old one until the next launch.

async def test_editing_a_participant_reflows_the_bound_match(set_setting):
    """The typo-fix case, end to end: the copy in `score.{N}` follows the book."""
    from server.state import State

    _seed("p_1", rio="MattGree", tag="OldTag")
    await _bound_match("p_1")
    assert State.state["score"]["1"]["player"]["1"]["name"] == "OldTag"

    await Participants.Update("p_1", {"display": {"tag": "NewTag"}})

    assert State.state["score"]["1"]["player"]["1"]["name"] == "NewTag"


async def test_deleting_a_participant_blanks_what_it_had_filled():
    """A deleted row is still COPIED into every projection that resolved it.

    Blanking is the honest answer — the projectors write their full key set,
    value or "" — because the alternative is an overlay naming somebody who is
    no longer in the book at all.
    """
    from server.state import State

    _seed("p_1", rio="MattGree", tag="Gone")
    await _bound_match("p_1")
    assert State.state["score"]["1"]["player"]["1"]["name"] == "Gone"

    await Participants.Delete("p_1")

    assert State.state["score"]["1"]["player"]["1"]["name"] == ""


async def test_a_replace_import_reflows_every_dependent():
    """`replace=True` wipes the book, so every copy resolved against a registry
    that no longer exists. One fan-out after the batch, not one per row."""
    from server.state import State

    _seed("p_1", rio="MattGree", tag="Before")
    await _bound_match("p_1")

    await Participants.ImportRows([], replace=True)

    assert State.state["score"]["1"]["player"]["1"]["name"] == ""


async def test_matchup_tags_follow_the_book_without_refetching_its_games():
    """The head-to-head band is a FETCHED artifact, so it has no cheap full
    re-projection and is absent from the boot pass. Only `side{1,2}.tag` comes
    out of the book, and the payload remembers its match — so a book edit
    re-resolves those two fields and leaves the fetched half alone."""
    from server.match import Match, default_match
    from server.state import State

    _seed("p_1", rio="MattGree", tag="Old")
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["participantId"] = "p_1"
    await State.Set(f"match.{m}", match)
    await State.Set("matchup", {
        "present": True, "matchId": m,
        "side1": {"rioName": "MattGree", "tag": "Old", "wins": 0},
        "side2": {"rioName": "Other", "tag": "X", "wins": 0},
        "games": [], "totalGames": 0,
    })

    await Participants.Update("p_1", {"display": {"tag": "New"}})

    assert State.state["matchup"]["side1"]["tag"] == "New"
    assert State.state["matchup"]["totalGames"] == 0   # no refetch


# --- production prefs: the side pin ---

async def test_preferred_side_reads_the_pin_case_insensitively():
    _seed("p_1", rio="MattGree", tag="Matt")
    await Participants.Update("p_1", {"prefs": {"side": 2}})
    assert Participants.PreferredSide("mattgree") == 2


def test_preferred_side_is_none_for_an_unpinned_or_unknown_person():
    _seed("p_1", rio="MattGree", tag="Matt")
    assert Participants.PreferredSide("MattGree") is None
    assert Participants.PreferredSide("Nobody") is None
    assert Participants.PreferredSide("") is None


async def test_an_unparseable_side_is_no_pin_at_all():
    """A pin that half-parses would silently orient a broadcast, so anything
    that isn't 1 or 2 — a legacy "Team 1" string, a 0 from a form, junk from a
    hand-edited backup — is normalized to no preference."""
    _seed("p_1", rio="MattGree", tag="Matt")
    for junk in ("Team 1", 0, 3, "", None, "left", {}):
        await Participants.Update("p_1", {"prefs": {"side": junk}})
        assert Participants.PreferredSide("MattGree") is None


async def test_normalize_keeps_a_stored_pin_across_a_reload():
    row = Participants._normalize(
        {"id": "p_1", "identities": {"rioName": "Zoe"}, "prefs": {"side": 2}}, "p_1")
    assert row["prefs"]["side"] == 2


# --- the one-shot migration off the global Player Lock ---

async def test_adopt_legacy_pin_moves_the_setting_onto_an_existing_person(set_setting):
    from server.settings import Settings

    _seed("p_1", rio="MattGree", tag="Matt")
    set_setting("project_rio.pinned_player", "MattGree")
    set_setting("project_rio.pinned_side", "Team 2")

    assert await Participants.adopt_legacy_pin() is True
    assert Participants.PreferredSide("MattGree") == 2
    # Cleared, so a second boot can't re-run it over a producer's later edit.
    assert Settings.Get("project_rio.pinned_player") == ""


async def test_adopt_legacy_pin_adds_someone_the_book_never_had(set_setting):
    """Dropping the pin because the producer never added that person to the book
    would be a silent regression — the old lock never required a row."""
    set_setting("project_rio.pinned_player", "Ghost")
    set_setting("project_rio.pinned_side", "Team 1")

    assert await Participants.adopt_legacy_pin() is True
    assert Participants.PreferredSide("Ghost") == 1
    assert Participants.MatchByRioName("Ghost") is not None


async def test_adopt_legacy_pin_is_a_no_op_with_nothing_pinned():
    assert await Participants.adopt_legacy_pin() is False
    assert Participants.participants == {}


async def test_import_merge_refreshes_a_pin_but_no_preference_defers():
    """Prefs refresh like display (incoming non-empty wins), not fill-empty like
    identities — a backup's pin is the producer's own most recent answer, while
    `None` means the backup has no opinion."""
    _seed("p_1", rio="Zoe", tag="Zoe")
    await Participants.Update("p_1", {"prefs": {"side": 1}})

    await Participants.ImportRows([
        {"identities": {"rioName": "Zoe"}, "display": {"tag": "Zoe"}, "prefs": {"side": 2}},
    ])
    assert Participants.PreferredSide("Zoe") == 2

    await Participants.ImportRows([
        {"identities": {"rioName": "Zoe"}, "display": {"tag": "Zoe"}},
    ])
    assert Participants.PreferredSide("Zoe") == 2


# --- the join-key indexes ---------------------------------------------------
#
# `MatchByRioName` is the side cascade's `pin` resolver and runs per HUD frame;
# `MatchByStartGG` is the inner loop of the import merge. Both were linear scans
# and are now dict hits, so what needs pinning is that the index and the book
# cannot disagree — every mutation path, and the tie-break the scan had.


def _scan_by_rio(rio_name):
    """The linear scan the index replaced, kept as the oracle."""
    needle = (rio_name or "").strip().casefold()
    if not needle:
        return None
    for row in Participants.participants.values():
        existing = (row.get("identities") or {}).get("rioName") or ""
        if existing.strip().casefold() == needle:
            return row
    return None


def test_the_index_agrees_with_the_scan_it_replaced():
    for i in range(50):
        _seed(f"p{i}", rio=f"Player{i}", tag=f"Player{i}")
    for probe in ["Player0", "player49", "  PLAYER25  ", "nobody", ""]:
        assert Participants.MatchByRioName(probe) == _scan_by_rio(probe), probe


def test_duplicate_rionames_resolve_to_the_earliest_row():
    """The scan walked insertion order and returned the first match, so a book
    holding one rioName twice has a defined answer — `setdefault`, not the last
    write. Nothing forbids the duplicate, so the tie-break is behaviour."""
    first = _seed("p1", rio="Alice", tag="Alice")
    _seed("p2", rio="alice", tag="Alice Again")
    assert Participants.MatchByRioName("ALICE") is first


@pytest.mark.asyncio
async def test_a_created_row_is_findable_immediately():
    row = await Participants.Create({
        "identities": {"rioName": "Nova"}, "display": {"tag": "Nova"},
    })
    assert Participants.MatchByRioName("nova") is row


@pytest.mark.asyncio
async def test_renaming_drops_the_old_key_and_adds_the_new_one():
    """The one mutation that has to REMOVE an index entry. An add-only index
    would keep answering on the old name forever."""
    row = await Participants.Create({"identities": {"rioName": "OldName"}})
    await Participants.Update(row["id"], {"identities": {"rioName": "NewName"}})

    assert Participants.MatchByRioName("OldName") is None
    assert Participants.MatchByRioName("NewName") is row


@pytest.mark.asyncio
async def test_a_deleted_row_leaves_no_index_entry():
    row = await Participants.Create({"identities": {"rioName": "Gone"}})
    await Participants.Delete(row["id"])

    assert Participants.MatchByRioName("Gone") is None
    assert Participants._by_rio == {}


@pytest.mark.asyncio
async def test_a_batch_dedupes_against_rows_created_earlier_in_itself():
    """Why created rows are indexed INSIDE the import loop: the second copy of
    one person has to match the first, which exists only in this batch."""
    await Participants.ImportRows([
        _export_row("a1", rio="Twin", tag="Twin"),
        _export_row("a2", rio="twin", tag="Twin Refreshed"),
    ])

    assert len(Participants.participants) == 1
    assert Participants.MatchByRioName("Twin")["display"]["tag"] == "Twin Refreshed"


@pytest.mark.asyncio
async def test_a_replace_import_forgets_the_book_it_wiped():
    _seed("old", rio="Ghost", tag="Ghost")
    await Participants.ImportRows([_export_row("new", rio="Fresh", tag="Fresh")],
                                  replace=True)

    assert Participants.MatchByRioName("Ghost") is None
    assert Participants.MatchByRioName("Fresh") is not None


@pytest.mark.asyncio
async def test_a_startgg_link_added_to_an_existing_row_becomes_findable():
    """`UpsertFromStartGG`'s matched branch stamps a join key onto a row that
    had none — the de-dupe for every later entrant in the same import."""
    _seed("p1", rio="Casey", tag="Casey")
    await Participants.UpsertFromStartGG({"userId": 4242, "gamerTag": "Casey"})

    assert Participants.MatchByStartGG(4242)["id"] == "p1"


@pytest.mark.asyncio
async def test_a_reload_rebuilds_the_index_from_disk():
    await Participants.Create({"identities": {"rioName": "Persisted"}})
    Participants.participants = {}
    Participants._reindex()
    await Participants.Load()

    assert Participants.MatchByRioName("Persisted") is not None


@pytest.mark.asyncio
async def test_a_failed_load_leaves_the_index_agreeing_with_the_book():
    """The reindex sits OUTSIDE the try, so whatever a failed load leaves in
    `participants` is what the index describes.

    A corrupt file does NOT empty the registry — `Load` only assigns on success,
    so the previous book survives (the "starting empty" in its log line is
    describing a cold start, not this path). The invariant under test is
    therefore agreement, not emptiness: asserting the book was cleared would be
    asserting a behaviour this class does not have.
    """
    _seed("stale", rio="Stale", tag="Stale")
    async with Participants._out.open(mode="wb") as f:
        await f.write(b"{not json")
    await Participants.Load()

    assert Participants.MatchByRioName("Stale") is _scan_by_rio("Stale")
    assert len(Participants._by_rio) == len(Participants.participants)


def test_an_unhashable_startgg_id_does_not_break_the_rebuild():
    """A corrupt record is not a reason to fail the load that is indexing it."""
    Participants.participants["bad"] = {
        "id": "bad",
        "identities": {"rioName": "Fine", "startgg": {"userId": ["not", "hashable"]}},
        "display": {}, "prefs": {}, "meta": {},
    }
    Participants._reindex()

    assert Participants.MatchByRioName("Fine") is not None
    assert Participants.MatchByStartGG(["not", "hashable"]) is None


# --- the display block is exactly what a scoreboard can draw ---

def test_every_display_field_has_a_scoreboard_target():
    """A `display.*` key with no entry in RESURFACE_MAP is a field nothing can
    put on air.

    `display` is the resolve-by-copy payload — the projectors' whole job is to
    copy it into `score.{N}.player.{T}.*` — so a key the map does not name is a
    value a producer can type and never see. `mainCharacter` was the single
    exception for a long time and was removed on 2026-09-15 (MSB drafts a team
    per game; it had no "main" to record), which is what makes this an equality
    and not a subset: the next field added to either side has to be added to
    both, or it is decoration.
    """
    from server.participants import _DISPLAY_DEFAULTS
    from server.rio.resurface import RESURFACE_MAP

    assert set(_DISPLAY_DEFAULTS) == set(RESURFACE_MAP)


def test_a_retired_display_field_is_dropped_off_a_stored_row():
    """No migration needed, in either direction.

    `_merge_block` keeps only keys the defaults name, so a `participants.json`
    written before a field was retired loses it the next time it is loaded —
    and `Commentary._normalize_slot` independently drops a `subField` naming it.
    Both halves self-heal, which is why retiring a display field is a supported
    move rather than a schema bump.
    """
    row = Participants._normalize(
        {"id": "p_old", "display": {"tag": "Alice", "mainCharacter": "Yoshi"}},
        "p_old",
    )

    assert "mainCharacter" not in row["display"]
    assert row["display"]["tag"] == "Alice"


async def test_a_startgg_import_reprojects_once_for_the_batch(monkeypatch):
    """Every projector writes its full key set, so the import fans out once for
    the whole event. New entrants went through Create, which fanned out per row
    as well — a 64-player first import re-projected 65 times."""
    from server.api.v1.participants import StartGGImportPayload, import_startgg

    calls = []

    async def count():
        calls.append(1)

    monkeypatch.setattr(Participants, "reproject_dependents", count)
    await import_startgg(StartGGImportPayload(players=[
        {"userId": 1, "gamerTag": "Ann"},
        {"userId": 2, "gamerTag": "Ben"},
        {"userId": 3, "gamerTag": "Cy"},
    ]))
    assert len(Participants.participants) == 3
    assert len(calls) == 1

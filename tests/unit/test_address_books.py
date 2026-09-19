"""Address books (participants schema v2): several books, league links, logos.

A league book is linked to Rio game modes, and each person in it may carry a
logo; that logo reaches the board only while the board's game is in the
league. Pins the lookup order (main wins a book-less lookup, a league game asks
its own book first), the on-air hook (`server/league_logos.py`), sharing — a
book is a zip of `book.json` + real logo files, and an old JSON file (inline
data URIs, or logos hung off TEAMS) still opens — and the one-time move of a
team-era book's logos onto its players.
"""
import base64
import io
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.api import router_v1
from server.league_logos import LeagueLogos
from server.participants import MAIN_BOOK, Participants
from server.settings import Settings
from server.state import State

PNG = b"\x89PNG\r\n\x1a\nNNL-LOGO"


async def _league(name="NNL", modes=("NNL Season 7",)):
    return await Participants.CreateBook({"name": name, "modes": list(modes)})


async def _player(book, rio, logo=PNG, **display):
    row = await Participants.Create({
        "book": book["id"], "identities": {"rioName": rio}, "display": display,
    })
    if logo:
        await Participants.SetLogo(row["id"], logo, "image/png")
    return row


def _board(sb=1, p1="", p2="", mode=""):
    State.state.setdefault("score", {})[str(sb)] = {
        "game_mode": mode,
        "player": {"1": {"rioName": p1}, "2": {"rioName": p2}},
    }


def _client():
    app = FastAPI()
    app.include_router(router_v1)
    return TestClient(app)


async def _fresh_machine(monkeypatch, tmp_path):
    Participants.participants, Participants.books = {}, {}
    Participants._ensure_main()
    Participants._reindex()
    monkeypatch.setattr(Participants, "_logos_dir", tmp_path / "elsewhere")


# --- the model ---------------------------------------------------------------

async def test_a_v1_file_loads_into_the_main_book(isolate_user_data):
    (isolate_user_data / "participants.json").write_text(json.dumps({
        "version": 1,
        "participants": {"p_1": {"id": "p_1", "identities": {"rioName": "Alice"}}},
    }))
    await Participants.Load()
    assert list(Participants.books) == [MAIN_BOOK]
    row = Participants.Get("p_1")
    assert (row["book"], row["logo"]) == (MAIN_BOOK, "")


async def test_a_team_era_book_moves_its_logos_onto_the_players(isolate_user_data):
    folder = Participants._logos_dir / "b_nnl"
    folder.mkdir(parents=True)
    (folder / "t_1.png").write_bytes(PNG)
    (folder / "t_orphan.png").write_bytes(b"nobody")
    (isolate_user_data / "participants.json").write_text(json.dumps({
        "version": 2,
        "books": {"b_nnl": {"name": "NNL", "modes": ["NNL Season 7"], "teams": {
            "t_1": {"name": "Mercs", "logo": "t_1.png", "logoRev": 3},
            "t_orphan": {"name": "Empty", "logo": "t_orphan.png"},
        }}},
        "participants": {"p_a": {"id": "p_a", "book": "b_nnl", "team": "t_1",
                                 "identities": {"rioName": "Alice"}}},
    }))
    await Participants.Load()
    row = Participants.Get("p_a")
    assert (row["logo"], row["logoRev"]) == ("p_a.png", 4)
    assert "team" not in row and "teams" not in Participants.books["b_nnl"]
    assert sorted(f.name for f in folder.iterdir()) == ["p_a.png"]
    # Saved in the new shape, so the move happens once.
    saved = json.loads((isolate_user_data / "participants.json").read_text())
    assert "teams" not in saved["books"]["b_nnl"]


async def test_a_bookless_lookup_prefers_main_and_a_booked_one_asks_only_that_book():
    book = await _league()
    league_row = await _player(book, "Alice", logo=None, tag="Al")
    # Someone kept only in a league book still resurfaces everywhere...
    assert Participants.MatchByRioName("alice")["id"] == league_row["id"]
    main_row = await Participants.Create({"identities": {"rioName": "Alice"}})
    # ...but once main has them, main answers a lookup that names no book.
    assert Participants.MatchByRioName("alice")["id"] == main_row["id"]
    assert Participants.MatchByRioName("alice", book=book["id"])["id"] == league_row["id"]
    assert Participants.resolve_for_mode("Alice", "nnl season 7")["id"] == league_row["id"]
    assert Participants.resolve_for_mode("Alice", "Ranked")["id"] == main_row["id"]


async def test_a_logo_is_one_file_per_person_and_goes_with_them():
    book = await _league()
    row = await _player(book, "Alice")
    first = Participants._logos_dir / book["id"] / row["logo"]
    assert first.read_bytes() == PNG and row["logoRev"] == 1
    await Participants.SetLogo(row["id"], b"<svg/>", "image/svg+xml")
    assert row["logo"] == f"{row['id']}.svg" and not first.exists()
    url = Participants.logo_url(row)
    assert url == f"/branding/leagues/{book['id']}/{row['id']}.svg?v=2"
    # Moving book moves the file; deleting the person deletes it.
    other = await Participants.CreateBook({"name": "Other"})
    await Participants.Update(row["id"], {"book": other["id"]})
    moved = Participants._logos_dir / other["id"] / row["logo"]
    assert moved.is_file()
    await Participants.Delete(row["id"])
    assert not moved.exists()


async def test_main_cannot_be_deleted_and_a_league_book_takes_its_people_with_it():
    book = await _league()
    await _player(book, "Bob")
    keep = await Participants.Create({"identities": {"rioName": "Carol"}})
    assert await Participants.DeleteBook(MAIN_BOOK) is False
    assert await Participants.DeleteBook(book["id"]) is True
    assert [r["id"] for r in Participants.List()] == [keep["id"]]
    assert not (Participants._logos_dir / book["id"]).exists()


async def test_a_logo_rejects_what_an_overlay_cannot_draw():
    book = await _league()
    row = await _player(book, "Alice", logo=None)
    with pytest.raises(ValueError):
        await Participants.SetLogo(row["id"], b"x", "application/pdf")


async def test_one_mode_claimed_twice_goes_to_the_older_book():
    first = await _league("First")
    await _league("Second")
    assert Participants.book_for_mode("NNL Season 7")["id"] == first["id"]
    assert Participants.book_for_mode("") is None


# --- on air ------------------------------------------------------------------

async def test_a_league_game_puts_the_players_logo_on_the_board():
    book = await _league()
    alice = await _player(book, "Alice")
    _board(p1="Alice", p2="Bob")
    LeagueLogos.Start()
    await State.SetBatch([("score.1.game_mode", "NNL Season 7")])
    side = State.state["score"]["1"]["player"]
    assert State.state["score"]["1"]["league"] == "NNL"
    assert side["1"]["league_logo"] == Participants.logo_url(alice)
    # Bob is not in the league book: blank, not someone else's logo.
    assert side["2"]["league_logo"] == ""

    # Leaving the league blanks exactly what it wrote.
    await State.SetBatch([("score.1.game_mode", "Ranked")])
    assert State.state["score"]["1"]["league"] == ""
    assert side["1"]["league_logo"] == ""


async def test_a_new_player_on_the_side_re_resolves_in_the_same_batch():
    book = await _league()
    carol = await _player(book, "Carol")
    _board(p1="Alice", mode="NNL Season 7")
    LeagueLogos.Start()
    await State.SetBatch([("score.1.player.1.rioName", "carol")])
    assert State.state["score"]["1"]["player"]["1"]["league_logo"] == Participants.logo_url(carol)


async def test_a_producers_mode_pick_outranks_the_feed_and_settles_the_board():
    book = await _league()
    alice = await _player(book, "Alice")
    _board(p1="Alice", mode="Ranked")
    LeagueLogos.Start()
    await Settings.Set("scoreboards.binding.1.stats_tag", "NNL Season 7")
    await Settings.Set("scoreboards.binding.1.stats_tag_manual", True)
    assert State.state["score"]["1"]["player"]["1"]["league_logo"] == Participants.logo_url(alice)


async def test_a_replaced_logo_reaches_a_board_already_showing_it():
    book = await _league()
    alice = await _player(book, "Alice")
    _board(p1="Alice", mode="NNL Season 7")
    LeagueLogos.Start()
    await LeagueLogos.project_all()
    await Participants.SetLogo(alice["id"], b"\x89PNG-2", "image/png")
    assert State.state["score"]["1"]["player"]["1"]["league_logo"].endswith("?v=2")


def test_resurface_uses_the_leagues_own_row_in_its_games():
    """Its tag AND its prefix — the prefix is how a league shows a team name."""
    from server.rio.provider import _apply_resurface

    Participants.books["b_x"] = {"id": "b_x", "name": "NNL", "modes": ["NNL Season 7"], "community": ""}
    for pid, bk, tag, prefix in (("p_m", MAIN_BOOK, "MainTag", "SPONSOR"), ("p_l", "b_x", "LeagueTag", "Mercs")):
        Participants.participants[pid] = Participants._normalize(
            {"id": pid, "book": bk, "identities": {"rioName": "Alice"},
             "display": {"tag": tag, "prefix": prefix}}, pid,
        )
    Participants._reindex()

    league = [("score.1.game_mode", "NNL Season 7"), ("score.1.player.1.rioName", "Alice")]
    _apply_resurface(league)
    assert (dict(league)["score.1.player.1.name"], dict(league)["score.1.player.1.team"]) == ("LeagueTag", "Mercs")

    ranked = [("score.1.game_mode", "Ranked"), ("score.1.player.1.rioName", "Alice")]
    _apply_resurface(ranked)
    assert dict(ranked)["score.1.player.1.team"] == "SPONSOR"


# --- sharing -----------------------------------------------------------------

async def test_a_shared_book_is_a_zip_of_json_and_real_logo_files(tmp_path, monkeypatch):
    book = await _league()
    await _player(book, "Alice", tag="Al")
    data = Participants.ExportZip(book["id"])

    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert sorted(z.namelist()) == ["book.json", "logos/al.png"]
        assert z.read("logos/al.png") == PNG
        meta = json.loads(z.read("book.json"))
    # The JSON names the logo by its path in the zip — no image bytes inside.
    assert meta["participants"][0]["logo"] == "logos/al.png"

    await _fresh_machine(monkeypatch, tmp_path)
    result = await Participants.ImportAsNewBook(*Participants.ReadZip(data))
    new = Participants.GetBook(result["book"])
    assert (new["name"], new["modes"]) == ("NNL", ["NNL Season 7"])
    row = Participants.MatchByRioName("Alice", book=new["id"])
    assert row["display"]["tag"] == "Al"
    assert (tmp_path / "elsewhere" / new["id"] / row["logo"]).read_bytes() == PNG


@pytest.mark.parametrize("shape", ["data-uri", "team-era"])
async def test_an_older_json_book_still_opens_with_its_logos(tmp_path, monkeypatch, shape):
    await _fresh_machine(monkeypatch, tmp_path)
    uri = "data:image/png;base64," + base64.b64encode(PNG).decode()
    if shape == "data-uri":
        legacy = {"book": {"name": "NNL"}, "participants": [{"identities": {"rioName": "Alice"}, "logo": uri}]}
    else:
        legacy = {
            "book": {"name": "NNL", "teams": [{"id": "t_old", "name": "Mercs", "logo": uri}]},
            "participants": [{"identities": {"rioName": "Alice"}, "team": "t_old"}],
        }
    result = await Participants.ImportAsNewBook(legacy)
    row = Participants.MatchByRioName("Alice", book=result["book"])
    assert (tmp_path / "elsewhere" / result["book"] / row["logo"]).read_bytes() == PNG


@pytest.mark.parametrize("build, message", [
    (lambda z: z.writestr("other.json", "{}"), "No book.json"),
    (lambda z: z.writestr("book.json", "not json"), "not valid JSON"),
])
def test_a_zip_that_is_not_a_book_is_refused(build, message):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        build(z)
    with pytest.raises(ValueError, match=message):
        Participants.ReadZip(buf.getvalue())
    with pytest.raises(ValueError, match="Not a zip"):
        Participants.ReadZip(b"hello")


def test_a_zip_only_yields_the_logos_its_book_names_and_skips_oversized_ones(monkeypatch):
    import server.participants as mod

    monkeypatch.setattr(mod, "LOGO_MAX_BYTES", 8)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("book.json", json.dumps({"participants": [
            {"logo": "logos/a.png"}, {"logo": "logos/huge.png"}, {"logo": "../../etc/passwd"},
        ]}))
        z.writestr("logos/a.png", b"tiny")
        z.writestr("logos/huge.png", b"x" * 100)
        z.writestr("logos/unnamed.png", b"stray")
    _payload, files = Participants.ReadZip(buf.getvalue())
    assert files == {"logos/a.png": b"tiny"}


async def test_importing_into_a_book_merges_and_replace_is_per_book():
    book = await _league()
    keep = await Participants.Create({"identities": {"rioName": "MainOnly"}})
    old = await _player(book, "Old")
    old_file = Participants._logos_dir / book["id"] / old["logo"]
    await Participants.ImportRows([{"identities": {"rioName": "New"}}], replace=True, book=book["id"])
    assert Participants.Get(keep["id"]) is not None
    assert Participants.MatchByRioName("Old", book=book["id"]) is None
    assert not old_file.exists()
    assert Participants.MatchByRioName("New", book=book["id"]) is not None


# --- pulling a Rio community -------------------------------------------------

async def test_a_community_pull_is_additive_and_borrows_what_main_knows():
    book = await Participants.CreateBook({"name": "NNL"})
    await Participants.Create({"identities": {"rioName": "rjb"}, "display": {"tag": "RJB", "twitter": "@rjb"}})
    first = await Participants.AddPlayers(
        book["id"], ["rjb", "MattGree", " ", 7], community="National Netplay League",
        modes=["NNL Season 10", "NNL S10 Training"],
    )
    assert (first["added"], first["kept"]) == (2, 0)
    row = Participants.MatchByRioName("rjb", book=book["id"])
    assert row["display"]["tag"] == "RJB" and row["display"]["twitter"] == "@rjb"
    assert row["logo"] == ""
    assert book["community"] == "National Netplay League"
    assert book["modes"] == ["NNL Season 10", "NNL S10 Training"]

    # A re-pull brings in only who is new, and never overwrites a league link
    # the producer already chose.
    await Participants.UpdateBook(book["id"], {"modes": ["NNL Season 10"]})
    again = await Participants.AddPlayers(book["id"], ["rjb", "Newbie"], modes=["Other"])
    assert (again["added"], again["kept"]) == (1, 1)
    assert book["modes"] == ["NNL Season 10"]


def test_the_community_endpoint_says_where_its_players_came_from(monkeypatch):
    from server.rio import stats_api

    async def roster(name):
        if name != "National Netplay League":
            raise LookupError(name)
        return {"community": name, "modes": ["NNL Season 10"], "usernames": ["rjb", "MattGree"],
                "source": "games", "note": "private"}

    monkeypatch.setattr(stats_api, "fetch_community_roster", roster)
    c = _client()
    book = c.post("/api/v1/participants/books", json={"name": "NNL"}).json()
    r = c.post(f"/api/v1/participants/books/{book['id']}/community",
               json={"community": "National Netplay League"}).json()
    assert (r["added"], r["found"], r["source"], r["modes"]) == (2, 2, "games", ["NNL Season 10"])
    assert c.post(f"/api/v1/participants/books/{book['id']}/community",
                  json={"community": "Nope"}).status_code == 404


# --- API ---------------------------------------------------------------------

def test_the_book_api_end_to_end():
    c = _client()
    book = c.post("/api/v1/participants/books", json={"name": "NNL", "modes": ["NNL Season 7"]}).json()
    row = c.post("/api/v1/participants", json={"book": book["id"], "identities": {"rioName": "A"}}).json()
    up = c.post(f"/api/v1/participants/{row['id']}/logo", files={"file": ("a.png", PNG, "image/png")}).json()
    assert up["logo"] == f"{row['id']}.png"
    books = c.get("/api/v1/participants/books").json()
    assert [b["id"] for b in books][0] == MAIN_BOOK
    assert next(b for b in books if b["id"] == book["id"])["count"] == 1

    z = c.get(f"/api/v1/participants/books/{book['id']}/export.zip")
    assert z.headers["content-type"] == "application/zip"
    assert 'filename="nnl.prsh-book.zip"' in z.headers["content-disposition"]
    opened = c.post("/api/v1/participants/books/import/file",
                    files={"file": ("nnl.prsh-book.zip", z.content, "application/zip")}).json()
    assert opened["created"] == 1 and opened["book"] != book["id"]
    into = c.post(f"/api/v1/participants/import/file?target={book['id']}",
                  files={"file": ("nnl.prsh-book.zip", z.content, "application/zip")}).json()
    assert into["updated"] == 1
    assert c.post("/api/v1/participants/books/import/file",
                  files={"file": ("x.txt", b"nope", "text/plain")}).status_code == 400
    assert c.delete(f"/api/v1/participants/{row['id']}/logo").json()["logo"] == ""
    assert c.delete(f"/api/v1/participants/books/{MAIN_BOOK}").status_code == 400
    assert c.delete(f"/api/v1/participants/books/{book['id']}").status_code == 200

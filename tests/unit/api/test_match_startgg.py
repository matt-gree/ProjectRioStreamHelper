"""start.gg → Match loading: apply_startgg_set (seating, bestOf import, series
seeding) and the match-first /startgg/load-set route (reuse-by-setId + bind)."""
import orjson
import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock

from server.api.v1.match import apply_startgg_set
from server.api.v1 import startgg as startgg_api
from server.match import Match, default_match
from server.state import State
from server.utils.deep_dict import deep_get


def sgg_set(**over):
    """A GetSet result shaped like _parse_set_full's output."""
    s = {
        "id": 555,
        "team1score": None,
        "team2score": None,
        "round_name": "Winners Round 2",
        "round": 2,
        "totalGames": 3,
        "tournament_phase": "Bracket",
        "bracket_type": "DOUBLE_ELIMINATION",
        "entrants": [
            [{"gamerTag": "Alice", "prefix": "", "playerId": 1, "userId": 101}],
            [{"gamerTag": "Bob", "prefix": "", "playerId": 2, "userId": 102}],
        ],
        "entrant_ids": [11, 22],
    }
    s.update(over)
    return s


async def make_match() -> int:
    m = Match.next_id()
    await State.Set(f"match.{m}", default_match())
    return m


# The @method decorator registers the handler on the router without returning
# it, so fetch the endpoint back off the route table to call it directly.
startgg_load_set = next(
    r.endpoint for r in startgg_api.router.routes if r.path == "/startgg/load-set"
)


# --- apply_startgg_set ---

@pytest.mark.asyncio
async def test_apply_seats_players_label_bestof_setid():
    m = await make_match()
    await apply_startgg_set(m, sgg_set(), 555)

    match = Match.get(m)
    assert match["label"] == "Winners Round 2"
    assert match["format"]["bestOf"] == 3
    assert deep_get(match, "provider.startgg.setId") == 555
    # Both sides seated with registry rows carrying the start.gg identity.
    for side, tag in (("1", "Alice"), ("2", "Bob")):
        pid = match["player"][side]["participantId"]
        assert pid
        from server.participants import Participants
        row = Participants.Get(pid)
        assert (row["identities"]["startgg"] or {}).get("gamerTag") == tag


@pytest.mark.asyncio
async def test_apply_seeds_series_and_decides_on_clinch():
    m = await make_match()
    await apply_startgg_set(m, sgg_set(team1score=2, team2score=1), 555)

    match = Match.get(m)
    assert match["series"] == {"1": 2, "2": 1}
    assert match["decided"] == 1  # 2 wins clinches a Bo3


@pytest.mark.asyncio
async def test_apply_mid_series_score_does_not_decide():
    m = await make_match()
    await apply_startgg_set(m, sgg_set(team1score=1, team2score=1, totalGames=5), 555)

    match = Match.get(m)
    assert match["series"] == {"1": 1, "2": 1}
    assert match["decided"] is None


@pytest.mark.asyncio
async def test_apply_skips_wl_and_dq_scores():
    m = await make_match()
    await apply_startgg_set(m, sgg_set(team1score="W", team2score="L"), 555)
    assert Match.get(m)["series"] == {"1": 0, "2": 0}

    await apply_startgg_set(m, sgg_set(team1score=-1, team2score=0), 555)
    assert Match.get(m)["series"] == {"1": 0, "2": 0}


@pytest.mark.asyncio
async def test_apply_never_stomps_existing_decided():
    m = await make_match()
    await State.Set(f"match.{m}.decided", 2)
    await apply_startgg_set(m, sgg_set(team1score=2, team2score=0), 555)

    match = Match.get(m)
    assert match["series"] == {"1": 2, "2": 0}
    assert match["decided"] == 2  # producer's flag survives the seed


@pytest.mark.asyncio
async def test_apply_missing_bestof_keeps_existing_format():
    m = await make_match()
    await State.Set(f"match.{m}.format.bestOf", 5)
    await apply_startgg_set(m, sgg_set(totalGames=None), 555)
    assert Match.get(m)["format"]["bestOf"] == 5


@pytest.mark.asyncio
async def test_apply_zero_totalgames_keeps_existing_format():
    m = await make_match()
    await State.Set(f"match.{m}.format.bestOf", 5)
    await apply_startgg_set(m, sgg_set(totalGames=0), 555)
    assert Match.get(m)["format"]["bestOf"] == 5


@pytest.mark.asyncio
async def test_apply_even_totalgames_bumped_to_next_odd():
    # _need() (server/match.py) decides a series by majority (bestOf//2+1);
    # an even bestOf has no majority and can end all-square. Normalize to
    # the next odd number so the series is always decidable.
    m = await make_match()
    await apply_startgg_set(m, sgg_set(totalGames=4), 555)
    assert Match.get(m)["format"]["bestOf"] == 5


@pytest.mark.asyncio
async def test_apply_odd_totalgames_unchanged():
    m = await make_match()
    await apply_startgg_set(m, sgg_set(totalGames=3), 555)
    assert Match.get(m)["format"]["bestOf"] == 3


# --- /startgg/load-set (match-first) ---

@pytest.mark.asyncio
async def test_load_set_creates_match_and_binds_board(monkeypatch):
    from server.startgg import provider
    monkeypatch.setattr(provider.StartGGProvider, "GetSet",
                        AsyncMock(return_value=sgg_set()))

    resp = await startgg_load_set(set_id=555, scoreboard_number=2)
    body = orjson.loads(resp.body)
    assert body["success"] is True

    m = body["match"]
    assert deep_get(State.state, f"score.2.match") == m
    assert deep_get(Match.get(m), "provider.startgg.setId") == 555
    # Projection landed: the round label drives the board's phase display.
    assert deep_get(State.state, "score.2.phase") == "Winners Round 2"


@pytest.mark.asyncio
async def test_load_set_reuses_match_holding_the_set(monkeypatch):
    from server.startgg import provider
    monkeypatch.setattr(provider.StartGGProvider, "GetSet",
                        AsyncMock(return_value=sgg_set()))

    first = orjson.loads((await startgg_load_set(set_id=555, scoreboard_number=2)).body)
    second = orjson.loads((await startgg_load_set(set_id=555, scoreboard_number=3)).body)

    assert first["match"] == second["match"]
    assert len(State.state.get("match", {})) == 1
    # A match fills exactly ONE board, so the second load MOVES it — this route
    # used to write score.{N}.match directly and leave the set on both boards,
    # which is two boards claiming one game. It goes through bind_board now.
    assert Match.bound_scoreboards(first["match"]) == [3]
    assert deep_get(State.state, "score.2.match") is None
    # The vacated board is blanked, not left showing the fixture it no longer has.
    assert deep_get(State.state, "score.2.phase") == ""


@pytest.mark.asyncio
async def test_load_set_rejects_rotating_set_board(monkeypatch):
    import server.bindings
    monkeypatch.setattr(server.bindings, "is_rotating", lambda sb: True)

    with pytest.raises(HTTPException) as exc:
        await startgg_load_set(set_id=555, scoreboard_number=2)
    assert exc.value.status_code == 409
    assert not State.state.get("match")  # nothing created

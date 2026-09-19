"""start.gg → Match loading: apply_startgg_set (seating, bestOf import, series
seeding). Reuse-by-setId is /match/from-startgg's."""
import pytest

from server.api.v1.match import apply_startgg_set
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

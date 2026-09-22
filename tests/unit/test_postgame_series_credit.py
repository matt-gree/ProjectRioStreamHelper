"""Crediting the series from a captured box score.

THE STAGE HOP AND THE CREDIT ARE TWO THINGS. `_promote_match` nested the second
inside the first — `if stage != "post": set stage; credit` — which reads as a
once-per-game guard and is a once-per-MATCH one. Game 2 of a Bo3 arrives with the
match already at `post`, so it was skipped in silence: the series could never get
past 1-0, never decide, and the board sat on "between games" forever. The same
skip swallowed every re-capture after a first one that could not resolve a winner
(a quit game reports no `winnerSide`), which is how a Bo1 ends a night at 0-0
with three captured games behind it.

`award_game`'s `game_id` dedup is the real once-per-game guard, and it is durable
now (`match.{m}.credited`) — which is what lets the stage guard go, since the
class-level set it replaced could not survive the restart the stage guard was
covering for.
"""
import pytest

from server.match import Match, default_match
from server.postgame import PostGame
from server.state import State
from server.utils.deep_dict import deep_get


async def bind(sb: int = 1, best_of: int = 3) -> int:
    m = Match.next_id()
    match = default_match()
    match["format"]["bestOf"] = best_of
    match["player"]["1"]["rioName"] = "Alice"
    match["player"]["2"]["rioName"] = "Bob"
    await State.SetBatch([(f"match.{m}", match), (f"score.{sb}.match", m)])
    return m


def capture(game_id: str, winner_side: int | None, sb: int = 1) -> None:
    """Stand in for a captured stat file: `_promote_match` reads the cache."""
    PostGame._captured[sb] = {
        "gameId": game_id,
        "meta": {"winnerSide": winner_side},
        "player": {"1": {"rioName": "Alice"}, "2": {"rioName": "Bob"}},
    }


def series(m) -> tuple[int, int]:
    s = deep_get(State.state, f"match.{m}.series") or {}
    return int(s.get("1") or 0), int(s.get("2") or 0)


@pytest.mark.asyncio
async def test_every_game_of_a_series_is_credited_not_just_the_first():
    m = await bind(best_of=3)

    capture("G1", 1)
    await PostGame._promote_match(1)
    assert series(m) == (1, 0)
    assert deep_get(State.state, f"match.{m}.stage") == "post"

    # The match is ALREADY at `post` now — which is precisely the state the old
    # guard read as "nothing left to do".
    capture("G2", 2)
    await PostGame._promote_match(1)
    assert series(m) == (1, 1)

    capture("G3", 2)
    await PostGame._promote_match(1)
    assert series(m) == (1, 2)
    assert deep_get(State.state, f"match.{m}.decided") == 2


@pytest.mark.asyncio
async def test_a_capture_with_no_winner_does_not_strand_the_next_one():
    """A quit game reports no `winnerSide`. It credits nothing — correctly — but
    it used to move the stage, and the stage was the gate, so the RE-CAPTURE that
    followed (or the next game) could never credit either."""
    m = await bind(best_of=1)

    capture("G1", None)
    await PostGame._promote_match(1)
    assert series(m) == (0, 0)
    assert deep_get(State.state, f"match.{m}.stage") == "post"

    capture("G1", 2)
    await PostGame._promote_match(1)
    assert series(m) == (0, 1)
    assert deep_get(State.state, f"match.{m}.decided") == 2


@pytest.mark.asyncio
async def test_recapturing_the_same_game_never_double_credits():
    m = await bind(best_of=3)
    capture("G1", 1)
    await PostGame._promote_match(1)
    await PostGame._promote_match(1)
    await PostGame._promote_match(1)
    assert series(m) == (1, 0)


@pytest.mark.asyncio
async def test_the_dedup_outlives_the_process():
    """The record is on the match, so it is in `state.json` — a re-capture after
    a restart is an ordinary recovery press and must stay a no-op. The class-level
    set this replaced was empty on boot, which is why the stage guard was doing
    this job (and breaking the Bo3 to do it)."""
    m = await bind(best_of=3)
    capture("G1", 1)
    await PostGame._promote_match(1)
    assert deep_get(State.state, f"match.{m}.credited.G1") == 1

    # Nothing in memory to consult — exactly what a fresh process has.
    PostGame._captured.clear()
    capture("G1", 1)
    await PostGame._promote_match(1)
    assert series(m) == (1, 0)


# ----- the doubleheader ------------------------------------------------------

@pytest.mark.asyncio
async def test_a_doubleheader_is_taken_by_winning_both_games():
    """A DH is `bestOf: 2`, and the clinch majority (`bestOf // 2 + 1`) already
    reads that as "win both" — so a sweep decides it with no second code path."""
    m = await bind(best_of=2)

    capture("G1", 2)
    await PostGame._promote_match(1)
    assert series(m) == (0, 1)
    assert deep_get(State.state, f"match.{m}.decided") is None

    capture("G2", 2)
    await PostGame._promote_match(1)
    assert series(m) == (0, 2)
    assert deep_get(State.state, f"match.{m}.decided") == 2


@pytest.mark.asyncio
async def test_a_split_doubleheader_has_no_winner_and_never_decides():
    """The difference between a DH and a Bo3, and the reason the console counts
    games played rather than waiting on `decided` (see `seriesContinues` in
    public/layout/lib/match-format.js): 1-1 is complete, and nobody took it."""
    m = await bind(best_of=2)

    capture("G1", 1)
    await PostGame._promote_match(1)
    capture("G2", 2)
    await PostGame._promote_match(1)

    assert series(m) == (1, 1)
    assert deep_get(State.state, f"match.{m}.decided") is None


@pytest.mark.asyncio
async def test_a_split_doubleheader_is_finished_even_though_nobody_won_it():
    """`decided` is the record of a WINNER; `is_complete` is the record of the
    END. They are the same for every odd format and come apart for a DH, which
    is complete after two games however they fall. Everything that asked
    `decided` to mean "finished" — the identity gate's auto-retire, the Up-next
    reason, the console's handover — would otherwise read a split as still
    running."""
    m = await bind(best_of=2)
    assert Match.is_complete(m) is False

    capture("G1", 1)
    await PostGame._promote_match(1)
    assert Match.is_complete(m) is False        # one game in, one to play

    capture("G2", 2)
    await PostGame._promote_match(1)
    assert series(m) == (1, 1)
    assert deep_get(State.state, f"match.{m}.decided") is None
    assert Match.is_complete(m) is True


@pytest.mark.asyncio
async def test_a_bo1_whose_game_never_credited_still_has_its_game_to_give():
    """The carve-out at the other end: a quit game reports no winner, so nothing
    is credited and the fixture is NOT complete — its game is still to come as
    far as the model knows, and a re-capture can still decide it."""
    m = await bind(best_of=1)
    capture("G1", None)
    await PostGame._promote_match(1)
    assert Match.is_complete(m) is False


@pytest.mark.asyncio
async def test_a_finished_fixture_does_not_credit_another_game():
    """A SERIES NEVER HOLDS MORE GAMES THAN ITS FORMAT ALLOWS.

    The dedup answers "have I already counted THIS game"; completeness answers
    "does the fixture have a game left to count at all", and only the second one
    catches an extra game. A board KEEPS its binding until the producer clears it
    or hands it on, so the game after a finished fixture arrives on a board still
    bound to it — and crediting that pushed a doubleheader to 2-1 and a Bo1 to
    2-0, inventing a game the format says cannot exist on a count a bound board
    puts on air.
    """
    m = await bind(best_of=2)
    capture("G1", 1)
    await PostGame._promote_match(1)
    capture("G2", 1)
    await PostGame._promote_match(1)
    assert series(m) == (2, 0)
    assert Match.is_complete(m) is True

    capture("G3", 2)
    await PostGame._promote_match(1)
    assert series(m) == (2, 0)
    assert deep_get(State.state, f"match.{m}.credited.G3") is None


@pytest.mark.asyncio
async def test_a_split_doubleheader_holds_no_third_game_either():
    """The split is the case the `decided` flag alone would miss: 1-1 is
    finished and unwon, so a third capture has nothing to be part of."""
    m = await bind(best_of=2)
    capture("G1", 1)
    await PostGame._promote_match(1)
    capture("G2", 2)
    await PostGame._promote_match(1)
    assert series(m) == (1, 1)

    capture("G3", 1)
    await PostGame._promote_match(1)
    assert series(m) == (1, 1)


@pytest.mark.asyncio
async def test_recrediting_the_same_game_still_answers_with_its_side():
    """Completeness is checked AFTER the dedup, or the last game of a series
    would stop being idempotent: a re-capture of a game already credited must
    still report the side it went to, not refuse because the series it just
    finished is finished."""
    m = await bind(best_of=1)
    capture("G1", 1)
    await PostGame._promote_match(1)
    assert series(m) == (1, 0)
    assert await Match.award_game(m, "Alice", game_id="G1") == 1
    assert series(m) == (1, 0)

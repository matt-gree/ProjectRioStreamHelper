"""WHERE A BOARD'S GAME IS UP TO — the server half of a question the console
already answered.

``boardLifecycle`` (src/routes/production/board/boards.js) has derived this for the
rack and the board desk for a while; the server writes every input it reads
(``game_over``, ``game_completed``, ``live_following``) and never once read them
back together. So server-side code that needed to know whether a feed was
actually driving a board asked a weaker question instead — ``score.{N}.game_id``,
which means "a game has been here", not "a game is happening here". A finished
game keeps its id forever, so every caller of that test treated last night's
corpse as a live feed (see ``Match._board_side_has_feed_data``).

One statement, two runtimes, pinned by ``tests/unit/test_board_lifecycle_parity``
against the shared case table both suites read. This module holds pure accessors
over State only, so it can be imported from the API layer and the rio data layer
without a cycle (mirrors server/bindings.py's rule for Settings).

THE FIFTH STATE IS ``restored``: this board's game came off disk at boot, not
from a feed in this process. It exists because PRSH has no idea a night ended —
``State.Load`` restores yesterday's score and ``RioGameDataProvider.Start`` then
re-reads ``decoded.hud.json``, which still holds yesterday's last frame, so a
producer opening the app the next day gets a fully populated console describing
18-hour-old data with nothing anywhere saying so.

It is deliberately NOT a session marker, and there is no verb that sets or clears
it. ``apply_parsed_game_to_state`` writes it False in the same per-frame batch as
everything else, so the flag DECAYS: the first real frame of the next game clears
it with no producer action at all, and an app restart mid-broadcast (the case a
"start a new session" button would have got wrong) shows it for one frame and
then goes back to LIVE on its own.

PRECEDENCE ``restored`` > ``final`` > ``stranded`` > ``live``, because "this is
not current" outranks every detail of a game that is not current. Nothing about
the CAPTURE hangs off this: the turnover bar decides whether to offer one from
whether a capture exists for the board's game, which is the honest question and
already what it asks — a restored board with nothing captured still needs the
button (PRSH can crash between the last out and the capture).
"""

from pathlib import Path

from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get

# The per-board flag. Lives under `score.{N}` with the rest of the game's facts
# rather than in a namespace of its own: it describes THIS game's provenance, so
# it must be blanked by the same clear that blanks the game.
RESTORED_KEY = "restored"
# When what is on the board last meant anything (ISO-8601), or absent.
RESTORED_AT_KEY = "restored_at"

STALE = ("final", "stranded", "restored")


def lifecycle_of(
    *,
    game_id=None,
    game_over=None,
    game_completed=None,
    live_following=None,
    captured=False,
    restored=False,
) -> str:
    """Pure verdict over one board's inputs. Twin of ``boardLifecycle``.

    Keyword-only and fully defaulted so the shared case table can name just the
    inputs a case is about — the JS side takes one object for the same reason.
    """
    if not game_id:
        return "empty"
    if restored:
        return "restored"
    # A parsed final box score is the strongest evidence there is, and on a HUD
    # board it is the ONLY end-of-game signal: Project Rio stops writing and its
    # last frame stands, so `game_over` never arrives for a local game.
    if captured:
        return "final"
    if game_over is True or game_completed is True:
        return "final"
    # Absent reads as "yes, still following" — state written before the flag
    # existed should behave the way the board already was.
    if live_following is False:
        return "stranded"
    return "live"


def is_stale(lifecycle: str) -> bool:
    """Has what this board is showing stopped being a game in progress."""
    return lifecycle in STALE


def board_lifecycle(sb) -> str:
    """``lifecycle_of`` over board ``sb``'s current State."""
    board = deep_get(State.state, f"score.{sb}") or {}
    if not isinstance(board, dict):
        return "empty"
    game_id = board.get("game_id")
    pg = deep_get(State.state, f"postgame.{sb}") or {}
    if not isinstance(pg, dict):
        pg = {}
    # The capture has to be THIS game's. Nothing clears `postgame.{N}` when a new
    # game starts, so a bare `present` would mark game 2 of a Bo3 final the moment
    # it kicked off, on game 1's box score.
    captured = bool(
        pg.get("present")
        and pg.get("gameId") is not None
        and str(pg.get("gameId")) == str(game_id)
    )
    return lifecycle_of(
        game_id=game_id,
        game_over=board.get("game_over"),
        game_completed=board.get("game_completed"),
        live_following=board.get("live_following"),
        captured=captured,
        restored=bool(board.get(RESTORED_KEY)),
    )


async def mark_restored() -> None:
    """Flag every board that booted holding a game as not-current.

    CALLED ONCE, AFTER ``RioGameDataProvider.Start`` (server/server.py). The order
    is the whole trick and it is why no apply path needed a new argument: the boot
    HUD read goes through the ordinary per-frame batch, which writes
    ``restored: False`` like every other frame, so marking BEFORE it would be
    immediately undone. Marking after lets the one-shot read of a file that was
    already on disk be treated as what it is — an archive, not an event — while
    every genuine frame from the watcher afterwards clears the flag on its own.
    """
    stamp = _hud_file_mtime()
    entries = []
    for sb in Settings.Get("scoreboards.active", [1]) or [1]:
        if not deep_get(State.state, f"score.{sb}.game_id"):
            continue
        entries.append((f"score.{sb}.{RESTORED_KEY}", True))
        # HOW OLD, in the board's own terms — the difference between "that is last
        # night's, clear it" and a status the producer can only wonder about.
        #
        # Two sources because the two transports carry different facts and NEITHER
        # covers both: a completed API record knows when its game was played, and
        # the HUD path writes no timestamp at all (its frames are a live picture,
        # not a record), so for board 1 — the cold start that actually happens —
        # the honest answer is when Project Rio last wrote the file.
        #
        # Semantically consistent even so: both answer "when did what is on this
        # board last mean anything". Written once, here, rather than derived by
        # each surface from whichever key it happens to know about.
        at = deep_get(State.state, f"score.{sb}.date_time_start") or stamp
        if at:
            entries.append((f"score.{sb}.{RESTORED_AT_KEY}", at))
    if entries:
        await State.SetBatch(entries)
        await State.Save()


def _hud_file_mtime() -> str:
    """When Project Rio last wrote the HUD file, ISO-8601, or "" if unknowable.

    Best-effort by design: a missing file, an unreadable one or no watcher yet all
    mean "no date to show", and the chip simply says OLD without one. Inventing a
    fallback (boot time, say) would put a confident wrong number on the console —
    boot time is when the app was REOPENED, which is the one thing the producer
    already knows.
    """
    from datetime import datetime, timezone

    from server.rio.provider import RioGameDataProvider

    watcher = getattr(RioGameDataProvider, "hud_watcher", None)
    path = getattr(watcher, "hud_file", None)
    if not path:
        return ""
    try:
        return datetime.fromtimestamp(
            Path(path).stat().st_mtime, tz=timezone.utc
        ).isoformat()
    except OSError:
        return ""

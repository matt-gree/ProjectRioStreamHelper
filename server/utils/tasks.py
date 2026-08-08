"""Fire-and-forget background tasks that survive the garbage collector.

``asyncio.create_task`` returns a task the event loop holds only a WEAK
reference to. Code that spawns work and drops the handle — a stats refresh
behind a click, a series result being resolved after a game leaves the ongoing
feed — is relying on something else to keep that task alive. Usually something
does (a task suspended on a timer is reachable from the loop's timer heap), but
"usually" is the wrong guarantee for work whose failure is silent: a dropped
``GameEnd._resolve`` is a game that never gets credited to a series, mid-
broadcast, with nothing in the log to say so.

``spawn`` keeps a strong reference until the task completes, and logs anything
that escapes so a fire-and-forget failure is never merely invisible.
"""
import asyncio

from loguru import logger

# The strong references. A task removes itself on completion, so this is the
# set of work currently in flight rather than a leak.
_background: set[asyncio.Task] = set()


def _on_done(task: asyncio.Task) -> None:
    _background.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.opt(exception=exc).error(
            "background task {!r} failed", task.get_name()
        )


def spawn(coro, *, name: str | None = None) -> asyncio.Task:
    """Start ``coro`` in the background and keep it referenced until it ends."""
    task = asyncio.create_task(coro, name=name)
    _background.add(task)
    task.add_done_callback(_on_done)
    return task


def pending() -> set[asyncio.Task]:
    """The tasks currently in flight. For tests and shutdown."""
    return set(_background)


async def drain(timeout: float = 5.0) -> None:
    """Wait for in-flight background work, then cancel whatever is left.

    Called at shutdown so a resolver mid-retry gets its chance to finish rather
    than dying with the loop.
    """
    if not _background:
        return
    done, still_running = await asyncio.wait(set(_background), timeout=timeout)
    for task in still_running:
        task.cancel()
    if still_running:
        await asyncio.gather(*still_running, return_exceptions=True)

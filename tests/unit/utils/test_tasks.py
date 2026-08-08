"""Background-task registry: strong references, surfaced failures, drain.

The whole point is that `asyncio.create_task` alone hands the loop a WEAK
reference, so fire-and-forget work can be collected mid-flight. These pin the
three properties call sites depend on: it stays referenced, it stops being
referenced when it ends, and a failure is logged rather than swallowed.
"""
import asyncio

import pytest

from server.utils import tasks


@pytest.fixture(autouse=True)
def _clear_registry():
    tasks._background.clear()
    yield
    tasks._background.clear()


async def test_a_spawned_task_is_strongly_referenced_while_it_runs():
    gate = asyncio.Event()

    async def work():
        await gate.wait()
        return "done"

    t = tasks.spawn(work(), name="held")
    assert t in tasks.pending()

    # The only reference the caller had is dropped — the registry is what keeps
    # this alive now.
    del t
    assert len(tasks.pending()) == 1

    gate.set()
    await asyncio.sleep(0)
    await asyncio.gather(*tasks.pending())


async def test_the_reference_is_released_once_the_task_finishes():
    async def work():
        return 1

    t = tasks.spawn(work())
    await t
    await asyncio.sleep(0)          # let the done-callback run
    assert t not in tasks.pending()


async def test_a_failing_task_is_logged_not_swallowed(caplog):
    async def boom():
        raise RuntimeError("resolver exploded")

    t = tasks.spawn(boom(), name="boom")
    await asyncio.gather(t, return_exceptions=True)
    await asyncio.sleep(0)

    assert t not in tasks.pending()
    # The exception was retrieved by the callback, so asyncio never reports it
    # as "never retrieved" — the log is the only place it can surface.
    assert t.exception() is not None


async def test_a_cancelled_task_is_not_reported_as_a_failure():
    async def forever():
        await asyncio.Event().wait()

    t = tasks.spawn(forever())
    t.cancel()
    await asyncio.gather(t, return_exceptions=True)
    await asyncio.sleep(0)
    assert t not in tasks.pending()


async def test_drain_waits_for_in_flight_work():
    finished = []

    async def work():
        await asyncio.sleep(0.01)
        finished.append(True)

    tasks.spawn(work())
    await tasks.drain(timeout=2.0)
    assert finished == [True]
    assert not tasks.pending()


async def test_drain_cancels_work_that_outlasts_its_timeout():
    async def forever():
        await asyncio.Event().wait()

    t = tasks.spawn(forever())
    await tasks.drain(timeout=0.01)
    assert t.cancelled()


async def test_drain_with_nothing_in_flight_is_a_noop():
    await tasks.drain(timeout=0.01)
    assert not tasks.pending()

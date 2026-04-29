import orjson
from asyncio import to_thread

# Payloads under this size are fast enough to serialize inline
# without the overhead of scheduling a thread hop (~50µs savings).
_THREAD_THRESHOLD = 4096  # bytes


async def loads(data, *args, **kwargs):
    if len(data) < _THREAD_THRESHOLD:
        return orjson.loads(data, *args, **kwargs)
    return await to_thread(orjson.loads, data, *args, **kwargs)


async def dumps(*args, **kwargs):
    if "option" not in kwargs:
        kwargs["option"] = orjson.OPT_NON_STR_KEYS | orjson.OPT_INDENT_2

    # Always offload to a thread. We can't condition on output size (we'd
    # have to serialize first to know it), and state can grow to hundreds of
    # KB once a bracket is loaded — large enough to noticeably block the
    # event loop. The ~50µs scheduler hop is invisible vs. the work it
    # protects against.
    return await to_thread(orjson.dumps, *args, **kwargs)

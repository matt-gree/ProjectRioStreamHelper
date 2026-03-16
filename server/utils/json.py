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

    result = orjson.dumps(*args, **kwargs)
    return result

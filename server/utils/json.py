import orjson
from asyncio import to_thread

async def loads(*args, **kwargs):
    return await to_thread(
        orjson.loads,
        *args,
        **kwargs
    )

async def dumps(*args, **kwargs):
    if "option" not in kwargs:
        kwargs["option"] = orjson.OPT_NON_STR_KEYS | orjson.OPT_INDENT_2

    return await to_thread(
        orjson.dumps,
        *args,
        **kwargs
    )
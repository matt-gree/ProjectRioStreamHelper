from functools import reduce
from msgpack import unpackb, packb
from asyncio import to_thread

async def deep_get(dictionary: dict, keys: str, default=None):
    nested_keys = keys.split(".")
    return await to_thread(
        reduce,
        lambda d, key: d.get(key, default) if isinstance(d, dict) else default,
        nested_keys,
        dictionary
    )

async def deep_set(dictionary: dict, keys: str, value):
    d = dictionary
    nested_keys = keys.split(".")

    for key in nested_keys[:-1]:
        if key not in d:
            d[key] = {}
        d = d[key]
    
    d[nested_keys[-1]] = value

async def deep_unset(dictionary: dict, keys: str):
    d = dictionary
    nested_keys = keys.split(".")

    for key in nested_keys[:-1]:
        if key not in d:
            d[key] = {}
        d = d[key]

    if nested_keys[-1] in d:
        del d[nested_keys[-1]]

async def deep_clone(dictionary: dict):
    packed = await to_thread(packb, dictionary)
    return await to_thread(unpackb(packed, strict_map_key=False))
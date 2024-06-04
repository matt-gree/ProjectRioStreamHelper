import orjson
import asyncio
import aiofiles

from server.utils.deep_dict import deep_get, deep_set, deep_unset

settings = {}

async def save() -> None:
    global settings
    async with aiofiles.open("./user_data/settings.json", "wb") as file:
        contents = await asyncio.to_thread(orjson.dumps, settings, option=orjson.OPT_NON_STR_KEYS)
        await file.write(contents)

async def load() -> dict:
    global settings
    async with aiofiles.open("./user_data/settings.json", "rb") as file:
        contents = await file.read()
        settings = await asyncio.to_thread(orjson.loads, contents)
        return settings
    
async def set(key: str, value):
    global settings
    await deep_set(settings, key, value)

async def unset(key: str):
    global settings
    await deep_unset(settings, key)
    await save()

async def get(key: str, default=None):
    global settings
    return await deep_get(settings, key, default)
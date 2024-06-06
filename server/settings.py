import orjson
import asyncio
import aiofiles
import tomllib

from server.utils.deep_dict import deep_get, deep_set, deep_unset

class Settings:
    settings = {}

    @classmethod
    async def Save(cls) -> None:
        async with aiofiles.open("./user_data/settings.json", "wb") as file:
            contents = await asyncio.to_thread(orjson.dumps, cls.settings, option=orjson.OPT_NON_STR_KEYS)
            await file.write(contents)

    @classmethod
    async def Load(cls) -> dict:
        async with aiofiles.open("./user_data/settings.json", "rb") as file:
            cls.settings = await asyncio.to_thread(orjson.loads, await file.read())
            return cls.settings
    
    @classmethod
    async def Set(cls, key: str, value):
        await deep_set(cls.settings, key, value)

    @classmethod
    async def Unset(cls, key: str):
        await deep_unset(cls.settings, key)
        await cls.Save()

    @classmethod
    async def Get(cls, key: str, default=None):
        return await deep_get(cls.settings, key, default)
    
class Config:
    config = {
        "name": "TournamentStreamHelper",
        "version": "?",
        "description": "",
        "authors": []
    }

    @classmethod
    async def Load(cls) -> dict:
        async with aiofiles.open('pyproject.toml', mode='r', encoding='utf-8') as f:
            # pyproject.toml likely included in production builds as it makes
            # updating the version easier, less redundant, etc.
            context = tomllib.loads(await f.read())["tool"]["poetry"]
            cls.config["name"] = context["name"]
            cls.config["version"] = context["version"]
            cls.config["description"] = context["description"]
            cls.config["authors"] = context["authors"]
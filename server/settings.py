import asyncio
import aiofiles
import aiofiles.ospath
import tomllib
import orjson

from loguru import logger
from server import socketio
from server.utils import json
from server.utils.deep_dict import deep_set, deep_unset, deep_get
class Settings:
    settings = {
        "server": {
            "host": "0.0.0.0",
            "port": 5260,
            "dev": True,
            "autostart": True
        },
        "general": {
            "disable_export": False
        }
    }

    @classmethod
    async def Save(cls):
        async with aiofiles.open('./user_data/settings.json', 'wb') as f:
            content = await json.dumps(cls.settings)
            await f.write(content)

    @classmethod
    async def Load(cls) -> dict:
        try:
            async with aiofiles.open('./user_data/settings.json', 'rb') as f:
                cls.settings = await asyncio.to_thread(
                    orjson.loads,
                    await f.read()
                )
        except:
            logger.debug("using default settings dict")

    @classmethod
    async def Set(cls, key: str, value, session_id: str | None = None):
        await deep_set(cls.settings, key, value)
        await asyncio.wait([
            asyncio.create_task(
                socketio.emit('v1.settings.set', {
                    "key": key,
                    "value": value,
                    "sid": session_id
                })
            ),
            asyncio.create_task(cls.Save())
        ])

    @classmethod
    async def Unset(cls, key: str, session_id: str | None = None):
        await deep_unset(cls.settings, key)
        await asyncio.wait([
            asyncio.create_task(
                socketio.emit('v1.settings.unset', {
                    "key": key,
                    "sid": session_id
                })
            ),
            asyncio.create_task(cls.Save())
        ])

    @classmethod
    async def Get(cls, key: str, default=None):
        return await deep_get(cls.settings, key, default)

class Config:
    config = {
        "name": "TournamentStreamHelper",
        "version": "?",
        "description": "",
        "authors": [],
        "server_url": ""
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

        return cls.config
    
    @classmethod
    async def SetServerURL(cls, url: str):
        cls.config["server_url"] = url
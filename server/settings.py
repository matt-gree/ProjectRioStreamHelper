import asyncio
import tomllib
import orjson

from aiopath import AsyncPath
from loguru import logger
from server import socketio
from server.utils import json
from server.utils.deep_dict import deep_set, deep_unset, deep_get


def _deep_merge(defaults: dict, loaded: dict) -> dict:
    """Merge loaded settings on top of defaults.

    Loaded values take precedence, but any keys present in defaults
    that are missing from loaded are preserved. This ensures new
    default keys are automatically available after upgrades without
    needing explicit migration code.
    """
    result = dict(defaults)
    for key, value in loaded.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


class Settings:
    settings = {
        "server": {
            "host": "0.0.0.0",
            "port": 5260,
            "dev": True,
            "autostart": True
        },
        "general": {
            "disable_export": False,
            "profanity_filter": True,
            "control_score_from_stage_strike": True,
            "disable_autoupdate": False,
            "disable_overwrite": False
        },
        "hotkeys": {
            "load_set": None,
            "team1_score_up": None,
            "team1_score_down": None,
            "team2_score_up": None,
            "team2_score_down": None,
            "reset_scores": None,
            "swap_teams": None
        },
        "project_rio": {
            "hud_path": "",
            "pinned_player": "",
            "pinned_side": "Team 1",
            "pinned_hud_only": False
        },
        "scoreboards": {
            "active": [1],
            "hud_target": 1,
            "aliases": {},
            "sources": {
                "1": {"type": "manual", "api_game_id": None}
            }
        },
        "lang": "en-US"
    }
    _settings_out = AsyncPath('./user_data/settings.json')

    @classmethod
    async def Save(cls):
        async with cls._settings_out.open(mode='wb') as f:
            content = await json.dumps(cls.settings)
            await f.write(content)

    @classmethod
    async def Load(cls) -> dict:
        try:
            async with cls._settings_out.open(mode='rb', encoding='utf-8') as f:
                loaded = await asyncio.to_thread(
                    orjson.loads,
                    await f.read()
                )
                cls.settings = _deep_merge(cls.settings, loaded)
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
        _pyproject_toml = await AsyncPath('./pyproject.toml').read_text(encoding='utf-8')
        context = await asyncio.to_thread(tomllib.loads, _pyproject_toml)
        context = context["tool"]["poetry"]

        cls.config["name"] = context["name"]
        cls.config["version"] = context["version"]
        cls.config["description"] = context["description"]
        cls.config["authors"] = context["authors"]

        return cls.config
    
    @classmethod
    async def SetServerURL(cls, url: str):
        cls.config["server_url"] = url
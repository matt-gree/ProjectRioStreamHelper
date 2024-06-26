import aiofiles
import aiofiles.ospath
import tomllib

from asyncio import to_thread
from functools import lru_cache
from pydantic import BaseModel
from pydantic_settings import BaseSettings, JsonConfigSettingsSource, PydanticBaseSettingsSource, SettingsConfigDict

class GeneralSettings(BaseModel):
    disable_export: bool = False
class ServerSettings(BaseModel):
    host: str = "0.0.0.0"
    port: int = 5260
    dev: bool = True
    autostart: bool = True
class Settings(BaseSettings):
    model_config = SettingsConfigDict(json_file='./user_data/settings.json', json_file_encoding='utf-8')

    server: ServerSettings = ServerSettings()
    general: GeneralSettings = GeneralSettings()

    @classmethod
    def settings_customise_sources(
        cls, 
        settings_cls: BaseSettings, 
        init_settings: PydanticBaseSettingsSource, 
        env_settings: PydanticBaseSettingsSource, 
        dotenv_settings: PydanticBaseSettingsSource, 
        file_secret_settings: PydanticBaseSettingsSource
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return init_settings, dotenv_settings, env_settings, JsonConfigSettingsSource(settings_cls), file_secret_settings

@lru_cache
def get_settings():
    return Settings()

async def save_settings():
    async with aiofiles.open('./user_data/settings.json', mode='w', encoding='utf-8') as f:
        settings = get_settings()
        settings_dump = await to_thread(settings.model_dump_json, indent=2)
        await f.write(settings_dump)
    
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

        return cls.config
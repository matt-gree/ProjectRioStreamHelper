import asyncio
import copy
import importlib.util
import sys
import tomllib
import orjson
from pathlib import Path

from aiopath import AsyncPath
from loguru import logger
from server import socketio
from server.paths import user_data_dir
from server.utils import json
from server.utils.deep_dict import deep_set, deep_unset, deep_get


def _resolve_version() -> str:
    """Resolve app version via scripts/freeze-version.py.

    Used by Config.Load(). The freeze-version module lives outside the
    `server` package because it has to be runnable as a standalone build
    script too (Vite prebuild, PyInstaller hook, CI checks). We import it
    by file path so the import works in dev *and* in PyInstaller bundles
    where the layout is flattened.
    """
    candidates = [
        Path(__file__).resolve().parent.parent / "scripts" / "freeze-version.py",
        Path(getattr(sys, "_MEIPASS", "")) / "scripts" / "freeze-version.py"
            if getattr(sys, "_MEIPASS", None) else None,
    ]
    for path in filter(None, candidates):
        if not path.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("_freeze_version", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
            return mod.resolve_version()
        except Exception as e:
            logger.warning("[Config] freeze-version load failed at {}: {}", path, e)

    # Fallback: the resolver couldn't be loaded at all. Try the frozen
    # _version.py directly so a packaged build still shows something useful.
    frozen = Path(__file__).resolve().parent / "_version.py"
    if frozen.is_file():
        try:
            for line in frozen.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("VERSION") and "=" in line:
                    _, _, rhs = line.partition("=")
                    v = rhs.strip().strip('"').strip("'")
                    if v:
                        return v
        except OSError:
            pass
    return "0.0.0-dev"


# Settings keys whose raw values must never leave the server. Reads return a
# bool/sentinel; SocketIO broadcasts replace the value with the same sentinel.
# At-rest these are still plaintext in settings.json — encrypting the file
# doesn't defend against the LAN API surface, which is the actual exposure.
SECRET_KEYS = frozenset({"challonge.api_key"})

_REDACTED = "***"


def redact_value(key: str, value):
    """Redact a single setting value for wire output if its key is secret."""
    if key not in SECRET_KEYS:
        return value
    return _REDACTED if value else ""


def redact_settings(settings_dict: dict) -> dict:
    """Return a deep copy of settings with secret-key values redacted."""
    out = copy.deepcopy(settings_dict)
    for dotted in SECRET_KEYS:
        existing = deep_get(out, dotted, None)
        if existing is None:
            continue
        deep_set(out, dotted, _REDACTED if existing else "")
    return out


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
            # When False, bind to 127.0.0.1 (loopback only). When True, bind
            # to 0.0.0.0 so phones/tablets on the same WiFi can reach the UI
            # — but also exposes state, settings, and the Challonge key
            # plaintext to anyone on the network. Opt-in via Settings.
            "allow_lan": False,
            "port": 5260,
            "dev": True,
            "autostart": True
        },
        "general": {
            "disable_export": True,
            "profanity_filter": True,
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
            "aliases": {},
            "sources": {
                "1": {"type": "manual", "api_game_id": None}
            }
        },
        "challonge": {
            "api_key": ""
        },
        "announcements": {
            "dismissed_ids": [],
            "check_for_updates": True,
        },
        "controller_overlay": {
            "path": "",
            "port": 8069,
            "controller": 1,
            "auto_start": False
        },
        "overlays": {
            "global": {
                "accentColor": "#f59e0b",
                "cardBg": "rgba(15, 15, 25, 0.88)",
                "textColor": "#ffffff",
                "borderRadius": 16,
                "borderColor": "rgba(255, 255, 255, 0.08)",
                "fontFamily": "Inter",
                "showShadow": True,
                "cardShadowBlur": 16,
                "cardShadowColor": "rgba(0, 0, 0, 0.5)",
                "textShadowEnabled": False,
                "textShadowBlur": 4,
                "textShadowColor": "rgba(0, 0, 0, 0.8)"
            },
            "presets": {},
            "scoreboard": {
                "showCaptains": True,
                "showElo": True,
                "showTeamLogos": True,
                "showLogo": True,
                "showBackdropBlur": True,
                "finalBadgeColor": None,
                "accentColor": None,
                "textColor": None,
                "cardBg": None,
                "borderColor": None,
                "borderRadius": None,
                "borderWidth": None,
                "cardShadowBlur": None,
                "textShadowBlur": None,
            },
            "roster": {
                "accentColor": None
            },
            "stats": {
                "accentColor": None,
                "statValueColor": None,
                "subtextColor": None,
                "cardBg": None,
                "borderColor": None,
                "borderRadius": None,
                "borderWidth": None,
                "cardShadowBlur": None,
                "textShadowBlur": None,
            },
            "teamlogo": {},
            "bracket": {
                "connectorColor": None,
                "activeColor": None,
                "accentColor": None
            }
        },
        "lang": "en-US"
    }
    _settings_out = AsyncPath(str(user_data_dir() / 'settings.json'))
    _save_lock: asyncio.Lock = asyncio.Lock()

    @classmethod
    async def Save(cls):
        async with cls._save_lock:
            # Write to a sibling .tmp file then atomically rename so a kill
            # mid-write can't truncate settings.json and reset the user's
            # config to defaults on the next launch.
            tmp = AsyncPath(str(cls._settings_out) + ".tmp")
            async with tmp.open(mode='wb') as f:
                content = await json.dumps(cls.settings)
                await f.write(content)
            await tmp.replace(cls._settings_out)

    @classmethod
    async def Load(cls) -> dict:
        loaded_server: dict = {}
        try:
            async with cls._settings_out.open(mode='rb', encoding='utf-8') as f:
                loaded = await asyncio.to_thread(
                    orjson.loads,
                    await f.read()
                )
                loaded_server = (loaded.get("server") or {}) if isinstance(loaded, dict) else {}
                cls.settings = _deep_merge(cls.settings, loaded)
        except:
            logger.debug("using default settings dict")

        # Migrate legacy `server.host` to `server.allow_lan`. Prior versions
        # defaulted host to "0.0.0.0"; on upgrade preserve LAN access for
        # users who already had it. New installs ship loopback-only.
        if "host" in loaded_server and "allow_lan" not in loaded_server:
            legacy_host = loaded_server.get("host")
            if legacy_host and legacy_host not in ("127.0.0.1", "localhost", "::1"):
                cls.settings["server"]["allow_lan"] = True
        cls.settings.get("server", {}).pop("host", None)
        if "host" in loaded_server:
            await cls.Save()

    @classmethod
    async def Set(cls, key: str, value, session_id: str | None = None):
        deep_set(cls.settings, key, value)
        await asyncio.gather(
            socketio.emit('v1.settings.set', {
                "key": key,
                "value": redact_value(key, value),
                "sid": session_id
            }),
            cls.Save()
        )

    @classmethod
    async def Unset(cls, key: str, session_id: str | None = None):
        deep_unset(cls.settings, key)
        await asyncio.gather(
            socketio.emit('v1.settings.unset', {
                "key": key,
                "sid": session_id
            }),
            cls.Save()
        )

    @classmethod
    def Get(cls, key: str, default=None):
        return deep_get(cls.settings, key, default)

class Config:
    config = {
        "name": "ProjectRioStreamHelper",
        "version": "1.0.0",
        "description": "Tournament scoreboard helper and overlays for Mario Superstar Baseball via Project Rio",
        "authors": [],
        "server_url": ""
    }

    @classmethod
    async def Load(cls) -> dict:
        # Read non-version metadata from pyproject.toml (name, description,
        # authors). Version is resolved separately via scripts/freeze-version.py
        # so it stays anchored to the git tag (or the frozen _version.py
        # generated at build time) rather than a hand-edited file. See
        # scripts/freeze-version.py for the resolution chain.
        try:
            text = await asyncio.to_thread(
                Path('./pyproject.toml').read_text, encoding='utf-8'
            )
            context = tomllib.loads(text)["tool"]["poetry"]
            cls.config["name"] = context["name"]
            cls.config["description"] = context["description"]
            cls.config["authors"] = context["authors"]
        except Exception:
            pass  # frozen build or missing file; hardcoded defaults used

        cls.config["version"] = await asyncio.to_thread(_resolve_version)
        return cls.config
    
    @classmethod
    async def SetServerURL(cls, url: str):
        cls.config["server_url"] = url
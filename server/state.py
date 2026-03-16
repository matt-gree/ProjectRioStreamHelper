import asyncio
import copy
import httpx

from aiopath import AsyncPath
from shutil import rmtree
from functools import partial
from loguru import logger
from PIL import Image
from server import socketio
from server.settings import Settings
from server.utils.deep_dict import deep_set, deep_unset, deep_get
from server.utils import json

class State:
    state = {}
    last_state = {}
    changed_keys = []
    queue = asyncio.Queue()
    _stream_labels_out = AsyncPath("./user_data/stream_labels")
    _program_state_out = AsyncPath("./user_data/state.json")

    @classmethod
    async def Export(cls, changes: list[dict]):
        """Export changed keys to stream label files and save state JSON.

        Args:
            changes: list of {"key": dot.path, "old": old_value, "new": new_value, "action": "set"|"unset"}
        """
        await cls.SaveImmediately()

        disable_export = await Settings.Get("general.disable_export", False)
        if not disable_export:
            for change in changes:
                key = change["key"]
                filename = key.replace(".", "/")
                action = change["action"]

                if action == "unset":
                    old_val = change["old"]
                    if old_val is not None:
                        await cls._remove_files_dict(filename, old_val)
                else:
                    new_val = change["new"]
                    old_val = change["old"]
                    if new_val is None and old_val is not None:
                        await cls._remove_files_dict(filename, old_val)
                    elif new_val is not None:
                        await cls._create_files_dict(filename, new_val)

    @classmethod
    async def Consumer(cls):
        try:
            while True:
                item = await cls.queue.get()
                await item()
                cls.queue.task_done()
        except asyncio.exceptions.CancelledError:
            return
        except:
            logger.exception("state queue errored on task")

    @classmethod
    async def Save(cls):
        """Compute changes from tracked keys and queue export."""
        changes = cls._compute_changes()
        cls.changed_keys = []

        if changes:
            # Update last_state snapshot for changed paths only
            for change in changes:
                key = change["key"]
                if change["action"] == "unset":
                    _sync_deep_unset(cls.last_state, key)
                else:
                    _sync_deep_set(cls.last_state, key, copy.deepcopy(change["new"]))

            await cls.queue.put(partial(cls.Export, changes=changes))

    @classmethod
    def _compute_changes(cls) -> list[dict]:
        """Build a list of changes by comparing tracked keys between last_state and state."""
        changes = []
        seen = set()
        for key in cls.changed_keys:
            if key in seen:
                continue
            seen.add(key)

            old_val = _sync_deep_get(cls.last_state, key)
            new_val = _sync_deep_get(cls.state, key)

            if old_val != new_val:
                changes.append({
                    "key": key,
                    "old": old_val,
                    "new": new_val,
                    "action": "set",
                })
        return changes

    @classmethod
    async def SaveImmediately(cls):
        async with cls._program_state_out.open(mode='wb') as f:
            d = await json.dumps(cls.state)
            await f.write(d)

    @classmethod
    async def Load(cls):
        try:
            async with cls._program_state_out.open(mode='rb', encoding='utf-8') as f:
                cls.state = await json.loads(await f.read())
        except:
            logger.debug("unable to load state.json, using default dict")
        cls.last_state = copy.deepcopy(cls.state)

    @classmethod
    async def Set(cls, key: str, value, session_id: str | None = None):
        await deep_set(cls.state, key, value)
        cls.changed_keys.append(key)
        await socketio.emit('v1.state.set', {
            "key": key,
            "value": value,
            "sid": session_id
        })

    @classmethod
    async def SetBatch(cls, entries: list[tuple[str, object]], session_id: str | None = None):
        """Set multiple keys at once and emit a single batched SocketIO event.

        Args:
            entries: list of (key, value) tuples
            session_id: optional session ID to echo-filter on the frontend
        """
        items = []
        for key, value in entries:
            await deep_set(cls.state, key, value)
            cls.changed_keys.append(key)
            items.append({"key": key, "value": value})

        await socketio.emit('v1.state.set_batch', {
            "items": items,
            "sid": session_id
        })

    @classmethod
    async def Unset(cls, key: str, session_id: str | None = None):
        await deep_unset(cls.state, key)
        cls.changed_keys.append(key)
        await socketio.emit('v1.state.unset', {
            "key": key,
            "sid": session_id
        })

    @classmethod
    async def Get(cls, key: str, default=None):
        return await deep_get(cls.state, key, default)

    @classmethod
    async def _download_image(cls, url: str, dlpath: str):
        try:
            async with httpx.stream("GET", url, follow_redirects=True) as r:
                if r.status_code == httpx.codes.OK:
                    _out = AsyncPath(dlpath)
                    async with _out.open(mode='wb') as f:
                        async for data in r.iter_bytes():
                            await f.write(data)

                    if url.endswith(".jpg"):
                        original = Image.open(str(dlpath))
                        await asyncio.to_thread(
                            original.save,
                            dlpath.rsplit(".", 1)[0] + ".png",
                            format="png"
                        )
                        await dlpath.unlink(missing_ok=True)
        except:
            logger.exception("unable to download image")

    @classmethod
    async def _create_files_dict(cls, path, di):
        pathdirs = "/".join(path.split("/")[0:-1])

        _p = AsyncPath(f"{cls._stream_labels_out}/{pathdirs}")
        if await _p.is_dir() == False:
            await _p.mkdir(parents=True, exist_ok=True)

        if isinstance(di, dict):
            for k, i in di.items():
                await cls._create_files_dict(path+"/"+str(k).replace("/","_"), i)
        elif isinstance(di, str) and di.startswith("./"):
            _p = AsyncPath(f"{cls._stream_labels_out}/{path}" + "." + di.rsplit(".", 1)[-1])
            if await _p.exists() == True:
                try:
                    await _p.unlink()
                except:
                    logger.exception("unable to remove file")
        elif isinstance(di, str) and di.startswith("http") and (di.endswith(".png") or di.endswith("jpg")):
            try:
                _p = AsyncPath(f"{cls._stream_labels_out}/" + "." + di.rsplit(".", 1)[-1])
                if await _p.exists() == True:
                    await _p.unlink()
            except:
                logger.exception("error in create_files_dict")
            finally:
                await cls.queue.put(partial(
                    cls._download_image,
                    url=di,
                    dlpath = _p
                ))
        else:
            await AsyncPath(f"{cls._stream_labels_out}/{path}.txt").write_text(str(di))

    @classmethod
    async def _remove_files_dict(cls, path, di):
        pathdirs = "/".join(path.split("/")[0:-1])

        if isinstance(di, dict):
            for k, i in di.items():
                await cls._remove_files_dict(path+"/"+str(k).replace("/", "_"), i)
        elif isinstance(di, str) and (di.startswith("./") or di.startswith("http")):
            try:
                _p = AsyncPath(f"{cls._stream_labels_out}/{path}." + di.rsplit(".", 1)[-1])
                if await _p.exists() == True:
                    await _p.unlink()
            except:
                logger.exception("unable to remove file")
        else:
            try:
                _p = AsyncPath(f"{cls._stream_labels_out}/{path}.txt")
                if await _p.exists() == True:
                    await _p.unlink()
            except:
                logger.exception("unable to remove file")

        try:
            _p = AsyncPath(f"{cls._stream_labels_out}/{path}")
            if await _p.exists() == True:
                await asyncio.to_thread(rmtree, str(_p))
        except:
            logger.exception("unable to remove directory")


# --- Synchronous helpers for internal use (no thread hops) ---

def _sync_deep_get(dictionary: dict, keys: str, default=None):
    d = dictionary
    for key in keys.split("."):
        if isinstance(d, dict):
            d = d.get(key, default)
        else:
            return default
    return d

def _sync_deep_set(dictionary: dict, keys: str, value):
    d = dictionary
    parts = keys.split(".")
    for key in parts[:-1]:
        if key not in d:
            d[key] = {}
        d = d[key]
    d[parts[-1]] = value

def _sync_deep_unset(dictionary: dict, keys: str):
    d = dictionary
    parts = keys.split(".")
    for key in parts[:-1]:
        if key not in d:
            return
        d = d[key]
    d.pop(parts[-1], None)

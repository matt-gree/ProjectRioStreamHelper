import asyncio
import httpx

from aiopath import AsyncPath
from shutil import rmtree
from deepdiff import DeepDiff, extract
from functools import partial
from loguru import logger
from PIL import Image
from server import socketio
from server.settings import Settings
from server.utils.deep_dict import deep_clone, deep_set, deep_unset, deep_get
from server.utils import json

class State:
    state = {}
    last_state = {}
    changed_keys = []
    queue = asyncio.Queue()
    _stream_labels_out = AsyncPath("./user_data/stream_labels")
    _program_state_out = AsyncPath("./user_data/state.json")

    @classmethod
    async def Export(cls, diff):
        await cls.SaveImmediately()

        disable_export = await Settings.Get("general.disable_export", False)
        if not disable_export:
            merged_diffs = list(diff.get("values_changed", {}).items())
            merged_diffs.extend(list(diff.get("type_changes", {}).items()))

            for changed_key, change in merged_diffs:
                filename = "/".join(
                    changed_key[5:]
                    .replace("'", "")
                    .replace("]", "")
                    .replace("/", "_")
                    .split("[")
                )

                if change.get("new_type") == type(None):
                    await cls._remove_files_dict(filename, extract(cls.last_state, changed_key))
                else:
                    await cls._create_files_dict(filename, change.get("new_value"))

            for key in diff.get("dictionary_item_removed", {}):
                item = extract(cls.last_state, key)
                filename = "/".join(
                    key[5:]
                    .replace("'", "")
                    .replace("]", "")
                    .replace("/", "_")
                    .split("[")
                )
                await cls._remove_files_dict(filename, item)

            for key in diff.get("dictionary_item_added", {}):
                try:
                    item = extract(cls.state, key)
                    path = "/".join(
                        key[5:]
                        .replace("'", "")
                        .replace("]", "")
                        .replace("/", "_")
                        .split("[")
                    )
                    await cls._create_files_dict(path, item)
                except:
                    logger.exception("error while creating dict files")
    
        cls.last_state = await deep_clone(cls.state)

    @classmethod
    async def Consumer(cls):
        try:
            while True:
                item = await cls.queue.get()
                await item
                cls.queue.task_done()
        except asyncio.exceptions.CancelledError:
            return
        except:
            logger.exception("state queue errored on task")

    @classmethod
    async def Save(cls):
        diff = await asyncio.to_thread(
            DeepDiff,
            cls.last_state,
            cls.state,
            include_paths=cls.changed_keys
        )
        cls.changed_keys = []

        if len(diff) > 0:
            await cls.queue.put(partial(
                cls.Export,
                diff=diff
            ))

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

    @classmethod
    async def _add_changed_key(cls, key: str):
        final_key = "root"
        for k in key.split("."):
            final_key += f"['{k}']"
        
        cls.changed_keys.append(final_key)

    @classmethod
    async def Set(cls, key: str, value, session_id: str | None = None):
        await deep_set(cls.state, key, value)
        await asyncio.wait([
            asyncio.create_task(cls._add_changed_key(key)),
            asyncio.create_task(
                socketio.emit('v1.state.set', {
                    "key": key,
                    "value": value,
                    "sid": session_id
                })
            )
        ])

    @classmethod
    async def Unset(cls, key: str, session_id: str | None = None):
        await deep_unset(cls.state, key)
        await asyncio.wait([
            asyncio.create_task(cls._add_changed_key(key)),
            asyncio.create_task(
                socketio.emit('v1.state.unset', {
                    "key": key,
                    "sid": session_id
                })
            )
        ])

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
            await _p.makedirs(parents=True, exist_ok=True)

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
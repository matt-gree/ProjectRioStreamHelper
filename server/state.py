import asyncio
import aiofiles
import httpx

from aiofiles import os, ospath
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
    out = "./user_data/stream_labels"

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
        async with aiofiles.open('./user_data/state.json', 'wb') as f:
            d = await json.dumps(cls.state)
            await f.write(d)

    @classmethod
    async def Load(cls):
        try:
            async with aiofiles.open('./user_data/state.json', 'rb') as f:
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
                    async with aiofiles.open(dlpath, 'wb') as f:
                        async for data in r.iter_bytes():
                            await f.write(data)
        
                    if url.endswith(".jpg"):
                        original = Image.open(dlpath)
                        await asyncio.to_thread(
                            original.save,
                            dlpath.rsplit(".", 1)[0] + ".png",
                            format="png"
                        )
                        await os.remove(dlpath)
        except:
            logger.exception("unable to download image")

    @classmethod
    async def _create_files_dict(cls, path, di):
        pathdirs = "/".join(path.split("/")[0:-1])

        _p = f"{cls.out}/{pathdirs}"
        if await ospath.isdir(_p) == False:
            await os.makedirs(_p)

        if isinstance(di, dict):
            for k, i in di.items():
                await cls._create_files_dict(path+"/"+str(k).replace("/","_"), i)
        elif isinstance(di, str) and di.startswith("./"):
            _p = f"{cls.out}/{path}" + "." + di.rsplit(".", 1)[-1]
            if await ospath.exists(_p):
                try:
                    await os.remove(_p)
                except:
                    logger.exception("unable to remove file")
        elif isinstance(di, str) and di.startswith("http") and (di.endswith(".png") or di.endswith("jpg")):
            try:
                _p = f"{cls.out}/" + "." + di.rsplit(".", 1)[-1]
                if await ospath.exists(_p):
                    await os.remove(_p)
            except:
                logger.exception("error in create_files_dict")
            finally:
                await cls.queue.put(partial(
                    cls._download_image,
                    url=di,
                    dlpath = _p
                ))
        else:
            async with aiofiles.open(f"{cls.out}/{path}.txt", "w", encoding="utf-8") as f:
                await f.write(str(di))

    @classmethod
    async def _remove_files_dict(cls, path, di):
        pathdirs = "/".join(path.split("/")[0:-1])

        if isinstance(di, dict):
            for k, i in di.items():
                await cls._remove_files_dict(path+"/"+str(k).replace("/", "_"), i)
        elif isinstance(di, str) and (di.startswith("./") or di.startswith("http")):
            try:
                _p = f"{cls.out}/{path}." + di.rsplit(".", 1)[-1]
                if await ospath.exists(_p):
                    await os.remove(_p)
            except:
                logger.exception("unable to remove file")
        else:
            try:
                _p = f"{cls.out}/{path}.txt"
                if await ospath.exists(_p):
                    await os.remove(_p)
            except:
                logger.exception("unable to remove file")
        
        try:
            _p = f"{cls.out}/{path}"
            if await ospath.exists(_p):
                await asyncio.to_thread(rmtree, _p)
        except:
            logger.exception("unable to remove directory")
import asyncio
import copy
import httpx

from aiopath import AsyncPath
from shutil import rmtree
from functools import partial
from loguru import logger
from PIL import Image
from server import socketio
from server.paths import user_data_dir
from server.settings import Settings
from server.utils.deep_dict import deep_set, deep_unset, deep_get
from server.utils import json

class State:
    state = {}
    last_state = {}
    changed_keys = []
    queue = asyncio.Queue()
    _stream_labels_out = AsyncPath(str(user_data_dir() / "stream_labels"))
    _program_state_out = AsyncPath(str(user_data_dir() / "state.json"))

    @classmethod
    async def _is_export_enabled(cls) -> bool:
        disable_export = await Settings.Get("general.disable_export", True)
        if isinstance(disable_export, str):
            disable_export = disable_export.strip().lower() not in ("", "0", "false", "no", "off")
        return not disable_export

    @classmethod
    async def ExportAll(cls):
        """Write every leaf of current state as txt files.

        Used on first enablement (or after the stream_labels dir is deleted) to
        populate all files — regular Save() only writes diffs, which leaves
        unchanged keys as missing files.
        """
        if not await cls._is_export_enabled():
            return
        for key, value in cls.state.items():
            await cls._create_files_dict(key, value)
        logger.info("[State] Full stream-labels export complete")

    @classmethod
    async def Export(cls, changes: list[dict]):
        """Export changed keys to stream label files and save state JSON.

        Args:
            changes: list of {"key": dot.path, "old": old_value, "new": new_value, "action": "set"|"unset"}
        """
        await cls.SaveImmediately()

        disable_export = await Settings.Get("general.disable_export", True)
        # Setting may come in as a string ("1"/"") from query-param PUTs; coerce to bool.
        if isinstance(disable_export, str):
            disable_export = disable_export.strip().lower() not in ("", "0", "false", "no", "off")
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
                try:
                    await item()
                except Exception:
                    logger.exception("state queue errored on task")
                finally:
                    cls.queue.task_done()
        except asyncio.CancelledError:
            return

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
                    deep_unset(cls.last_state, key)
                else:
                    deep_set(cls.last_state, key, copy.deepcopy(change["new"]))

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

            old_val = deep_get(cls.last_state, key)
            new_val = deep_get(cls.state, key)

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
        deep_set(cls.state, key, value)
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
            deep_set(cls.state, key, value)
            cls.changed_keys.append(key)
            items.append({"key": key, "value": value})

        await socketio.emit('v1.state.set_batch', {
            "items": items,
            "sid": session_id
        })

    @classmethod
    async def Unset(cls, key: str, session_id: str | None = None):
        deep_unset(cls.state, key)
        cls.changed_keys.append(key)
        await socketio.emit('v1.state.unset', {
            "key": key,
            "sid": session_id
        })

    @classmethod
    async def Get(cls, key: str, default=None):
        return deep_get(cls.state, key, default)

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

        if di is None:
            # Write empty file so OBS Text (GDI+) sources never point at a missing path
            await AsyncPath(f"{cls._stream_labels_out}/{path}.txt").write_text("")
            return

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

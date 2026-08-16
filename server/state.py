import asyncio
import copy
import re

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

# Distinguishes "key is absent" from "key is present and None" when diffing.
# State legitimately holds None values, so it cannot be the missing marker.
_MISSING = object()

# Stream labels turn state paths into real files, and a path segment can carry
# user text (a participant's name, a tag) — so the segment has to survive being
# a FILENAME on the strictest platform we ship to. Windows rejects these
# characters outright, silently drops trailing dots/spaces, and still treats the
# old DOS device names as devices even with an extension: `nul.txt` is not a
# file. Sanitizing only "/" (as this did) is enough on macOS and raises OSError
# on Windows, aborting the rest of that export batch.
_ILLEGAL_SEGMENT_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WIN_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def _safe_segment(name) -> str:
    """One path component, safe to use as a filename on macOS and Windows."""
    seg = _ILLEGAL_SEGMENT_CHARS.sub("_", str(name))
    seg = seg.rstrip(". ")
    if not seg:
        return "_"
    # The extension is appended by the caller, and CON.txt is still CON.
    if seg.split(".", 1)[0].upper() in _WIN_RESERVED_NAMES:
        seg = "_" + seg
    return seg


# How often state.json may be rewritten, in seconds.
#
# Every Save() used to write the WHOLE file. With a real broadcast state (~270
# KB) and Rio's HUD debounce (300 ms), that is ~2.7 MB/s of continuous disk
# writes for the length of a stream — and on Windows every one of them goes
# through the AV filter driver. But state.json is read at BOOT and nowhere else,
# so it only has to be RECENT, not current: a coalescing writer bounds it to one
# write per interval, and the shutdown path takes the last one unconditionally.
# The worst case is a hard kill losing under a second of a file the next HUD
# frame rewrites anyway.
PERSIST_INTERVAL = 1.0


class State:
    state = {}
    last_state = {}
    changed_keys = []
    queue = asyncio.Queue()
    # Write-path hooks. Each is `async (entries) -> [(key, value), ...]`: it sees
    # the entries of a write that has ALREADY been applied to `state` and may
    # return further entries to fold into the SAME batch — same socket frame,
    # same diff cycle, same latency as the write that triggered it. That is what
    # lets the automation engine decide a container's feed off a HUD change
    # without a round-trip (see server/automations.py). Empty by default, so a
    # server with no hooks pays one falsy check per write.
    hooks: list = []
    # Unset observers: `async (keys) -> None`. Unsets can't carry a fold-in (a
    # clear and a set are different frames), so an observer that wants to write
    # schedules its own follow-up.
    unset_hooks: list = []
    # Output paths resolve lazily (first use, cached) rather than at import
    # time, so a PRSH_USER_DATA_DIR override set for the process is honored
    # and tests can inject temp paths by assigning these directly.
    _stream_labels_out: AsyncPath | None = None
    _program_state_out: AsyncPath | None = None
    # state.json persistence. The flag is what Export raises instead of writing;
    # Persister is what turns it back into a write. Both the flag and the lock
    # are created lazily because an Event/Lock binds to the loop it is first
    # awaited under, and tests get a fresh loop each.
    _persist_dirty: asyncio.Event | None = None
    _save_lock: asyncio.Lock | None = None

    @classmethod
    def _labels_dir(cls) -> AsyncPath:
        if cls._stream_labels_out is None:
            cls._stream_labels_out = AsyncPath(str(user_data_dir() / "stream_labels"))
        return cls._stream_labels_out

    @classmethod
    def _state_file(cls) -> AsyncPath:
        if cls._program_state_out is None:
            cls._program_state_out = AsyncPath(str(user_data_dir() / "state.json"))
        return cls._program_state_out

    @classmethod
    async def _is_export_enabled(cls) -> bool:
        disable_export = Settings.Get("general.disable_export", True)
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
            await cls._create_files_dict(_safe_segment(key), value)
        logger.info("[State] Full stream-labels export complete")

    @classmethod
    async def Export(cls, changes: list[dict]):
        """Export changed keys to stream label files and save state JSON.

        Args:
            changes: list of {"key": dot.path, "old": old_value, "new": new_value, "action": "set"|"unset"}
        """
        # Raise the flag rather than write. Persister owns the file; see
        # PERSIST_INTERVAL for why a write per change is not affordable.
        cls.MarkDirty()

        disable_export = Settings.Get("general.disable_export", True)
        # Setting may come in as a string ("1"/"") from query-param PUTs; coerce to bool.
        if isinstance(disable_export, str):
            disable_export = disable_export.strip().lower() not in ("", "0", "false", "no", "off")
        if not disable_export:
            for change in changes:
                key = change["key"]
                filename = "/".join(_safe_segment(p) for p in key.split("."))
                action = change["action"]

                # Per KEY, not per batch. One label writing to a path the OS
                # refuses — a file OBS has open on Windows, a full disk, a
                # permission — used to raise straight out of Export and take
                # every remaining change in the batch with it, so one bad key
                # silently froze unrelated labels. A label is an independent
                # output; failing one must not cost the others.
                try:
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
                except Exception:
                    logger.exception("[State] stream-label export failed for {}", key)

    @classmethod
    def MarkDirty(cls):
        """Note that state.json is behind. Cheap, sync, safe from any context."""
        if cls._persist_dirty is None:
            cls._persist_dirty = asyncio.Event()
        cls._persist_dirty.set()

    @classmethod
    async def Persister(cls):
        """Write state.json at most once per PERSIST_INTERVAL.

        Leading write then a trailing one: the first change after a quiet period
        lands immediately, and everything inside the following interval collapses
        into a single write at the end of it. Nothing is dropped — the flag is
        cleared BEFORE the write, so a change that arrives during one is still
        pending afterwards.
        """
        try:
            while True:
                if cls._persist_dirty is None:
                    cls._persist_dirty = asyncio.Event()
                await cls._persist_dirty.wait()
                cls._persist_dirty.clear()
                try:
                    await cls.SaveImmediately()
                except Exception:
                    logger.exception("[State] could not persist state.json")
                await asyncio.sleep(PERSIST_INTERVAL)
        except asyncio.CancelledError:
            return

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
        # Snapshot-and-clear in one statement so concurrent Set/SetBatch
        # appends after this point go into the next Save's batch instead
        # of being silently dropped.
        tracked, cls.changed_keys = cls.changed_keys, []
        changes = cls._compute_changes(tracked)

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
    def _compute_changes(cls, tracked: list[str]) -> list[dict]:
        """Build a list of changes by comparing tracked keys between last_state and state.

        A key that is GONE from `state` is reported as an unset, not as a
        set-to-None. The distinction matters twice: Export removes the label file
        instead of writing "None", and Save drops the key from `last_state`
        instead of leaving a None behind. That None was not inert — `deep_set`
        descends through `last_state`, so the next write to anything *under* an
        unset path (board and match ids are reused, so this is routine) walked
        into it and raised TypeError out of Save.
        """
        changes = []
        seen = set()
        for key in tracked:
            if key in seen:
                continue
            seen.add(key)

            old_val = deep_get(cls.last_state, key, _MISSING)
            new_val = deep_get(cls.state, key, _MISSING)

            if old_val is _MISSING and new_val is _MISSING:
                continue

            if new_val is _MISSING:
                changes.append({
                    "key": key,
                    "old": None if old_val is _MISSING else old_val,
                    "new": None,
                    "action": "unset",
                })
                continue

            old_val = None if old_val is _MISSING else old_val
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
        # Write to a sibling .tmp file then atomically rename. Without this,
        # a kill mid-write leaves state.json truncated and Load() silently
        # falls back to {}, losing all persisted state.
        #
        # Under a lock (as Settings.Save and Participants.Save are) because the
        # atomicity is only as good as the tmp file: two writers share one .tmp
        # path, and there is an await between the open that truncates it and the
        # write that fills it. Shutdown is exactly where that happens — the
        # explicit final save runs alongside whatever the persister had going.
        if cls._save_lock is None:
            cls._save_lock = asyncio.Lock()
        async with cls._save_lock:
            tmp = AsyncPath(str(cls._state_file()) + ".tmp")
            async with tmp.open(mode='wb') as f:
                d = await json.dumps(cls.state)
                await f.write(d)
            await tmp.replace(cls._state_file())

    @classmethod
    async def Load(cls):
        try:
            async with cls._state_file().open(mode='rb', encoding='utf-8') as f:
                cls.state = await json.loads(await f.read())
        except Exception:
            logger.warning("unable to load state.json, using default dict")
        cls.last_state = copy.deepcopy(cls.state)

    @classmethod
    async def _augment(cls, entries: list[tuple[str, object]]) -> list[tuple[str, object]]:
        """Run the write-path hooks and apply whatever they add.

        Hooks run AFTER the triggering entries have landed in `state`, so a hook
        reads the post-write world — the whole reason a rule can resolve content
        out of the same batch that changed it. A hook that raises is logged and
        skipped: an automation must never be able to lose a state write.

        Hooks must NOT call Set/SetBatch themselves; they return entries. That is
        what keeps this non-reentrant.

        WHAT THEY RETURN IS EMITTED SEPARATELY, under `augmented` rather than
        mixed into `items`, and that separation is load-bearing. A client
        suppresses the echo of its OWN frame by session id (src/context/socket.jsx)
        — which is right for the keys it just wrote and wrong for these, because a
        hook's entries are not the client's write at all: they are the server's
        answer to it. Folded into `items`, every one of them was dropped by the
        one client that most needed it. A producer's Push writes the container
        feed, the automation engine answers with `production.feed.reason.{id} =
        manual`, and that producer's console went on saying "resting" — i.e. that
        the rules were still running — until something else happened to write the
        key or the page was reloaded. Every other browser had it right, which is
        what made it read as flaky rather than as wrong.
        """
        if not cls.hooks:
            return []
        added: list[tuple[str, object]] = []
        for hook in cls.hooks:
            try:
                extra = await hook(entries)
            except Exception:
                logger.exception("state write hook errored")
                continue
            for key, value in (extra or []):
                deep_set(cls.state, key, value)
                cls.changed_keys.append(key)
                added.append((key, value))
        return added

    @classmethod
    async def _notify_unset(cls, keys: list[str]) -> None:
        for hook in cls.unset_hooks:
            try:
                await hook(keys)
            except Exception:
                logger.exception("state unset hook errored")

    @classmethod
    async def Set(cls, key: str, value, session_id: str | None = None):
        deep_set(cls.state, key, value)
        cls.changed_keys.append(key)
        added = await cls._augment([(key, value)])
        if added:
            # A hook folded work into a single Set, so the wire shape becomes the
            # batch one — every consumer handles both, and splitting it into two
            # frames would put the trigger on air a frame before its consequence.
            await socketio.emit('v1.state.set_batch', {
                "items": [{"key": key, "value": value}],
                "augmented": [{"key": k, "value": v} for k, v in added],
                "sid": session_id
            })
            return
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
        entries = list(entries)
        items = []
        for key, value in entries:
            deep_set(cls.state, key, value)
            cls.changed_keys.append(key)
            items.append({"key": key, "value": value})

        # Anything a hook decides off this write rides the SAME frame, in its own
        # list — see `augmented` below.
        augmented = [{"key": k, "value": v} for k, v in await cls._augment(entries)]

        await socketio.emit('v1.state.set_batch', {
            "items": items,
            "augmented": augmented,
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
        await cls._notify_unset([key])

    @classmethod
    async def UnsetBatch(cls, keys: list[str], session_id: str | None = None):
        """Unset multiple keys at once and emit a single batched SocketIO event.

        Mirrors SetBatch — collapses N socket frames + N disk writes into one.
        """
        items = []
        keys = list(keys)
        for key in keys:
            deep_unset(cls.state, key)
            cls.changed_keys.append(key)
            items.append({"key": key})

        await socketio.emit('v1.state.unset_batch', {
            "items": items,
            "sid": session_id
        })
        await cls._notify_unset(keys)

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
        except Exception:
            logger.exception("unable to download image")

    @classmethod
    async def _create_files_dict(cls, path, di):
        pathdirs = "/".join(path.split("/")[0:-1])
        _p = AsyncPath(f"{cls._labels_dir()}/{pathdirs}")
        if await _p.is_dir() == False:
            await _p.mkdir(parents=True, exist_ok=True)

        if di is None:
            # Write empty file so OBS Text (GDI+) sources never point at a missing path
            await AsyncPath(f"{cls._labels_dir()}/{path}.txt").write_text("")
            return

        if isinstance(di, dict):
            for k, i in di.items():
                await cls._create_files_dict(path + "/" + _safe_segment(k), i)
        elif isinstance(di, str) and di.startswith("./"):
            _p = AsyncPath(f"{cls._labels_dir()}/{path}" + "." + di.rsplit(".", 1)[-1])
            if await _p.exists() == True:
                try:
                    await _p.unlink()
                except Exception:
                    logger.exception("unable to remove file")
        elif isinstance(di, str) and di.startswith("http") and (di.endswith(".png") or di.endswith("jpg")):
            try:
                _p = AsyncPath(f"{cls._labels_dir()}/{path}" + "." + di.rsplit(".", 1)[-1])
                if await _p.exists() == True:
                    await _p.unlink()
            except Exception:
                logger.exception("error in create_files_dict")
            finally:
                await cls.queue.put(partial(
                    cls._download_image,
                    url=di,
                    dlpath = _p
                ))
        else:
            await AsyncPath(f"{cls._labels_dir()}/{path}.txt").write_text(str(di))

    @classmethod
    async def _remove_files_dict(cls, path, di):
        if isinstance(di, dict):
            for k, i in di.items():
                await cls._remove_files_dict(path + "/" + _safe_segment(k), i)
        elif isinstance(di, str) and (di.startswith("./") or di.startswith("http")):
            try:
                _p = AsyncPath(f"{cls._labels_dir()}/{path}." + di.rsplit(".", 1)[-1])
                if await _p.exists() == True:
                    await _p.unlink()
            except Exception:
                logger.exception("unable to remove file")
        else:
            try:
                _p = AsyncPath(f"{cls._labels_dir()}/{path}.txt")
                if await _p.exists() == True:
                    await _p.unlink()
            except Exception:
                logger.exception("unable to remove file")

        try:
            _p = AsyncPath(f"{cls._labels_dir()}/{path}")
            if await _p.exists() == True:
                await asyncio.to_thread(rmtree, str(_p))
        except Exception:
            logger.exception("unable to remove directory")

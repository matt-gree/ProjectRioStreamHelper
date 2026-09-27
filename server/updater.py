"""In-app updater: check → download → install-and-relaunch, on macOS and Windows.

The release check itself already existed (`server/announcements.py` asks
GitHub's `/releases/latest` and synthesizes an "Update available" toast); this
module is what turns that toast into something a producer can act on without
leaving PRSH. It deliberately stops at TWO presses: the download runs in the
background and lands in `ready`, and nothing is installed until the producer
says so — an update restarts the server, and every OBS source blanks while it
does, so WHEN is always the producer's call, never ours.

Per platform, the asset is the one `build-release.yml` attaches:

    Windows  PRSH-Setup.exe             run silently, elevated (the installer is
                                        per-machine), told to wait for THIS
                                        process to exit and to relaunch PRSH
                                        (`/WAITPID`, `/RELAUNCH` — installer/PRSH.iss)
    macOS    PRSH-macOS-{arm64,x86_64}.zip
                                        unpacked with `ditto` (keeps the bundle's
                                        symlinks), then swapped in by a detached
                                        script that waits for this pid, moves the
                                        old bundle aside, moves the new one in,
                                        reopens it — and puts the old one back if
                                        either move fails

A running process cannot replace its own files on either platform, so both
paths hand the swap to something outside the process and then ask the app to
exit through the SAME route its own Exit button takes (`set_exit_hook`, wired
by main.py) — the tray on macOS, the Tk window on Windows — so the gc-overlay
child is stopped and the port released before the new build binds it.

A source checkout can CHECK (the Settings row still says a release shipped)
but never installs: there is no bundle to replace, and `git pull` is the update.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import platform
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

import httpx
from loguru import logger

from server import socketio
from server.settings import Config


GITHUB_REPO = "matt-gree/ProjectRioStreamHelper"
LATEST_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
BUNDLE_ID = "com.projectrio.streamhelper"
CHECK_TIMEOUT_SEC = 15
# Seconds between the install response and the exit request, so the HTTP reply
# (and the `installing` status frame) reach the browser before the server goes.
EXIT_DELAY_SEC = 1.0


def _release_key(v):
    # Imported lazily: announcements imports this module to hand it releases.
    from server.announcements import _release_key as key
    return key(v)


def _is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))


def asset_name_for(system: str, machine: str) -> str | None:
    """The release asset this platform installs, or None where there is none.

    `machine` is the PROCESS's architecture, not the Mac's: an x86_64 build
    under Rosetta reports x86_64 and so updates to the x86_64 build, which is
    what that user chose to install.
    """
    if system == "win32":
        return "PRSH-Setup.exe"
    if system == "darwin":
        arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x86_64"}.get(machine)
        return f"PRSH-macOS-{arch}.zip" if arch else None
    return None


def pick_asset(release: dict, name: str | None) -> dict | None:
    if not name:
        return None
    for a in release.get("assets") or []:
        if isinstance(a, dict) and a.get("name") == name and a.get("browser_download_url"):
            return {
                "name": name,
                "url": a["browser_download_url"],
                "size": int(a.get("size") or 0),
                # GitHub publishes `sha256:<hex>` per asset; older releases
                # carry none, and then the size is the only check there is.
                "digest": a.get("digest") or None,
            }
    return None


def mac_app_path() -> Path | None:
    """The running `.app` bundle: `…/PRSH.app/Contents/MacOS/PRSH` → `…/PRSH.app`."""
    exe = Path(sys.executable).resolve()
    app = exe.parents[2] if len(exe.parents) > 2 else None
    return app if app is not None and app.suffix == ".app" else None


def install_blocker() -> str | None:
    """Why THIS process cannot install an update, in the producer's words — or None."""
    if not _is_frozen():
        return "Running from source. Update with git pull."
    if sys.platform == "win32":
        return None
    if sys.platform == "darwin":
        app = mac_app_path()
        if app is None:
            return "Couldn’t find the PRSH app bundle."
        # Gatekeeper runs an app opened straight out of Downloads from a
        # read-only randomized copy; replacing that copy replaces nothing.
        if "/AppTranslocation/" in str(app):
            return "Move PRSH into Applications and open it from there, then update."
        if not os.access(app.parent, os.W_OK) or not os.access(app, os.W_OK):
            return f"PRSH can’t write to {app.parent}. Update it by hand from GitHub."
        return None
    return "Updating in-app isn’t supported on this platform."


def updates_dir() -> Path:
    from server.paths import _frozen_writable_root
    p = (_frozen_writable_root() or Path(".").resolve()) / "updates"
    p.mkdir(parents=True, exist_ok=True)
    return p


# The swap, run detached after PRSH exits. `$1` pid · `$2` installed .app ·
# `$3` new .app. Every failure path reopens WHICHEVER bundle is in place, so a
# failed update never leaves the producer with no PRSH at all.
_MAC_SWAP_SCRIPT = r"""#!/bin/bash
PID="$1"; TARGET="$2"; NEW="$3"
BACKUP="$(dirname "$TARGET")/.PRSH-update-backup.app"
echo "[$(date)] waiting for PRSH ($PID) to exit"
for _ in $(seq 1 120); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then
  echo "PRSH did not exit; update abandoned"
  exit 1
fi
rm -rf "$BACKUP"
if ! mv "$TARGET" "$BACKUP"; then
  echo "could not move the installed app aside; update abandoned"
  open "$TARGET"
  exit 1
fi
if ! mv "$NEW" "$TARGET"; then
  echo "could not move the new app into place; restoring the previous one"
  mv "$BACKUP" "$TARGET"
  open "$TARGET"
  exit 1
fi
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
rm -rf "$BACKUP"
echo "[$(date)] updated; relaunching"
open "$TARGET" --args --after-update
"""


class Updater:
    """Singleton. Status is broadcast as `v1.update.status` on every change."""

    state: str = "idle"  # idle|checking|up_to_date|available|downloading|ready|installing|error
    latest: str | None = None
    release_url: str | None = None
    asset: dict | None = None
    downloaded: int = 0
    error: str | None = None
    # The file (Windows installer) or bundle (macOS .app) `install` hands over.
    _payload: Path | None = None
    _task: asyncio.Task | None = None
    _exit_hook: Callable[[], None] | None = None
    _last_emit: float = 0.0

    # ── wiring ──

    @classmethod
    def set_exit_hook(cls, fn: Callable[[], None] | None) -> None:
        """How the app exits the way its own Exit button does. Called from the
        server thread, so the hook must marshal to the UI thread itself."""
        cls._exit_hook = fn

    @classmethod
    def reset(cls) -> None:
        cls.state, cls.latest, cls.release_url, cls.asset = "idle", None, None, None
        cls.downloaded, cls.error, cls._payload, cls._task = 0, None, None, None

    @classmethod
    def cleanup(cls) -> None:
        """Drop the previous run's downloads. A new build boots here after an
        update, so this is also what deletes the installer it came from."""
        if not _is_frozen():
            return
        try:
            shutil.rmtree(updates_dir(), ignore_errors=True)
        except Exception:
            logger.debug("[Updater] cleanup failed", exc_info=True)

    # ── status ──

    @classmethod
    def status(cls) -> dict:
        blocker = install_blocker()
        return {
            "state": cls.state,
            "current": Config.config.get("version", "0.0.0"),
            "latest": cls.latest,
            "release_url": cls.release_url,
            "asset": cls.asset and {"name": cls.asset["name"], "size": cls.asset["size"]},
            "downloaded": cls.downloaded,
            "error": cls.error,
            "can_install": blocker is None,
            "blocker": blocker,
        }

    @classmethod
    async def _emit(cls, force: bool = True) -> None:
        now = time.monotonic()
        if not force and now - cls._last_emit < 0.25:
            return
        cls._last_emit = now
        await socketio.emit("v1.update.status", cls.status())

    # ── check ──

    @classmethod
    async def note_release(cls, release: dict) -> None:
        """Take GitHub's latest-release payload (from here or from Announcements)."""
        if cls.state in ("downloading", "ready", "installing"):
            return
        tag = (release.get("tag_name") or "").strip()
        current = Config.config.get("version", "0.0.0")
        if not tag or _release_key(tag) <= _release_key(current):
            cls.state, cls.latest, cls.asset, cls.release_url = "up_to_date", tag or None, None, None
        else:
            cls.latest = tag
            cls.release_url = release.get("html_url") or None
            cls.asset = pick_asset(release, asset_name_for(sys.platform, platform.machine()))
            cls.state = "available"
        cls.error = None
        await cls._emit()

    @classmethod
    async def check(cls) -> dict:
        if cls.state in ("downloading", "ready", "installing"):
            return cls.status()
        cls.state, cls.error = "checking", None
        await cls._emit()
        try:
            async with httpx.AsyncClient(timeout=CHECK_TIMEOUT_SEC) as client:
                r = await client.get(
                    LATEST_RELEASE_URL, follow_redirects=True,
                    headers={"Accept": "application/vnd.github+json"},
                )
            if r.status_code != 200:
                raise RuntimeError(f"GitHub answered HTTP {r.status_code}")
            await cls.note_release(r.json())
        except Exception as e:
            logger.info("[Updater] check failed: {}", e)
            cls.state, cls.error = "error", "Couldn’t reach GitHub to check for updates."
            await cls._emit()
        return cls.status()

    # ── download ──

    @classmethod
    async def download(cls) -> dict:
        if cls.state == "downloading" or cls.state == "ready":
            return cls.status()
        if cls.state != "available" or not cls.asset:
            raise UpdateError("There’s no update to download.")
        blocker = install_blocker()
        if blocker:
            raise UpdateError(blocker)
        cls.state, cls.downloaded, cls.error = "downloading", 0, None
        await cls._emit()
        cls._task = asyncio.create_task(cls._download(), name="updater-download")
        return cls.status()

    @classmethod
    async def _download(cls) -> None:
        asset = cls.asset
        dest_dir = updates_dir()
        part = dest_dir / f"{asset['name']}.part"
        final = dest_dir / asset["name"]
        try:
            sha = hashlib.sha256()
            async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=60)) as client:
                async with client.stream("GET", asset["url"], follow_redirects=True) as r:
                    if r.status_code != 200:
                        raise UpdateError(f"Download failed (HTTP {r.status_code}).")
                    with open(part, "wb") as f:
                        async for chunk in r.aiter_bytes(1 << 16):
                            f.write(chunk)
                            sha.update(chunk)
                            cls.downloaded += len(chunk)
                            await cls._emit(force=False)
            verify_download(cls.downloaded, sha.hexdigest(), asset)
            os.replace(part, final)
            cls._payload = await asyncio.to_thread(prepare_payload, final, dest_dir)
            cls.state = "ready"
            logger.info("[Updater] {} downloaded and ready", cls.latest)
        except asyncio.CancelledError:
            part.unlink(missing_ok=True)
            raise
        except Exception as e:
            logger.opt(exception=not isinstance(e, UpdateError)).warning(
                "[Updater] download failed: {}", e)
            part.unlink(missing_ok=True)
            cls.state = "error"
            cls.error = str(e) if isinstance(e, UpdateError) else "The download failed. Try again."
        await cls._emit()

    # ── install ──

    @classmethod
    async def install(cls) -> dict:
        if cls.state != "ready" or cls._payload is None:
            raise UpdateError("Download the update first.")
        blocker = install_blocker()
        if blocker:
            raise UpdateError(blocker)
        if cls._exit_hook is None:
            raise UpdateError("PRSH can’t restart itself from here. Quit it and run the installer by hand.")
        try:
            if sys.platform == "win32":
                await asyncio.to_thread(_launch_windows_installer, cls._payload)
            else:
                _launch_mac_swap(cls._payload)
        except UpdateError:
            raise
        except Exception as e:
            logger.exception("[Updater] could not hand over the install")
            raise UpdateError(f"Couldn’t start the installer: {e}") from e
        cls.state = "installing"
        await cls._emit()
        logger.info("[Updater] installing {}; exiting", cls.latest)
        asyncio.get_running_loop().call_later(EXIT_DELAY_SEC, cls._exit_hook)
        return cls.status()


class UpdateError(Exception):
    """A failure the producer is shown verbatim."""


def verify_download(size: int, sha256_hex: str, asset: dict) -> None:
    if asset.get("size") and size != asset["size"]:
        raise UpdateError("The download was incomplete. Try again.")
    digest = asset.get("digest") or ""
    if digest.startswith("sha256:") and digest[7:].lower() != sha256_hex.lower():
        raise UpdateError("The download didn’t match the release’s checksum.")


def prepare_payload(downloaded: Path, dest_dir: Path) -> Path:
    """What `install` hands over: the installer itself on Windows, the unpacked
    and sanity-checked `.app` on macOS (so a bad zip fails at DOWNLOAD time,
    while the producer can still ignore it, rather than mid-restart)."""
    if sys.platform != "darwin":
        return downloaded
    out = dest_dir / "extracted"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    # ditto, not zipfile: the bundle is full of symlinks (the zip is built
    # with `zip -y` to keep them), and zipfile writes each one as a file.
    subprocess.run(["/usr/bin/ditto", "-x", "-k", str(downloaded), str(out)],
                   check=True, capture_output=True)
    app = out / "PRSH.app"
    try:
        with open(app / "Contents" / "Info.plist", "rb") as f:
            bundle_id = plistlib.load(f).get("CFBundleIdentifier")
    except Exception:
        bundle_id = None
    if bundle_id != BUNDLE_ID:
        raise UpdateError("The downloaded app isn’t a PRSH build.")
    downloaded.unlink(missing_ok=True)
    return app


def _launch_windows_installer(setup: Path) -> None:
    # ShellExecute, not CreateProcess: the installer asks for elevation, and
    # only ShellExecute raises the UAC prompt (CreateProcess fails with 740).
    # It returns once the prompt is answered; declining raises OSError 1223,
    # and PRSH simply keeps running.
    args = (f"/SILENT /SUPPRESSMSGBOXES /NORESTART "
            f"/WAITPID={os.getpid()} /RELAUNCH=1")
    try:
        os.startfile(str(setup), "open", args)  # type: ignore[attr-defined]
    except OSError as e:
        if getattr(e, "winerror", None) == 1223:
            raise UpdateError("The update was cancelled at the Windows permission prompt.") from e
        raise


def _launch_mac_swap(new_app: Path) -> None:
    target = mac_app_path()
    if target is None:
        raise UpdateError("Couldn’t find the PRSH app bundle.")
    d = updates_dir()
    script = d / "swap.sh"
    script.write_text(_MAC_SWAP_SCRIPT, encoding="utf-8")
    from server.paths import logs_dir
    log = open(logs_dir() / "prsh_update.txt", "a", encoding="utf-8")
    # A new session, so the script outlives the app it is replacing.
    subprocess.Popen(
        ["/bin/bash", str(script), str(os.getpid()), str(target), str(new_app)],
        stdin=subprocess.DEVNULL, stdout=log, stderr=log,
        start_new_session=True, close_fds=True,
    )

"""Announcements + version update check.

Pulls two things from GitHub and broadcasts matching items to all clients:

1. Release check — GET /repos/{repo}/releases/latest. If the tag is newer than
   the running version, a synthetic "Update available" announcement is added.

2. Arbitrary announcements — a JSON file on a dedicated `announcements` branch:
   https://raw.githubusercontent.com/{repo}/announcements/announcements.json

   Each entry:
     {
       "id": "unique-id",            required, used for dismiss tracking
       "title": "Short heading",     required
       "body":  "Longer text",       optional
       "severity": "info|warn|error|success", default "info"
       "min_version": "1.0.0",       optional, inclusive lower bound
       "max_version": "1.9.9",       optional, inclusive upper bound
       "expires_at": "2026-12-31T00:00:00Z",  optional, ISO-8601
       "link_url": "https://...",    optional
       "link_text": "View details"   optional
     }

Dismissals are stored in user settings under announcements.dismissed_ids.
"""

import asyncio
from datetime import datetime, timezone

import httpx
from loguru import logger

from server import socketio
from server.settings import Settings, Config


GITHUB_REPO = "matt-gree/ProjectRioStreamHelper"
ANNOUNCEMENTS_BRANCH = "announcements"
ANNOUNCEMENTS_URL = (
    f"https://raw.githubusercontent.com/{GITHUB_REPO}/"
    f"{ANNOUNCEMENTS_BRANCH}/announcements.json"
)
LATEST_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
REFRESH_INTERVAL_SEC = 6 * 60 * 60
FETCH_TIMEOUT_SEC = 10
INITIAL_DELAY_SEC = 5


def _parse_version(v: str | None) -> tuple:
    if not v:
        return (0,)
    v = v.lstrip("vV").split("-")[0].split("+")[0]
    try:
        return tuple(int(p) for p in v.split("."))
    except ValueError:
        return (0,)


def _version_in_range(current: str, min_v: str | None, max_v: str | None) -> bool:
    cv = _parse_version(current)
    if min_v and cv < _parse_version(min_v):
        return False
    if max_v and cv > _parse_version(max_v):
        return False
    return True


def _not_expired(expires_at: str | None) -> bool:
    if not expires_at:
        return True
    try:
        exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return exp > datetime.now(timezone.utc)
    except Exception:
        return True


class Announcements:
    _task: asyncio.Task | None = None
    _active: list = []

    @classmethod
    async def Start(cls):
        if cls._task is not None:
            return
        cls._task = asyncio.create_task(cls._run(), name="announcements")

    @classmethod
    async def Stop(cls):
        if cls._task is None:
            return
        cls._task.cancel()
        try:
            await cls._task
        except (asyncio.CancelledError, Exception):
            pass
        cls._task = None

    @classmethod
    async def _run(cls):
        try:
            await asyncio.sleep(INITIAL_DELAY_SEC)
        except asyncio.CancelledError:
            return
        while True:
            try:
                await cls.Refresh()
            except Exception:
                logger.exception("[Announcements] refresh failed")
            try:
                await asyncio.sleep(REFRESH_INTERVAL_SEC)
            except asyncio.CancelledError:
                return

    @classmethod
    async def Refresh(cls):
        current_version = Config.config.get("version", "0.0.0")
        dismissed = set(Settings.Get("announcements.dismissed_ids", []))
        check_updates = Settings.Get("announcements.check_for_updates", True)

        items: list = []
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SEC) as client:
            try:
                r = await client.get(ANNOUNCEMENTS_URL, follow_redirects=True)
                if r.status_code == 200:
                    raw = r.json()
                    if isinstance(raw, list):
                        items.extend(x for x in raw if isinstance(x, dict))
                elif r.status_code != 404:
                    logger.debug("[Announcements] JSON fetch HTTP {}", r.status_code)
            except Exception as e:
                logger.debug("[Announcements] JSON fetch failed: {}", e)

            if check_updates:
                try:
                    r = await client.get(
                        LATEST_RELEASE_URL,
                        follow_redirects=True,
                        headers={"Accept": "application/vnd.github+json"},
                    )
                    if r.status_code == 200:
                        rel = r.json()
                        tag = (rel.get("tag_name") or "").strip()
                        url = rel.get("html_url") or ""
                        if tag and _parse_version(tag) > _parse_version(current_version):
                            items.append({
                                "id": f"update-{tag}",
                                "title": f"Update available: {tag}",
                                "body": "A new version of PRSH is available on GitHub.",
                                "severity": "info",
                                "link_url": url,
                                "link_text": "View release",
                            })
                    elif r.status_code != 404:
                        logger.debug("[Announcements] release fetch HTTP {}", r.status_code)
                except Exception as e:
                    logger.debug("[Announcements] release fetch failed: {}", e)

        active: list = []
        for it in items:
            aid = it.get("id")
            if not aid or aid in dismissed:
                continue
            if not _not_expired(it.get("expires_at")):
                continue
            if not _version_in_range(
                current_version, it.get("min_version"), it.get("max_version")
            ):
                continue
            active.append(it)

        cls._active = active
        await socketio.emit("v1.announcements.set", {"items": active})
        logger.debug("[Announcements] broadcast {} item(s)", len(active))

    @classmethod
    async def Dismiss(cls, announcement_id: str):
        dismissed = list(Settings.Get("announcements.dismissed_ids", []))
        if announcement_id not in dismissed:
            dismissed.append(announcement_id)
            await Settings.Set("announcements.dismissed_ids", dismissed)
        cls._active = [it for it in cls._active if it.get("id") != announcement_id]
        await socketio.emit("v1.announcements.set", {"items": cls._active})

    @classmethod
    async def DismissAll(cls):
        """Permanently dismiss every currently-active announcement."""
        dismissed = list(Settings.Get("announcements.dismissed_ids", []))
        active_ids = [it.get("id") for it in cls._active if it.get("id")]
        added = False
        for aid in active_ids:
            if aid not in dismissed:
                dismissed.append(aid)
                added = True
        if added:
            await Settings.Set("announcements.dismissed_ids", dismissed)
        cls._active = []
        await socketio.emit("v1.announcements.set", {"items": []})
        return len(active_ids)

    @classmethod
    def GetActive(cls) -> list:
        return list(cls._active)

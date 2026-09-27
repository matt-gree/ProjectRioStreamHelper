"""In-app updater — asset choice, install blockers, the download's integrity
checks, and the two-press ordering (nothing installs until `ready`).

The platform halves (ShellExecute of the Inno installer, the macOS swap script)
cannot run here; what CAN go wrong silently is choosing the wrong asset, trusting
a truncated or tampered download, or letting an install start from the wrong
state — each of which would restart a producer's broadcast into a broken build.
"""
import hashlib
from types import SimpleNamespace

import pytest

from server import updater as up
from server.updater import (
    Updater, UpdateError, asset_name_for, pick_asset, verify_download,
)
from server.settings import Config


@pytest.mark.parametrize("system,machine,expected", [
    ("win32", "AMD64", "PRSH-Setup.exe"),
    ("darwin", "arm64", "PRSH-macOS-arm64.zip"),
    ("darwin", "x86_64", "PRSH-macOS-x86_64.zip"),  # why: Rosetta keeps its build
    ("darwin", "ppc", None),
    ("linux", "x86_64", None),
])
def test_asset_name_for_each_platform(system, machine, expected):
    assert asset_name_for(system, machine) == expected


RELEASE = {
    "tag_name": "v9.9.9",
    "html_url": "https://github.com/x/releases/v9.9.9",
    "assets": [
        {"name": "PRSH-macOS-arm64.zip", "browser_download_url": "https://dl/arm",
         "size": 10, "digest": "sha256:ab"},
        {"name": "PRSH-Setup.exe", "browser_download_url": "https://dl/exe", "size": 20},
    ],
}


def test_pick_asset_by_exact_name_and_keeps_digest():
    a = pick_asset(RELEASE, "PRSH-macOS-arm64.zip")
    assert a == {"name": "PRSH-macOS-arm64.zip", "url": "https://dl/arm",
                 "size": 10, "digest": "sha256:ab"}
    assert pick_asset(RELEASE, "PRSH-Setup.exe")["digest"] is None
    assert pick_asset(RELEASE, "PRSH-macOS-x86_64.zip") is None
    assert pick_asset(RELEASE, None) is None


def test_verify_download_rejects_short_and_tampered_files():
    good = hashlib.sha256(b"abc").hexdigest()
    verify_download(3, good, {"size": 3, "digest": f"sha256:{good}"})
    verify_download(3, good, {"size": 3, "digest": None})  # older release: size only
    with pytest.raises(UpdateError):
        verify_download(2, good, {"size": 3})
    with pytest.raises(UpdateError):
        verify_download(3, "0" * 64, {"size": 3, "digest": f"sha256:{good}"})


def test_a_source_checkout_can_check_but_never_install():
    assert up.install_blocker() == "Running from source. Update with git pull."
    assert Updater.status()["can_install"] is False


async def test_note_release_offers_only_a_newer_version(monkeypatch):
    monkeypatch.setitem(Config.config, "version", "9.9.9")
    await Updater.note_release(RELEASE)
    assert Updater.status()["state"] == "up_to_date"

    monkeypatch.setitem(Config.config, "version", "9.9.8")
    monkeypatch.setattr(up.sys, "platform", "darwin")
    monkeypatch.setattr(up.platform, "machine", lambda: "arm64")
    await Updater.note_release(RELEASE)
    s = Updater.status()
    assert (s["state"], s["latest"], s["asset"]["name"]) == \
        ("available", "v9.9.9", "PRSH-macOS-arm64.zip")


async def test_a_release_check_never_clobbers_a_download_in_flight(monkeypatch):
    Updater.state = "ready"
    monkeypatch.setitem(Config.config, "version", "9.9.9")
    await Updater.note_release(RELEASE)
    assert Updater.state == "ready"


async def test_download_and_install_refuse_out_of_order():
    with pytest.raises(UpdateError):
        await Updater.download()     # nothing available
    with pytest.raises(UpdateError):
        await Updater.install()      # nothing downloaded


# --- the download itself, over a fake streaming client ---

class _Stream:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def aiter_bytes(self, n):
        for i in range(0, len(self._body), 2):
            yield self._body[i:i + 2]


def _fake_httpx(body, status=200):
    class _Client:
        def __init__(self, timeout=None):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url, **kw):
            return _Stream(status, body)

    return SimpleNamespace(AsyncClient=_Client, Timeout=lambda *a, **k: None)


@pytest.fixture
def frozen_windows(monkeypatch, tmp_path):
    monkeypatch.setattr(up, "install_blocker", lambda: None)
    monkeypatch.setattr(up, "updates_dir", lambda: tmp_path)
    monkeypatch.setattr(up.sys, "platform", "win32")
    return tmp_path


async def _download(body, digest):
    Updater.state, Updater.latest = "available", "v9.9.9"
    Updater.asset = {"name": "PRSH-Setup.exe", "url": "u", "size": len(body), "digest": digest}
    await Updater.download()
    await Updater._task


async def test_a_verified_download_is_ready_to_install(monkeypatch, frozen_windows):
    body = b"installer-bytes"
    monkeypatch.setattr(up, "httpx", _fake_httpx(body))
    await _download(body, "sha256:" + hashlib.sha256(body).hexdigest())
    assert Updater.state == "ready"
    assert Updater._payload == frozen_windows / "PRSH-Setup.exe"
    assert Updater._payload.read_bytes() == body


async def test_a_mismatched_download_is_discarded_not_installed(monkeypatch, frozen_windows):
    body = b"installer-bytes"
    monkeypatch.setattr(up, "httpx", _fake_httpx(body))
    await _download(body, "sha256:" + "0" * 64)
    assert Updater.state == "error"
    assert "checksum" in Updater.error
    assert list(frozen_windows.iterdir()) == []


async def test_install_hands_over_then_asks_the_app_to_exit(monkeypatch, frozen_windows):
    launched, exited = [], []
    Updater.state, Updater._payload = "ready", frozen_windows / "PRSH-Setup.exe"
    monkeypatch.setattr(up, "_launch_windows_installer", launched.append)
    monkeypatch.setattr(up, "EXIT_DELAY_SEC", 0)
    Updater.set_exit_hook(lambda: exited.append(True))
    await Updater.install()
    assert launched == [frozen_windows / "PRSH-Setup.exe"]
    assert Updater.state == "installing"
    import asyncio
    await asyncio.sleep(0.01)
    assert exited == [True]


async def test_a_refused_elevation_keeps_prsh_running(monkeypatch, frozen_windows):
    Updater.state, Updater._payload = "ready", frozen_windows / "PRSH-Setup.exe"
    Updater.set_exit_hook(lambda: pytest.fail("must not exit"))

    def _declined(_):
        raise UpdateError("cancelled")
    monkeypatch.setattr(up, "_launch_windows_installer", _declined)
    with pytest.raises(UpdateError):
        await Updater.install()
    assert Updater.state == "ready"

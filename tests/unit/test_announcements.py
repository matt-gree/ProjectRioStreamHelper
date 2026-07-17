"""Announcements — version parsing/gating, dismissal pruning, and the Refresh
feed merge (GitHub announcements.json + release check).

The pure helpers decide which announcements every user sees and whether the
"Update available" banner fires, so a silent regression here either spams
dismissed/expired items or hides a real update. Refresh is driven with a fake
httpx client — no network.
"""
from types import SimpleNamespace

import pytest

from server import announcements as ann
from server.announcements import (
    Announcements, _not_expired, _parse_version,
    _prune_stale_update_dismissals, _version_in_range,
)
from server.settings import Config, Settings


# --- _parse_version ---

@pytest.mark.parametrize("raw,expected", [
    ("v1.2.3", (1, 2, 3)),
    ("V2.0.0", (2, 0, 0)),
    ("1.2.3-beta+build5", (1, 2, 3)),   # why: pre-release/build tails stripped
    (None, (0,)),
    ("", (0,)),
    ("garbage", (0,)),
])
def test_parse_version(raw, expected):
    assert _parse_version(raw) == expected


# --- _version_in_range ---

@pytest.mark.parametrize("current,min_v,max_v,expected", [
    ("1.5.0", None, None, True),
    ("1.5.0", "1.5.0", "1.5.0", True),   # why: bounds are inclusive both sides
    ("1.4.9", "1.5.0", None, False),
    ("2.0.1", None, "2.0.0", False),
    ("1.9.9", "1.0.0", "2.0.0", True),
])
def test_version_in_range(current, min_v, max_v, expected):
    assert _version_in_range(current, min_v, max_v) is expected


# --- _not_expired ---

def test_not_expired_none_and_malformed_are_kept():
    assert _not_expired(None) is True
    assert _not_expired("not-a-date") is True  # why: fail open, never hide by accident


def test_not_expired_future_z_suffix_true_past_false():
    assert _not_expired("2999-01-01T00:00:00Z") is True
    assert _not_expired("2001-01-01T00:00:00Z") is False


def test_not_expired_naive_datetime_treated_as_utc():
    assert _not_expired("2999-01-01T00:00:00") is True
    assert _not_expired("2001-01-01T00:00:00") is False


# --- _prune_stale_update_dismissals ---

@pytest.mark.parametrize("dismissed,current,expected,changed", [
    (["update-1.0.0"], "1.0.0", [], True),          # <= current → pruned
    (["update-0.9.0"], "1.0.0", [], True),
    (["update-2.0.0"], "1.0.0", ["update-2.0.0"], False),
    (["some-manual-id"], "9.9.9", ["some-manual-id"], False),
    (["update-garbage"], "1.0.0", [], True),        # parses to (0,) → pruned
    ([42], "1.0.0", [42], False),                   # non-str entries untouched
])
def test_prune_stale_update_dismissals(dismissed, current, expected, changed):
    assert _prune_stale_update_dismissals(dismissed, current) == (expected, changed)


# --- Refresh (fake httpx client, no network) ---

class _FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeClient:
    """Async-context-manager stand-in for httpx.AsyncClient keyed by URL."""
    responses: dict = {}
    calls: list = []

    def __init__(self, timeout=None):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, **kw):
        type(self).calls.append(url)
        return type(self).responses.get(url, _FakeResponse(404))


@pytest.fixture
def fake_http(monkeypatch):
    _FakeClient.responses = {}
    _FakeClient.calls = []
    monkeypatch.setattr(ann, "httpx", SimpleNamespace(AsyncClient=_FakeClient))
    return _FakeClient


@pytest.fixture
def at_version(monkeypatch):
    def _set(v):
        monkeypatch.setitem(Config.config, "version", v)
    return _set


async def test_refresh_filters_dismissed_expired_and_out_of_range(
        fake_http, at_version, set_setting):
    at_version("1.0.0")
    set_setting("announcements.dismissed_ids", ["dismissed-id"])
    set_setting("announcements.check_for_updates", False)
    fake_http.responses[ann.ANNOUNCEMENTS_URL] = _FakeResponse(200, [
        {"id": "keep-me", "title": "Hello"},
        {"title": "no id — dropped"},
        {"id": "dismissed-id", "title": "dropped"},
        {"id": "expired", "title": "dropped", "expires_at": "2001-01-01T00:00:00Z"},
        {"id": "future-only", "title": "dropped", "min_version": "2.0.0"},
        "not-a-dict",
    ])
    await Announcements.Refresh()
    assert [it["id"] for it in Announcements.GetActive()] == ["keep-me"]


async def test_refresh_emits_announcements_set_frame(
        fake_http, at_version, mock_socket):
    at_version("1.0.0")
    fake_http.responses[ann.ANNOUNCEMENTS_URL] = _FakeResponse(200, [
        {"id": "a1", "title": "Hi"},
    ])
    await Announcements.Refresh()
    events = {c.args[0] for c in mock_socket.await_args_list}
    assert "v1.announcements.set" in events


async def test_refresh_synthesizes_update_item_for_newer_release(
        fake_http, at_version):
    at_version("1.0.0")
    fake_http.responses[ann.LATEST_RELEASE_URL] = _FakeResponse(200, {
        "tag_name": "v1.1.0", "html_url": "https://github.com/x/releases/v1.1.0",
    })
    await Announcements.Refresh()
    ids = [it["id"] for it in Announcements.GetActive()]
    assert ids == ["update-v1.1.0"]
    item = Announcements.GetActive()[0]
    assert item["link_url"] == "https://github.com/x/releases/v1.1.0"


async def test_refresh_no_update_item_when_release_not_newer(
        fake_http, at_version):
    at_version("1.1.0")
    fake_http.responses[ann.LATEST_RELEASE_URL] = _FakeResponse(200, {
        "tag_name": "v1.1.0", "html_url": "u",
    })
    await Announcements.Refresh()
    assert Announcements.GetActive() == []


async def test_refresh_skips_release_endpoint_when_updates_disabled(
        fake_http, at_version, set_setting):
    at_version("1.0.0")
    set_setting("announcements.check_for_updates", False)
    await Announcements.Refresh()
    assert ann.LATEST_RELEASE_URL not in fake_http.calls


async def test_refresh_prunes_stale_update_dismissals_into_settings(
        fake_http, at_version, set_setting):
    at_version("1.1.0")
    set_setting("announcements.dismissed_ids",
                ["update-1.0.0", "update-2.0.0", "manual-id"])
    await Announcements.Refresh()
    assert Settings.Get("announcements.dismissed_ids") == \
        ["update-2.0.0", "manual-id"]


# --- Dismiss / DismissAll ---

async def test_dismiss_removes_from_active_and_persists_id():
    Announcements._active = [{"id": "a1"}, {"id": "a2"}]
    await Announcements.Dismiss("a1")
    assert [it["id"] for it in Announcements.GetActive()] == ["a2"]
    assert "a1" in Settings.Get("announcements.dismissed_ids", [])


async def test_dismiss_all_empties_active_and_persists_every_id():
    Announcements._active = [{"id": "a1"}, {"id": "a2"}]
    count = await Announcements.DismissAll()
    assert count == 2
    assert Announcements.GetActive() == []
    dismissed = Settings.Get("announcements.dismissed_ids", [])
    assert {"a1", "a2"} <= set(dismissed)

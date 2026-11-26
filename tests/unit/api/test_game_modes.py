"""The two tiers of the game-mode catalogue.

Project Rio runs ~16 active modes against a catalogue of ~200. The active list
is what a producer picks from TODAY; the catalogue is what a console surface
needs to be able to NAME a mode, because a board's mode comes from the game it
is carrying and a pool of completed games is mostly ended seasons. Same
response shape either way — {name: id} — so a caller that wants both tiers asks
twice and takes the difference.

In-process via TestClient (the same harness as the integration suite) because
`@method` registers the handler on the router and hands back nothing to call.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.api import router_v1
from server.rio import stats_api


class _TagSet:
    def __init__(self, name, id):
        self.name, self.id = name, id


class _Client:
    """pyrio's client: ``tag_sets.list()`` is the full catalogue (ended
    seasons included), which also names a completed game's mode."""

    def __init__(self, modes=None, boom=False):
        self.modes = modes or {}
        self.boom = boom
        self.cache = None
        self.tag_sets = self

    async def list(self, active_only=False, community_ids=None):
        if self.boom:
            from pyrio.web import APIResponseError

            raise APIResponseError("catalogue unreadable")
        return [_TagSet(name, id) for name, id in self.modes.items()]


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_v1)
    return TestClient(app)


@pytest.fixture
def catalogue(monkeypatch):
    """Active list in memory; full tag-set catalogue behind the client."""
    monkeypatch.setattr(stats_api, "_game_modes", {"S14": 14}, raising=False)
    monkeypatch.setattr(stats_api, "_game_modes_lock", None, raising=False)
    monkeypatch.setattr(stats_api, "_cache_refresh_lock", None, raising=False)
    monkeypatch.setattr(stats_api, "_mode_names", {}, raising=False)

    def _install(modes=None, boom=False):
        monkeypatch.setattr(stats_api, "_get_client", lambda: _Client(modes, boom=boom))

    return _install


def test_default_scope_is_the_active_list(client, catalogue):
    catalogue({"S13": 13, "S14": 14})
    assert client.get("/api/v1/rio/game-modes").json() == {"S14": 14}


def test_scope_all_includes_ended_seasons(client, catalogue):
    catalogue({"S13": 13, "S14": 14})
    assert client.get("/api/v1/rio/game-modes?scope=all").json() == {"S13": 13, "S14": 14}


def test_unreadable_catalogue_falls_back_to_the_active_list(client, catalogue):
    """A picker offering less is a nuisance; one offering nothing is broken."""
    catalogue(boom=True)
    assert client.get("/api/v1/rio/game-modes?scope=all").json() == {"S14": 14}

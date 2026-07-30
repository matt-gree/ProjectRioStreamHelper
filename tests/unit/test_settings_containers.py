"""Shared containers are producer-built definitions in Settings.

`settings.production.container_defs.{id}` = name · native size · member roster.
Membership lives on the CONTAINER and nowhere else, so these pin the seed a
fresh install ships with, the two sizes that were wrong before the move, and
the removal of the per-element key that used to hold the other end of the same
relationship.

The frontend fixture in `src/test/containers.js` mirrors this seed; if you
change one, change both.
"""
import orjson

from server.settings import Settings


def _write_settings(path, data):
    (path / "settings.json").write_bytes(orjson.dumps(data))


def _defs():
    return Settings.settings["production"]["container_defs"]


async def test_seeds_the_containers_the_app_ships_with(isolate_user_data):
    await Settings.Load()
    defs = _defs()
    assert set(defs) == {"callout-stage", "stats-feed", "split-screen"}
    # Every definition carries the four things a container IS.
    for cid, d in defs.items():
        assert d["name"], cid
        assert isinstance(d["width"], int) and d["width"] > 0, cid
        assert isinstance(d["height"], int) and d["height"] > 0, cid
        assert isinstance(d["members"], list), cid


async def test_rosters_are_mutually_exclusive_across_containers(isolate_user_data):
    """One element, one container — the roster IS the membership relation."""
    await Settings.Load()
    seen = set()
    for d in _defs().values():
        for member in d["members"]:
            assert member not in seen, f"{member} is on two rosters"
            seen.add(member)


async def test_callout_stage_holds_both_post_game_callouts(isolate_user_data):
    await Settings.Load()
    stage = _defs()["callout-stage"]
    assert (stage["width"], stage["height"]) == (1920, 1080)
    # These two share a container precisely because they are alternatives: the
    # feed key holds one occupant, so they can never be up together.
    assert sorted(stage["members"]) == ["postgamecallout", "postgamevs"]


async def test_every_container_is_sized_to_its_member(isolate_user_data):
    """A container is the size of its largest member — no grandfathering.

    split-screen really was undersized (960x1080 around a 1280x720 hit
    visualizer) and now takes its member's size.

    stats-feed is the cautionary one. It was moved to 452x118 on the strength of
    a census line reading "stats 452x118" — but that is `stats.html`, the
    STANDALONE stat card (stats-card-mount, a ?team= variant). The fed `stats`
    element is the bar in stats-mount.js, whose native size is 325x120. The
    "fix" therefore left the container 2px too short for its only member, which
    `fitsContainer` would have filtered out of the container's own member picker.
    Two runtimes, one number: containers.test.jsx now pins the seeded defs
    against the element registry so this cannot recur silently.
    """
    await Settings.Load()
    defs = _defs()
    assert (defs["stats-feed"]["width"], defs["stats-feed"]["height"]) == (325, 120)
    assert defs["stats-feed"]["members"] == ["stats"]
    assert (defs["split-screen"]["width"], defs["split-screen"]["height"]) == (1280, 720)
    assert defs["split-screen"]["members"] == ["hitvisualizer"]


async def test_legacy_per_element_membership_is_dropped(isolate_user_data):
    """`production.containers` was the other end of the same relationship.

    Two homes for one fact is how these drift, so the old key is removed rather
    than translated — the seeded definitions already reproduce every pairing
    the defaults ever had.
    """
    _write_settings(isolate_user_data, {
        "production": {"containers": {"stats": "split-screen"}},
    })
    await Settings.Load()
    assert "containers" not in Settings.settings["production"]
    # …and the seed is intact, so nothing lost its home in the process.
    assert _defs()["stats-feed"]["members"] == ["stats"]

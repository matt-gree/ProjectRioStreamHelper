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


SEEDED = {
    "callout-stage", "stats-feed", "split-screen",
    "roster-stats-1", "roster-stats-2",
}


async def test_seeds_the_containers_the_app_ships_with(isolate_user_data):
    await Settings.Load()
    defs = _defs()
    assert set(defs) == SEEDED
    # Every definition carries the four things a container IS.
    for cid, d in defs.items():
        assert d["name"], cid
        assert isinstance(d["width"], int) and d["width"] > 0, cid
        assert isinstance(d["height"], int) and d["height"] > 0, cid
        assert isinstance(d["members"], list), cid


# Members with no content of their own: they draw whoever the CONTAINER's own
# scope has on the field, so they are the exception to exclusivity below.
# Mirrors `containerScoped` in src/routes/production/elements.js.
SCOPED_MEMBERS = {"roster", "statscard"}


async def test_rosters_are_mutually_exclusive_across_containers(isolate_user_data):
    """One element, one container — the roster IS the membership relation.

    Exclusivity is about an element's PUSH DESTINATION: a content-bearing element
    pushed from its own row has to land somewhere unambiguous. A container-scoped
    member has no content of its own, so the container is the subject rather than
    the element, and the same member on two rosters is not a conflict — it is the
    mirrored pair (one container per side, one canned rule) the automation engine
    was designed around.
    """
    await Settings.Load()
    seen = set()
    for d in _defs().values():
        for member in d["members"]:
            if member in SCOPED_MEMBERS:
                continue
            assert member not in seen, f"{member} is on two rosters"
            seen.add(member)


async def test_the_mirrored_pair_replaces_the_roster_stats_element(isolate_user_data):
    """Two scoped containers ARE the combined Roster + Stats source.

    452x240 is that element's own stage: the roster (452x140) and the stat card
    (380x220) both center inside it. Each container rests on the roster — its
    steady state and its boot state — and differs from its twin only by side,
    which is what makes one flash the batter and the other the pitcher off ONE
    rule.
    """
    await Settings.Load()
    defs = _defs()
    for cid, team in (("roster-stats-1", 1), ("roster-stats-2", 2)):
        d = defs[cid]
        assert (d["width"], d["height"]) == (452, 240), cid
        assert sorted(d["members"]) == ["roster", "statscard"], cid
        assert d["resting"] == "roster", cid
        assert d["scope"] == {"scoreboard": 1, "team": team}, cid

    # Deliberately NOT seeded: the flip is the half that has to be proven
    # against real HUD traffic, so the producer adds it from the quick-add
    # library and can suspend it with one switch.
    assert Settings.settings["production"]["automations"] == {}


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

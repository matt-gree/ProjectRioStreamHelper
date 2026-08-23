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
    "callout-stage", "split-screen",
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
SCOPED_MEMBERS = {"roster", "statscard", "controller", "playername", "teamlogo"}


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

    452x240 is that element's own stage: the roster (452x140) centers inside it
    and the stat card (380x240) fills its height. Each container rests on the roster — its
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


async def test_the_pair_ships_the_flip_that_made_it_that_element(isolate_user_data):
    """The rule is seeded WITH the pair, because it is the half that flips.

    A container resting on a roster is only half of what the deleted Roster +
    Stats element did; the other half was cross-fading to a stat card on every
    new batter. Seeding the containers without the rule would hand a producer
    two sources that rest and never flash — a worse version of what they had —
    so the migration ships both. This is the ONLY seeded rule: everything else
    in the quick-add library stays opt-in.

    One template, two containers, and the id carries the container precisely so
    that is expressible. `{sb}` and the side both resolve from the container's
    own scope, which is what makes the mirror one rule twice rather than two.
    """
    await Settings.Load()
    rules = Settings.settings["production"]["automations"]
    assert sorted(rules) == [
        "roster-stats-1:batter-card", "roster-stats-2:batter-card",
    ]
    for cid in ("roster-stats-1", "roster-stats-2"):
        r = rules[f"{cid}:batter-card"]
        assert r["container"] == cid
        assert r["trigger"] == "score.{sb}.batter"
        # The member has to be ON that container's roster or the rule is inert.
        assert r["member"] == "statscard"
        assert r["member"] in _defs()[cid]["members"]
        assert r["guard"] == "content"
        assert r["enabled"] is True
        assert r["dwell"] > 0


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

    The cautionary case was the seeded "Stats Bar", and it is instructive even
    though the container is gone. It was moved to 452x118 on the strength of a
    census line reading "stats 452x118" — but that is `stats.html`, which is now
    the dedicated per-side Stats SOURCE and was never that container's member.
    Its member was the fed bar at 325x120, so the "fix" left the container 2px
    too short for the only thing it could hold, which `fitsContainer` would have
    filtered out of its own member picker. One name over two runtimes meaning two
    different overlays is what made that possible, and is why `stats` now names
    exactly one of them.
    """
    await Settings.Load()
    defs = _defs()
    assert (defs["split-screen"]["width"], defs["split-screen"]["height"]) == (1280, 720)
    assert defs["split-screen"]["members"] == ["hitvisualizer"]
    assert (defs["roster-stats-1"]["width"], defs["roster-stats-1"]["height"]) == (452, 240)


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
    assert _defs()["split-screen"]["members"] == ["hitvisualizer"]


# --- The seed is a seed, not a default ---------------------------------------
#
# `_deep_merge` exists so a new default KNOB reaches an existing user without
# migration code, which means every default key is a value the app supplies and
# the file may override. Applied to a producer-built COLLECTION that is exactly
# backwards: a deletion is not an absent override to be filled in, it is the
# edit. These pin the exemption (`_USER_OWNED_MAPS`) that makes the two maps
# below authoritative once they exist on disk.


async def test_deleting_a_seeded_container_survives_a_restart(isolate_user_data):
    """The console writes the whole map back; the map it wrote is what loads.

    `useContainerActions` removes an entry and PUTs the remaining map, so a
    deleted container is represented by its ABSENCE from a key that exists.
    Merging the seed under that reads the absence as "never configured" and
    hands the container back on the next launch — with no way for the producer
    to make it stick, since the app rewrites the file they would hand-edit.
    """
    kept = {k: v for k, v in Settings.settings["production"]["container_defs"].items()
            if k != "split-screen"}
    _write_settings(isolate_user_data, {"production": {"container_defs": kept}})
    await Settings.Load()
    assert set(_defs()) == SEEDED - {"split-screen"}


async def test_deleting_a_seeded_automation_rule_survives_a_restart(isolate_user_data):
    """Deleting a rule and suspending one are both durable dispositions.

    `enabled: False` always survived — it is a per-key value the merge keeps.
    Deletion did not, which made the switch on the stage panel the only disposal
    that held, and the difference was an artifact of the merge rather than a
    decision anyone made.
    """
    _write_settings(isolate_user_data, {
        "production": {"automations": {}},
    })
    await Settings.Load()
    assert Settings.settings["production"]["automations"] == {}


async def test_suspending_a_seeded_rule_still_persists(isolate_user_data):
    """The exemption must not cost the disposal that already worked."""
    rules = {
        rid: {**r, "enabled": False}
        for rid, r in Settings.settings["production"]["automations"].items()
    }
    _write_settings(isolate_user_data, {"production": {"automations": rules}})
    await Settings.Load()
    stored = Settings.settings["production"]["automations"]
    assert sorted(stored) == [
        "roster-stats-1:batter-card", "roster-stats-2:batter-card",
    ]
    assert all(r["enabled"] is False for r in stored.values())


async def test_an_edited_container_is_not_backfilled_from_the_seed(isolate_user_data):
    """Replace, not merge, per ENTRY as well as per map.

    A producer who renames a container and trims its roster has expressed both;
    a per-entry merge would keep the rename (a key they wrote) while restoring
    the member they removed (a key they didn't), which is the same resurrection
    one level down and harder to spot because the container is still there.
    """
    _write_settings(isolate_user_data, {"production": {"container_defs": {
        "roster-stats-1": {
            "name": "Left Card", "width": 452, "height": 240,
            "members": ["statscard"],
        },
    }}})
    await Settings.Load()
    defs = _defs()
    assert set(defs) == {"roster-stats-1"}
    d = defs["roster-stats-1"]
    assert d["name"] == "Left Card"
    assert d["members"] == ["statscard"]
    # `resting` and `scope` were on the seeded def and are gone from theirs.
    assert "resting" not in d
    assert "scope" not in d


async def test_a_file_without_the_key_still_gets_the_seed(isolate_user_data):
    """Absent is the only state that means "never configured".

    This is what makes it a seed-ONCE rather than a seed-never: a settings file
    written before either map existed still gets the containers and the pair's
    rule on the upgrade that introduces them.
    """
    _write_settings(isolate_user_data, {
        "production": {"spotlight": {"enabled": True, "scene": "Replay",
                                     "holdMs": 1500}},
    })
    await Settings.Load()
    assert set(_defs()) == SEEDED
    assert sorted(Settings.settings["production"]["automations"]) == [
        "roster-stats-1:batter-card", "roster-stats-2:batter-card",
    ]
    # …without disturbing the neighbouring keys, which still merge normally.
    assert Settings.settings["production"]["spotlight"]["scene"] == "Replay"
    assert Settings.settings["production"]["overrides"] == {}


async def test_the_exemption_does_not_leak_to_the_rest_of_production(
    isolate_user_data,
):
    """Only the two collections are exempt; every other knob still merges.

    The merge is load-bearing for defaults that ARE defaults — a new field on
    `spotlight` or `confirm` has to reach a user who has the section already,
    and that is the behavior the exemption is carved out of, not replaced.
    """
    _write_settings(isolate_user_data, {
        "production": {
            "container_defs": {},
            "spotlight": {"enabled": True},
            "confirm": {"hotkey": "F12"},
        },
    })
    await Settings.Load()
    production = Settings.settings["production"]
    assert production["container_defs"] == {}
    # Their value where they set one…
    assert production["spotlight"]["enabled"] is True
    assert production["confirm"]["hotkey"] == "F12"
    # …the default everywhere they didn't.
    assert production["spotlight"]["holdMs"] == 1500
    assert production["confirm"]["enabled"] is False
    # Including a scalar added to `production` after this user's settings.json
    # was written — the case the exemption must not swallow.
    assert production["side_labels"] == "numeric"


async def test_side_labels_default_to_the_numbers(isolate_user_data):
    """The console's side vocabulary, and why the default is what it is.

    Left/Right describes ONE arrangement of one scene. A producer who stacks
    their sides, or simply puts side 2 on the left, gets a board desk that lies
    to them about the exact thing they opened it to check — so the shipped
    default is the numbers, which are true in every layout, and the positional
    pairs are opt-in.

    Vocabulary only: nothing here reaches state (`score.{N}.player.{T}`), the
    overlay URLs (`?team=`) or any layout. Client: src/routes/production/sides.js.
    """
    await Settings.Load()
    assert Settings.settings["production"]["side_labels"] == "numeric"

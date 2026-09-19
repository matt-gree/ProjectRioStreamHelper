"""Shared containers are producer-built definitions in Settings.

`settings.production.container_defs.{id}` = name · native size · member roster.
Membership lives on the CONTAINER and nowhere else. None ship: a fresh install
starts with no containers and no rules, the four that used to be seeded are
removed from existing installs once, and a producer's own map is authoritative
the moment it exists on disk.
"""
import orjson

from server.settings import Settings


def _write_settings(path, data):
    (path / "settings.json").write_bytes(orjson.dumps(data))


def _production():
    return Settings.settings["production"]


def _defs():
    return _production()["container_defs"]


# The four a fresh install used to be seeded with, and the pair's two rules.
SEEDED = {"callout-stage", "split-screen", "roster-stats-1", "roster-stats-2"}
SEEDED_RULES = {"roster-stats-1:batter-card", "roster-stats-2:batter-card"}

_PAIR_RULE = {
    "enabled": True, "template": "batter-card", "name": "Batter change → stat card",
    "member": "statscard", "trigger": "score.{sb}.batter", "guard": "content", "dwell": 7,
}


def _old_install(**extra_defs):
    """A settings file as a pre-release that seeded the four would have left it."""
    defs = {
        "callout-stage": {"name": "Callout Stage", "width": 1920, "height": 1080,
                          "members": ["postgamecallout", "postgamevs"]},
        "split-screen": {"name": "Split-Screen", "width": 1280, "height": 720,
                         "members": ["hitvisualizer"]},
        "roster-stats-1": {"name": "Roster + Stats — Side 1", "width": 452, "height": 240,
                           "members": ["roster", "statscard"], "resting": "roster",
                           "scope": {"scoreboard": 1, "team": 1}},
        "roster-stats-2": {"name": "Roster + Stats — Side 2", "width": 452, "height": 240,
                           "members": ["roster", "statscard"], "resting": "roster",
                           "scope": {"scoreboard": 1, "team": 2}},
        **extra_defs,
    }
    rules = {rid: {**_PAIR_RULE, "container": rid.split(":")[0]} for rid in SEEDED_RULES}
    return {"production": {"container_defs": defs, "automations": rules}}


async def test_a_fresh_install_ships_no_containers_and_no_rules(isolate_user_data):
    """A container is something a producer builds, not part of the app.

    The four seeded ones rowed in the catalog beside the elements and read as
    built-in; the catalog offers elements alone until the producer makes one.
    """
    await Settings.Load()
    assert _defs() == {}
    assert _production()["automations"] == {}


async def test_an_existing_install_loses_the_four_and_their_rules(isolate_user_data):
    """All four go, edited or not, and every rule aimed at one goes with them.

    A producer-added rule on a retired container goes too: with its container
    gone it can never fire, and it would revive the day the id is reused.
    """
    data = _old_install(**{"lower-bar": {"name": "Lower Bar", "width": 452,
                                         "height": 118, "members": ["statscard"]}})
    data["production"]["container_defs"]["callout-stage"]["name"] = "Renamed by hand"
    data["production"]["automations"]["split-screen:extra"] = {
        **_PAIR_RULE, "container": "split-screen", "member": "hitvisualizer"}
    data["production"]["automations"]["lower-bar:batter-card"] = {
        **_PAIR_RULE, "container": "lower-bar"}
    _write_settings(isolate_user_data, data)

    await Settings.Load()
    # The producer's own container and its rule are untouched.
    assert set(_defs()) == {"lower-bar"}
    assert set(_production()["automations"]) == {"lower-bar:batter-card"}


async def test_the_retirement_is_persisted(isolate_user_data):
    _write_settings(isolate_user_data, _old_install())
    await Settings.Load()
    on_disk = orjson.loads((isolate_user_data / "settings.json").read_bytes())
    assert on_disk["production"]["container_defs"] == {}
    assert on_disk["production"]["automations"] == {}


async def test_it_runs_once_so_a_rebuilt_callout_stage_survives(isolate_user_data):
    """Ids are slugged from the NAME, so a producer's own "Callout Stage" is
    `callout-stage` again. Swept on every boot, it would never survive a restart.
    """
    _write_settings(isolate_user_data, _old_install())
    await Settings.Load()

    mine = {"name": "Callout Stage", "width": 1920, "height": 1080,
            "members": ["postgamevs"]}
    await Settings.Set("production.container_defs.callout-stage", mine)
    await Settings.Load()
    assert _defs() == {"callout-stage": mine}


async def test_legacy_per_element_membership_is_dropped(isolate_user_data):
    """`production.containers` was the other end of the same relationship.

    Two homes for one fact is how these drift, so the old key is removed rather
    than translated.
    """
    _write_settings(isolate_user_data, {
        "production": {"containers": {"stats": "split-screen"}},
    })
    await Settings.Load()
    assert "containers" not in _production()


# --- The producer's map is authoritative -------------------------------------
#
# `_deep_merge` exists so a new default KNOB reaches an existing user without
# migration code, which means every default key is a value the app supplies and
# the file may override. Applied to a producer-built COLLECTION that is exactly
# backwards: a deletion is not an absent override to be filled in, it is the
# edit. These pin the exemption (`_USER_OWNED_MAPS`) that keeps the two maps
# authoritative once they exist on disk — a no-op while nothing is seeded, and
# what stops a future seed from resurrecting a deletion.


async def test_suspending_a_rule_persists(isolate_user_data):
    _write_settings(isolate_user_data, {"production": {
        "seeded_containers_retired": True,
        "container_defs": {"lower-bar": {"name": "Lower Bar", "width": 452,
                                         "height": 118, "members": ["statscard"]}},
        "automations": {"lower-bar:batter-card": {
            **_PAIR_RULE, "container": "lower-bar", "enabled": False}},
    }})
    await Settings.Load()
    assert _production()["automations"]["lower-bar:batter-card"]["enabled"] is False


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

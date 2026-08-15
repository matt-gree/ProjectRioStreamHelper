"""Container automations — the server-side engine (server/automations.py).

What these pin, in the order the plan locked them:

  * a rule fires in the SAME batch as its trigger (that co-location is the whole
    design — a separate pass would be the round-trip this replaces),
  * trigger / guard / dwell / return-to-resting,
  * precedence manual > rule > resting, mirrored to
    `production.feed.reason.{container}`,
  * the mirrored reason is also what restores a producer's suspension across a
    restart.
"""
import asyncio

import pytest

from server.automations import Automations, FEED_KEY, REASON_KEY, MANUAL, RULE, RESTING
from server.state import State
from server.utils.deep_dict import deep_get

CONTAINER = "stats-left"
FEED = f"{FEED_KEY}.{CONTAINER}"
REASON = f"{REASON_KEY}.{CONTAINER}"
TRIGGER = "score.1.batter"


@pytest.fixture
def container(set_setting):
    """A stats container scoped to board 1 / side 1, resting on the roster."""
    set_setting("production.container_defs", {
        CONTAINER: {
            "name": "Stats Left",
            "width": 452,
            "height": 240,
            "members": ["roster", "stats"],
            "resting": "roster",
            "scope": {"scoreboard": 1, "team": 1},
        },
    })
    return CONTAINER


@pytest.fixture
def rule(container, set_setting):
    set_setting("production.automations", {
        "batter-card": {
            "enabled": True,
            "name": "Batter change → stat card",
            "container": CONTAINER,
            "trigger": "score.{sb}.batter",
            "member": "stats",
            "guard": "content",
            "dwell": 7,
        },
    })


def _game(batter="Mario", idx=3, home_team=2, half="Top"):
    """The keys a HUD event carries that the stats guard reads."""
    return [
        ("score.1.home_team", home_team),
        ("score.1.half_inning", half),
        ("score.1.batter", batter),
        ("score.1.batter_roster_index", idx),
        ("score.1.pitcher", "Luigi"),
        ("score.1.pitcher_roster_index", 1),
    ]


async def _hud(entries):
    await State.SetBatch(entries)
    await State.Save()


def _feed():
    return deep_get(State.state, FEED)


def _reason():
    return deep_get(State.state, REASON)


# ── trigger + guard ─────────────────────────────────────────────────────────


async def test_first_observation_seeds_without_firing(rule):
    """Per SERVER run, not per page load — a mid-game start must not pop."""
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    assert _feed() == {"element": "roster", "scoreboard": 1, "team": 1}
    assert _reason() == RESTING


async def test_a_new_batter_fires_the_rule(rule):
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))

    assert _feed() == {
        "element": "stats", "scoreboard": 1, "team": 1,
        "charIndex": 5, "role": "batting",
    }
    assert _reason() == RULE


async def test_the_feed_lands_in_the_same_batch_as_its_trigger(rule, mock_socket):
    """One socket frame. If this splits, the latency this design exists to keep
    identical to the in-mount flip is gone."""
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    mock_socket.reset_mock()

    await _hud(_game(batter="Peach", idx=5))

    frames = [c for c in mock_socket.await_args_list if c.args[0].startswith("v1.state")]
    assert len(frames) == 1, frames
    event, payload = frames[0].args
    assert event == "v1.state.set_batch"
    # One frame, but the engine's half rides `augmented` — a producer's client
    # suppresses the echo of its own `items`, and the reason is not their write.
    assert TRIGGER in [item["key"] for item in payload["items"]]
    assert {FEED, REASON} <= {item["key"] for item in payload["augmented"]}


async def test_the_mirrored_side_shows_the_pitcher(container, set_setting):
    """One trigger, two containers: the side in the field flashes its pitcher.

    This is what makes the old Roster + Stats mirror expressible as two
    containers — the rule is identical, the container's scope is not.
    """
    set_setting("production.container_defs", {
        CONTAINER: {
            "name": "Stats Right", "width": 452, "height": 240,
            "members": ["roster", "stats"], "resting": "roster",
            # Side 2 is the HOME team here (home_team=2), and on a Top half the
            # away side bats — so side 2 is fielding.
            "scope": {"scoreboard": 1, "team": 2},
        },
    })
    set_setting("production.automations", {
        "r": {"container": CONTAINER, "trigger": "score.{sb}.batter",
              "member": "stats", "dwell": 7},
    })
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))

    assert _feed() == {
        "element": "stats", "scoreboard": 1, "team": 2,
        "charIndex": 1, "role": "pitching",
    }


async def test_the_themed_card_is_fed_a_scope_and_nothing_else(container, set_setting):
    """`statscard` resolves its own line, so the payload is only WHOSE side.

    The fed `stats` bar is addressed (board, side, roster index, role) because
    the producer can also pick a character for it. The themed card always draws
    whoever this side has on the field — the same resolution the mount runs — so
    there is nothing to address but the frame of reference.
    """
    set_setting("production.container_defs", {
        CONTAINER: {
            "name": "Roster + Stats", "width": 452, "height": 240,
            "members": ["roster", "statscard"], "resting": "roster",
            "scope": {"scoreboard": 1, "team": 1},
        },
    })
    set_setting("production.automations", {
        "r": {"container": CONTAINER, "trigger": "score.{sb}.batter",
              "member": "statscard", "dwell": 7},
    })
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))

    assert _feed() == {"element": "statscard", "scoreboard": 1, "team": 1}
    assert _reason() == RULE


async def test_the_themed_card_still_carries_a_guard(container, set_setting):
    """Resolving its own line does not mean firing unconditionally.

    Without a guard, a batter change with nobody on the field for this side
    would flash an empty card — and the guard-fail RETRY that keeps a batter
    from being dropped a frame early would never engage.
    """
    set_setting("production.container_defs", {
        CONTAINER: {
            "name": "Roster + Stats", "width": 452, "height": 240,
            "members": ["roster", "statscard"], "resting": "roster",
            # Side 2 fields on a Top half, so the guard reads the PITCHER.
            "scope": {"scoreboard": 1, "team": 2},
        },
    })
    set_setting("production.automations", {
        "r": {"container": CONTAINER, "trigger": "score.{sb}.batter",
              "member": "statscard", "dwell": 7},
    })
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5) + [("score.1.pitcher", "")])

    # Guard failed: still resting, and the baseline rolled back so the next tick
    # retries this batter rather than skipping them.
    assert _feed() == {"element": "roster", "scoreboard": 1, "team": 2}
    await _hud(_game(batter="Peach", idx=5))
    assert _feed() == {"element": "statscard", "scoreboard": 1, "team": 2}


async def test_guard_failure_retries_on_the_next_tick(rule):
    """A batter whose card cannot resolve yet is not skipped.

    The HUD can carry a new batter a tick before its roster index. The in-mount
    cycle handled that by not advancing its baseline; so does this.
    """
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    # New batter, no resolvable roster slot (index -1 and no character names).
    await _hud(_game(batter="Peach", idx=-1))
    assert _reason() == RESTING

    await _hud(_game(batter="Peach", idx=5))
    assert _reason() == RULE
    assert _feed()["charIndex"] == 5


async def test_an_empty_trigger_only_resets_the_baseline(rule):
    """Between innings there is no batter — that is not a fire, but the next
    real batter after it is, even if it is the same name."""
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter=""))
    assert _reason() == RESTING

    await _hud(_game(batter="Mario"))
    assert _reason() == RULE


async def test_an_unchanged_trigger_does_not_re_fire(rule):
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    task = Automations.pending(CONTAINER)
    await _hud(_game(batter="Peach", idx=5))
    # Same task: a re-fire would have cancelled it and restarted the dwell,
    # holding the card up forever while the same batter is at the plate.
    assert Automations.pending(CONTAINER) is task


async def test_a_disabled_rule_never_fires(container, set_setting):
    set_setting("production.automations", {
        "r": {"enabled": False, "container": CONTAINER,
              "trigger": "score.{sb}.batter", "member": "stats", "dwell": 7},
    })
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    assert _reason() == RESTING


async def test_a_rule_whose_member_left_the_roster_is_inert(container, set_setting):
    """Rosters are edited freely; a rule left behind must not feed a container
    something it cannot render."""
    set_setting("production.container_defs", {
        CONTAINER: {"name": "Stats Left", "width": 452, "height": 240,
                    "members": ["roster"], "resting": "roster"},
    })
    set_setting("production.automations", {
        "r": {"container": CONTAINER, "trigger": "score.{sb}.batter",
              "member": "stats", "dwell": 7},
    })
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    assert _reason() == RESTING
    assert Automations.rules() == []


# ── dwell + return ──────────────────────────────────────────────────────────


async def test_dwell_returns_to_the_resting_occupant(container, set_setting):
    set_setting("production.automations", {
        "r": {"container": CONTAINER, "trigger": "score.{sb}.batter",
              "member": "stats", "dwell": 0.01},
    })
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    assert _reason() == RULE

    await Automations.pending(CONTAINER)

    assert _feed() == {"element": "roster", "scoreboard": 1, "team": 1}
    assert _reason() == RESTING


async def test_a_container_with_no_resting_member_empties(set_setting):
    """Resting is allowed to be nothing: an empty container is transparent."""
    set_setting("production.container_defs", {
        CONTAINER: {"name": "Bar", "width": 325, "height": 120,
                    "members": ["stats"]},
    })
    set_setting("production.automations", {
        "r": {"container": CONTAINER, "trigger": "score.{sb}.batter",
              "member": "stats", "dwell": 0.01},
    })
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    assert _feed()["element"] == "stats"

    await Automations.pending(CONTAINER)

    assert _feed() is None
    assert _reason() == RESTING


# ── precedence: manual > rule > resting ─────────────────────────────────────


async def test_a_producer_push_suspends_the_rules(rule):
    await Automations.Start()
    await _hud(_game(batter="Mario"))

    pushed = {"element": "stats", "scoreboard": 1, "team": 1,
              "charIndex": 8, "role": "batting"}
    await State.SetBatch([(FEED, pushed)])
    await State.Save()
    assert _reason() == MANUAL
    assert Automations.is_manual(CONTAINER)

    await _hud(_game(batter="Peach", idx=5))
    assert _feed() == pushed
    assert _reason() == MANUAL


async def test_a_push_cancels_a_running_dwell(rule):
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    assert Automations.pending(CONTAINER)

    await State.SetBatch([(FEED, {"element": "stats", "scoreboard": 1})])
    await State.Save()
    # Left running, the dwell would have yanked the producer's own pick off air.
    assert Automations.pending(CONTAINER) is None


async def test_clearing_the_feed_hands_the_container_back(rule):
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await State.SetBatch([(FEED, {"element": "stats", "scoreboard": 1})])
    await State.Save()
    assert Automations.is_manual(CONTAINER)

    await State.UnsetBatch([FEED])
    await State.Save()
    assert not Automations.is_manual(CONTAINER)
    await Automations.pending(CONTAINER)
    assert _feed() == {"element": "roster", "scoreboard": 1, "team": 1}
    assert _reason() == RESTING

    await _hud(_game(batter="Peach", idx=5))
    assert _reason() == RULE


async def test_a_push_in_the_same_batch_as_a_trigger_wins(rule):
    """Manual is read first, so a batch carrying both cannot fire the rule the
    Push just overrode."""
    await Automations.Start()
    await _hud(_game(batter="Mario"))

    pushed = {"element": "stats", "scoreboard": 1, "charIndex": 8}
    await State.SetBatch(_game(batter="Peach", idx=5) + [(FEED, pushed)])
    await State.Save()

    assert _feed() == pushed
    assert _reason() == MANUAL


# ── boot ────────────────────────────────────────────────────────────────────


async def test_startup_puts_the_resting_occupant_up(container):
    await Automations.Start()
    assert _feed() == {"element": "roster", "scoreboard": 1, "team": 1}
    assert _reason() == RESTING


async def test_startup_settles_a_dwell_that_died_with_the_process(container):
    """state.json persists, so last run's stat card is still on air. Its dwell
    is not — so it settles back to resting."""
    State.state = {}
    await State.SetBatch([(FEED, {"element": "stats", "scoreboard": 1}),
                          (REASON, RULE)])
    await Automations.Start()
    assert _feed() == {"element": "roster", "scoreboard": 1, "team": 1}
    assert _reason() == RESTING


async def test_startup_restores_a_producers_suspension(rule):
    """The mirrored reason is what remembers a Push across a restart."""
    pushed = {"element": "stats", "scoreboard": 1, "charIndex": 8}
    await State.SetBatch([(FEED, pushed), (REASON, MANUAL)])
    await Automations.Start()

    assert Automations.is_manual(CONTAINER)
    assert _feed() == pushed
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    assert _feed() == pushed


# ── the idle path ───────────────────────────────────────────────────────────


async def test_nothing_configured_costs_nothing(set_setting):
    """With no rules and no resting occupant the hook is a no-op — this runs on
    every HUD write."""
    set_setting("production.container_defs", {})
    set_setting("production.automations", {})
    await Automations.Start()
    await _hud(_game(batter="Mario"))
    await _hud(_game(batter="Peach", idx=5))
    assert await Automations.on_write(_game(batter="Yoshi")) == []


async def test_a_pushed_container_with_no_automation_is_left_alone(set_setting):
    """The callout stage has no rules and no resting member: pushing to it must
    not start mirroring a reason at it."""
    set_setting("production.container_defs", {
        "callout-stage": {"name": "Callout Stage", "width": 1920, "height": 1080,
                          "members": ["postgamecallout", "postgamevs"]},
    })
    set_setting("production.automations", {})
    await Automations.Start()
    await State.SetBatch([(f"{FEED_KEY}.callout-stage",
                           {"element": "postgamevs", "scoreboard": 1})])
    await State.Save()
    assert deep_get(State.state, f"{REASON_KEY}.callout-stage") is None


async def test_hooks_do_not_reenter_on_the_engines_own_writes(rule):
    """apply_resting goes through SetBatch like anything else; without the
    write guard the engine would read its own feed write as a Push."""
    await Automations.Start()
    await asyncio.sleep(0)
    assert not Automations.is_manual(CONTAINER)
    assert _reason() == RESTING

"""Container rules as the console builds them — When / While, in the producer's order.

test_automations.py pins the engine's plumbing (same-batch firing, the guard
retry, manual > rule, boot). These pin the SENTENCE a rule is:

    when <event> by <side> [only if …] → show <member> of <subject>
        for <seconds | until a moment | until cleared> · <every time | once per …>
    while <state> → show <member> of <subject>
    otherwise → the resting member

and the precedence between them: manual > when > while > otherwise.
"""
import pytest

from server.automations import (
    Automations, CONDITIONS, EVENTS, FEED_KEY, ONCE, OPS, REASON_KEY, RESTING, RULE,
    STATE, STATES, SUBJECTS, UNTIL, BY, load_vocab, normalize_rule,
)
from server.settings_migrations import _upgrade_automation_rules
from server.state import State
from server.utils.deep_dict import deep_get

C = "card"
FEED = f"{FEED_KEY}.{C}"
REASON = f"{REASON_KEY}.{C}"


@pytest.fixture
def card(set_setting):
    """Side 1's card on board 1: a roster at rest, a stat card and a summary."""
    set_setting("production.container_defs", {
        C: {"name": "Card", "width": 1920, "height": 1080,
            "members": ["roster", "statscard", "postgamevs"],
            "resting": "roster", "scope": {"scoreboard": 1, "team": 1}},
    })
    return C


def rules(set_setting, *entries):
    set_setting("production.automations", {
        f"r{i}": {"container": C, "order": i, **e} for i, e in enumerate(entries)
    })


def when(event="batter_up", member="statscard", **kw):
    return {"kind": "when", "event": event, "member": member, "until": 7, **kw}


def while_(state, member="postgamevs", **kw):
    return {"kind": "while", "state": state, "member": member, **kw}


def frame(batter="Mario", pitcher="Luigi", half="Top", inning=1, game_id=100, **extra):
    """A HUD frame: home is side 2, so on a Top half side 1 bats."""
    keys = {
        "game_id": game_id, "home_team": 2, "inning": inning, "half_inning": half,
        "batter": batter, "batter_roster_index": 0, "pitcher": pitcher,
        "pitcher_roster_index": 1, "game_over": False, "game_completed": False,
        "score_left": 0, "score_right": 0, "outs": 0, **extra,
    }
    return [(f"score.1.{k}", v) for k, v in keys.items()]


async def hud(**kw):
    await State.SetBatch(frame(**kw))
    await State.Save()


def feed():
    return deep_get(State.state, FEED)


def reason():
    return deep_get(State.state, REASON)


# ── the vocabulary is one list ──────────────────────────────────────────────


def test_every_word_the_console_offers_is_one_the_engine_implements():
    """The console builds its menus from automation-vocab.json; this module
    implements each id. A word only one side knows is a rule that either cannot
    be written or silently never fires."""
    v = load_vocab()
    ids = lambda key: {e["id"] for e in v[key]}
    assert ids("events") == set(EVENTS)
    assert ids("states") == set(STATES)
    assert ids("until") == set(UNTIL)
    assert ids("once") == set(ONCE)
    assert ids("conditions") == set(CONDITIONS)
    assert ids("subjects") == set(SUBJECTS)
    assert ids("by") == set(BY)
    assert set(v["ops"]) == set(OPS)


def test_a_rule_built_from_unknown_words_is_inert():
    defs = {C: {"members": ["statscard"]}}
    assert normalize_rule("x", {**when(), "container": C}, defs) is not None
    for bad in ({"event": "home_run"}, {"by": "home"}, {"once": "hourly"},
                {"until": "forever"}, {"subject": "the crowd"},
                {"conditions": [{"field": "rbi", "op": ">=", "value": 2}]},
                {"conditions": [{"field": "inning", "op": ">", "value": 2}]}):
        assert normalize_rule("x", {**when(), "container": C, **bad}, defs) is None, bad


# ── when ─────────────────────────────────────────────────────────────────────


async def test_the_first_matching_moment_wins(card, set_setting):
    rules(set_setting,
          when(member="postgamevs"),
          when(member="statscard"))
    await Automations.Start()
    await hud(batter="Mario")
    await hud(batter="Peach")
    assert feed()["element"] == "postgamevs"


async def test_by_filters_on_the_side_the_moment_belongs_to(card, set_setting):
    # Side 1 bats on a Top half, so a new batter in the Bottom is side 2's.
    rules(set_setting, when(by="scope"))
    await Automations.Start()
    await hud(batter="Mario", half="Bottom")
    await hud(batter="Peach", half="Bottom")
    assert reason() == RESTING
    await hud(batter="Yoshi", half="Top")
    assert reason() == RULE


async def test_the_subject_picks_whose_content_is_shown(card, set_setting):
    """The container is side 1's; `fielding` hands the card side 2's pitcher."""
    rules(set_setting, when(subject="fielding"))
    await Automations.Start()
    await hud(batter="Mario")
    await hud(batter="Peach")
    assert feed() == {"element": "statscard", "scoreboard": 1, "team": 2}


async def test_the_event_subject_follows_the_moment(card, set_setting):
    rules(set_setting, when(event="pitcher_change", subject="event"))
    await Automations.Start()
    await hud(pitcher="Luigi")
    await hud(pitcher="Bowser")
    # A pitcher change on a Top half is the FIELDING side's: side 2.
    assert feed()["team"] == 2


async def test_once_per_half_inning(card, set_setting):
    rules(set_setting, when(once="half", until="manual"))
    await Automations.Start()
    await hud(batter="Mario")
    await hud(batter="Peach")
    assert reason() == RULE
    await State.UnsetBatch([FEED])
    await Automations.pending(C)
    assert reason() == RESTING

    await hud(batter="Yoshi")
    assert reason() == RESTING, "a second batter in the same half must not re-fire"
    await hud(batter="Wario", half="Bottom")
    assert reason() == RULE


async def test_only_if_conditions_gate_the_moment(card, set_setting):
    rules(set_setting, when(conditions=[{"field": "inning", "op": ">=", "value": 7}]))
    await Automations.Start()
    await hud(batter="Mario", inning=6)
    await hud(batter="Peach", inning=6)
    assert reason() == RESTING
    await hud(batter="Yoshi", inning=7)
    assert reason() == RULE


async def test_until_the_next_batter_needs_no_timer(card, set_setting):
    rules(set_setting, when(event="pitcher_change", until="next_batter"))
    await Automations.Start()
    await hud(pitcher="Luigi", batter="Mario")
    await hud(pitcher="Bowser", batter="Mario")
    assert reason() == RULE
    assert Automations.pending(C) is None

    await hud(pitcher="Bowser", batter="Mario", outs=1)
    assert reason() == RULE, "an unrelated frame does not end it"
    # Handed back in the SAME batch as the batter that ended it.
    await hud(pitcher="Bowser", batter="Peach")
    assert reason() == RESTING
    assert feed()["element"] == "roster"


async def test_until_cleared_stays_until_the_producer_clears(card, set_setting):
    rules(set_setting, when(until="manual"))
    await Automations.Start()
    await hud(batter="Mario")
    await hud(batter="Peach")
    assert reason() == RULE and Automations.pending(C) is None
    await hud(batter="Peach", outs=2)
    assert reason() == RULE


async def test_a_half_inning_ending_is_a_moment(card, set_setting):
    rules(set_setting, when(event="half_end", member="roster", subject="batting"))
    await Automations.Start()
    await hud(half="Top")
    await hud(half="Top", outs=2)
    assert reason() == RESTING
    await hud(half="Bottom", batter="Peach")
    assert reason() == RULE
    assert feed() == {"element": "roster", "scoreboard": 1, "team": 2}


async def test_a_new_game_is_not_a_half_inning_ending(card, set_setting):
    rules(set_setting, when(event="half_end", member="postgamevs"))
    await Automations.Start()
    await hud(half="Bottom", inning=9, game_id=100)
    await hud(half="Top", inning=1, game_id=101)
    assert reason() == RESTING


# ── while ────────────────────────────────────────────────────────────────────


async def test_a_state_holds_the_container_while_it_is_true(card, set_setting):
    rules(set_setting, while_("final"))
    await Automations.Start()
    await hud()
    assert feed()["element"] == "roster"

    await hud(game_over=True)
    assert feed()["element"] == "postgamevs"
    assert reason() == STATE


async def test_the_top_state_that_holds_wins(card, set_setting):
    rules(set_setting, while_("final"), while_("side_batting", member="statscard"))
    await Automations.Start()
    await hud(half="Top")
    assert feed()["element"] == "statscard"
    await hud(half="Top", game_over=True)
    assert feed()["element"] == "postgamevs"


async def test_a_moment_hands_back_to_the_state_not_to_rest(card, set_setting):
    """A WHEN rule returns to whatever the states say NOW."""
    rules(set_setting, when(until=0.01), while_("side_batting", member="postgamevs"))
    await Automations.Start()
    await hud(batter="Mario")
    assert reason() == STATE
    await hud(batter="Peach")
    assert reason() == RULE
    await Automations.pending(C)
    assert reason() == STATE
    assert feed()["element"] == "postgamevs"


async def test_no_state_holding_falls_through_to_otherwise(card, set_setting):
    rules(set_setting, while_("final"))
    await Automations.Start()
    await hud(game_over=True)
    assert reason() == STATE
    await hud(game_id=101)
    assert reason() == RESTING
    assert feed()["element"] == "roster"


async def test_a_push_beats_a_state(card, set_setting):
    rules(set_setting, while_("final"))
    await Automations.Start()
    pushed = {"element": "statscard", "scoreboard": 1, "team": 1}
    await State.SetBatch([(FEED, pushed)])
    await hud(game_over=True)
    assert feed() == pushed


# ── the migration off canned templates ──────────────────────────────────────


def test_a_canned_batter_rule_becomes_a_when_rule():
    production = {"automations": {
        "card:batter-card": {
            "enabled": True, "template": "batter-card", "name": "Batter change → stat card",
            "container": "card", "member": "statscard", "trigger": "score.{sb}.batter",
            "guard": "content", "dwell": 7,
        },
    }}
    assert _upgrade_automation_rules(production) is True
    rule = production["automations"]["card:batter-card"]
    assert rule == {
        "kind": "when", "event": "batter_up", "by": "any", "subject": "scope",
        "member": "statscard", "container": "card", "until": 7, "once": "always",
        "conditions": [], "enabled": True, "order": 0,
    }
    assert _upgrade_automation_rules(production) is False

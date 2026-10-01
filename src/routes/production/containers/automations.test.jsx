import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { useContainerActions } from './containers';
import {
    VOCAB, defaultRule, dropRules, ruleProblem, subjectKind, subjectOptions, untilLabel,
    useAutomationActions, useAutomations, useContainerAutomations,
} from './automations';

/*
 * Container rules — the console half.
 *
 * The engine is server-side (server/automations.py, pinned by
 * tests/unit/test_automation_rules.py, which also pins the vocabulary file
 * both halves read). What these pin is the part a producer touches: a new rule
 * is a sentence that already makes sense, the "of" a rule offers follows what
 * its member is, order lives within a kind, and a roster edit takes its rules
 * with it.
 */

const CONTAINER = 'stats-left';

function defs(extra = {}) {
    return {
        [CONTAINER]: {
            name: 'Stats Left', width: 452, height: 240,
            members: ['statscard'], resting: 'statscard',
            scope: { scoreboard: 2, team: 2 },
            ...extra,
        },
    };
}

beforeEach(() => {
    useSettingsStore.setState({ production: { container_defs: defs(), automations: {} } });
    useStateStore.setState({ production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(cleanup);

// One render, hooks handed back — the same seam containers.test.jsx uses.
function harness(hook) {
    const out = {};
    function Probe() {
        Object.assign(out, hook());
        return null;
    }
    render(<Probe />);
    return out;
}

const stored = () => useSettingsStore.getState().production.automations;

describe('a new rule is a sentence that already makes sense', () => {
    it('starts a When rule on the first event, for every time, showing a scoped member', () => {
        const r = defaultRule('when', { members: ['postgamevs', 'statscard'] });
        expect(r).toMatchObject({
            kind: 'when', event: VOCAB.events[0].id, by: 'any', member: 'statscard',
            subject: 'scope', once: 'always', conditions: [],
        });
        expect(typeof r.until).toBe('number');
    });

    it('starts a While rule on the first state', () => {
        expect(defaultRule('while', { members: ['postgamevs'] }))
            .toEqual({ kind: 'while', state: VOCAB.states[0].id, member: 'postgamevs', subject: 'scope' });
    });
});

describe('the "of" follows what the member is', () => {
    it('reads a Stat Card as a player and a Roster as a side', () => {
        expect(subjectKind('statscard')).toBe('player');
        expect(subjectKind('roster')).toBe('side');
        // A member with content of its own has no "of" at all.
        expect(subjectKind('postgamevs')).toBeNull();
        expect(subjectOptions({ kind: 'while', member: 'postgamevs' })).toEqual([]);
    });

    it('only offers "the player in the event" for a moment that has one', () => {
        const sided = subjectOptions({ kind: 'when', event: 'batter_up', member: 'statscard' });
        const unsided = subjectOptions({ kind: 'when', event: 'game_end', member: 'statscard' });
        expect(sided.map(o => o.value)).toContain('event');
        expect(unsided.map(o => o.value)).not.toContain('event');
        expect(sided.find(o => o.value === 'fielding').label).toBe('the pitcher');
        expect(subjectOptions({ kind: 'when', event: 'batter_up', member: 'roster' })
            .find(o => o.value === 'fielding').label).toBe('the fielding side');
    });

    it('reads a duration as seconds or as the moment it ends on', () => {
        expect(untilLabel(8)).toBe('8 s');
        expect(untilLabel('next_batter')).toBe('the next batter');
    });
});

describe('rule mutations', () => {
    it('adds rules in order within their kind', () => {
        const { add } = harness(useAutomationActions);
        const a = add('when', CONTAINER);
        const b = add('when', CONTAINER);
        const c = add('while', CONTAINER);
        expect(stored()[a]).toMatchObject({ container: CONTAINER, kind: 'when', order: 0, enabled: true });
        expect(stored()[b].order).toBe(1);
        expect(stored()[c].order).toBe(0);
    });

    it('refuses a rule for a container with nothing on it', () => {
        useSettingsStore.setState({ production: { container_defs: defs({ members: [] }), automations: {} } });
        const { add } = harness(useAutomationActions);
        expect(add('when', CONTAINER)).toBeNull();
        expect(stored()).toEqual({});
    });

    it('moves a rule within its kind and renumbers the group', () => {
        const { add, move } = harness(useAutomationActions);
        const a = add('when', CONTAINER);
        const b = add('when', CONTAINER);
        const w = add('while', CONTAINER);
        move(b, -1);
        expect(stored()[b].order).toBe(0);
        expect(stored()[a].order).toBe(1);
        // Past the top is a no-op, and a While rule never crosses into the Whens.
        move(w, -1);
        expect(stored()[w].order).toBe(0);
    });

    it('updates one knob and removes a rule', () => {
        const { add, update, remove } = harness(useAutomationActions);
        const id = add('when', CONTAINER);
        update(id, { until: 'next_batter' });
        expect(stored()[id].until).toBe('next_batter');
        remove(id);
        expect(stored()).toEqual({});
    });
});

describe('reading rules back', () => {
    it('degrades a malformed entry to absent, and lists When before While', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: {
                    junk: 'not an object',
                    nokind: { container: CONTAINER, member: 'statscard' },
                    w: { kind: 'while', state: 'final', container: CONTAINER, member: 'statscard', order: 0 },
                    m: { kind: 'when', event: 'batter_up', container: CONTAINER, member: 'statscard', order: 5 },
                },
            },
        });
        const { rules } = harness(() => ({ rules: useAutomations() }));
        expect(rules.map(r => r.id)).toEqual(['m', 'w']);
    });

    it('filters to one container', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: {
                    a: { kind: 'when', event: 'batter_up', container: CONTAINER, member: 'statscard' },
                    b: { kind: 'when', event: 'batter_up', container: 'other', member: 'statscard' },
                },
            },
        });
        const { rules } = harness(() => ({ rules: useContainerAutomations(CONTAINER) }));
        expect(rules.map(r => r.id)).toEqual(['a']);
    });

    it('names why a rule cannot fire', () => {
        const def = { members: ['statscard'] };
        expect(ruleProblem({ kind: 'when', event: 'batter_up', member: 'statscard' }, def)).toBeNull();
        expect(ruleProblem({ kind: 'when', event: 'batter_up', member: 'roster' }, def)).toMatch(/no longer on/);
        expect(ruleProblem({ kind: 'while', state: 'nope', member: 'statscard' }, def)).toMatch(/state/);
    });
});

describe('a roster edit takes its rules with it', () => {
    it('drops every rule for a deleted container', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: {
                    mine: { container: CONTAINER, member: 'statscard' },
                    theirs: { container: 'other', member: 'statscard' },
                },
            },
        });
        const { remove } = harness(useContainerActions);
        remove(CONTAINER);

        expect(Object.keys(useSettingsStore.getState().production.automations)).toEqual(['theirs']);
    });

    it('drops the rule for a member taken off the roster, and its resting', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: { mine: { container: CONTAINER, member: 'statscard' } },
            },
        });
        const { setMember } = harness(useContainerActions);
        setMember(CONTAINER, 'statscard', false);

        const def = useSettingsStore.getState().production.container_defs[CONTAINER];
        expect(def.members).toEqual([]);
        // Resting on a member that just left would leave the container with a
        // steady state it cannot render.
        expect(def.resting).toBeUndefined();
        expect(useSettingsStore.getState().production.automations).toEqual({});
    });

    /*
     * A member leaves a roster three ways — removed, MOVED to another container,
     * or claimed by a new one — and the move is the one that got missed: the
     * source container kept a rule for a member it no longer holds, and a
     * `resting` naming it. Both inert to the engine, both a lie in settings, and
     * both alive again the day the member comes back.
     */
    it('drops the source container’s rule and resting when a member is MOVED', () => {
        useSettingsStore.setState({
            production: {
                container_defs: {
                    ...defs({ members: ['scoreboard'], resting: 'scoreboard' }),
                    'stats-right': { name: 'R', width: 800, height: 460, members: [] },
                },
                automations: { mine: { container: CONTAINER, member: 'scoreboard' } },
            },
        });
        const { setMember } = harness(useContainerActions);
        setMember('stats-right', 'scoreboard', true);

        const after = useSettingsStore.getState().production;
        expect(after.container_defs['stats-right'].members).toEqual(['scoreboard']);
        expect(after.container_defs[CONTAINER].members).toEqual([]);
        expect(after.container_defs[CONTAINER].resting).toBeUndefined();
        expect(after.automations).toEqual({});
    });

    it('drops them when a NEW container claims the member', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs({ members: ['scoreboard'], resting: 'scoreboard' }),
                automations: { mine: { container: CONTAINER, member: 'scoreboard' } },
            },
        });
        const { create } = harness(useContainerActions);
        create('Stats Right', ['scoreboard']);

        const after = useSettingsStore.getState().production;
        expect(after.container_defs[CONTAINER].members).toEqual([]);
        expect(after.container_defs[CONTAINER].resting).toBeUndefined();
        expect(after.automations).toEqual({});
    });

    it('leaves rules alone when a different member is removed', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs({ members: ['stats', 'postgamevs'] }),
                automations: { mine: { container: CONTAINER, member: 'stats' } },
            },
        });
        const { setMember } = harness(useContainerActions);
        setMember(CONTAINER, 'postgamevs', false);
        expect(Object.keys(useSettingsStore.getState().production.automations)).toEqual(['mine']);
    });

    it('dropRules with no match writes nothing', () => {
        const before = useSettingsStore.getState().production.automations;
        dropRules({ container: 'nothing-here' });
        expect(useSettingsStore.getState().production.automations).toBe(before);
    });
});

describe('the container definition carries the automation fields', () => {
    it('sets resting and scope, and refuses a non-member as resting', () => {
        const { setResting, setScope } = harness(useContainerActions);

        setResting(CONTAINER, 'postgamevs');
        expect(useSettingsStore.getState().production.container_defs[CONTAINER].resting)
            .toBe('statscard');   // unchanged: not on the roster

        setResting(CONTAINER, null);
        expect(useSettingsStore.getState().production.container_defs[CONTAINER].resting)
            .toBeUndefined();

        setScope(CONTAINER, '3', '2');
        expect(useSettingsStore.getState().production.container_defs[CONTAINER].scope)
            .toEqual({ scoreboard: 3, team: 2 });
    });
});

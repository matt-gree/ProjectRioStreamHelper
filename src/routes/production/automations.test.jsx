import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { useContainerActions } from './containers';
import {
    AUTOMATION_LIBRARY, dropRules, libraryEntry, ruleIdFor, templatesFor,
    useAutomationActions, useAutomations, useContainerAutomations,
} from './automations';

/*
 * Container automations — the console half.
 *
 * The engine is server-side (server/automations.py, pinned by
 * tests/unit/test_automations.py). What these pin is the part a producer touches:
 * the quick-add library is gated on the roster, a rule's id is scoped to its
 * container so a mirrored pair can run the same canned rule, and a roster edit
 * takes its rules with it.
 */

const CONTAINER = 'stats-left';

function defs(extra = {}) {
    return {
        [CONTAINER]: {
            name: 'Stats Left', width: 452, height: 240,
            members: ['stats'], resting: 'stats',
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

describe('the quick-add library', () => {
    it('ships the Roster + Stats case study as its first entry', () => {
        const t = libraryEntry('batter-card');
        expect(t).toBeTruthy();
        // Either card, in preference order: the themed 2x2 Stat Card when the
        // container holds one, else the fed Stats bar. Which card a container
        // holds is a look the producer chose when they built the roster, not a
        // second rule to pick.
        expect(t.members).toEqual(['statscard', 'stats']);
        // `{sb}` resolves from the CONTAINER's scope server-side, so one canned
        // rule reads the same on every board instead of naming one.
        expect(t.trigger).toBe('score.{sb}.batter');
        expect(t.dwell).toBeGreaterThan(0);
    });

    it('names the four knobs worth reading on every entry', () => {
        for (const t of AUTOMATION_LIBRARY) {
            expect(t.triggerLabel, t.id).toBeTruthy();
            expect(t.guardLabel, t.id).toBeTruthy();
            expect(t.members?.length, t.id).toBeTruthy();
            expect(t.dwell, t.id).toBeGreaterThan(0);
        }
    });

    /*
     * A rule that feeds a non-member is inert (the engine drops it), so offering
     * one would be offering something that quietly does nothing.
     */
    it('only offers a template whose member is on the roster', () => {
        expect(templatesFor({ members: ['stats'] }).map(t => t.id)).toEqual(['batter-card']);
        expect(templatesFor({ members: ['roster', 'statscard'] }).map(t => t.id))
            .toEqual(['batter-card']);
        expect(templatesFor({ members: ['postgamevs'] })).toEqual([]);
        expect(templatesFor({ members: ['roster'] })).toEqual([]);
        expect(templatesFor({})).toEqual([]);
    });
});

describe('rule mutations', () => {
    it('writes a rule carrying its template, container and knobs', () => {
        const { add } = harness(useAutomationActions);
        const id = add('batter-card', CONTAINER);

        expect(id).toBe(ruleIdFor('batter-card', CONTAINER));
        const rule = useSettingsStore.getState().production.automations[id];
        expect(rule).toMatchObject({
            enabled: true, template: 'batter-card', container: CONTAINER,
            member: 'stats', trigger: 'score.{sb}.batter', dwell: 7,
        });
    });

    /*
     * A mirrored pair is two containers running ONE canned rule, so the id has to
     * carry the container. Adding the same template twice to one container must
     * not double it: the feed key holds one occupant, so two identical rules
     * would fire twice into the same slot.
     */
    it('scopes a rule id to its container and never doubles one', () => {
        useSettingsStore.setState({
            production: {
                container_defs: {
                    ...defs(),
                    'stats-right': { name: 'R', width: 452, height: 240, members: ['stats'] },
                },
                automations: {},
            },
        });
        const { add } = harness(useAutomationActions);
        add('batter-card', CONTAINER);
        add('batter-card', 'stats-right');
        add('batter-card', CONTAINER);

        expect(Object.keys(useSettingsStore.getState().production.automations).sort())
            .toEqual(['stats-left:batter-card', 'stats-right:batter-card']);
    });

    it('updates one knob and removes a rule', () => {
        const { add, update, remove } = harness(useAutomationActions);
        const id = add('batter-card', CONTAINER);

        update(id, { dwell: 3 });
        expect(useSettingsStore.getState().production.automations[id].dwell).toBe(3);
        update(id, { enabled: false });
        expect(useSettingsStore.getState().production.automations[id]).toMatchObject({
            enabled: false, dwell: 3,
        });

        remove(id);
        expect(useSettingsStore.getState().production.automations).toEqual({});
    });

    it('ignores an unknown template or a missing container', () => {
        const { add } = harness(useAutomationActions);
        expect(add('nope', CONTAINER)).toBeNull();
        expect(add('batter-card', null)).toBeNull();
        expect(useSettingsStore.getState().production.automations).toEqual({});
    });

    /*
     * The template offers a preference list; the RULE stores one member,
     * resolved against this container's roster at add time. Resolving once and
     * storing it is what keeps the engine reading a rule rather than a
     * preference — and stops a later roster edit silently re-pointing a live
     * rule at a different card mid-broadcast.
     */
    it('resolves the member off the roster and stores it, preferring the themed card', () => {
        useSettingsStore.setState({
            production: {
                container_defs: {
                    bar: { name: 'Bar', width: 452, height: 240, members: ['stats'] },
                    pair: { name: 'Pair', width: 452, height: 240, members: ['roster', 'statscard'] },
                    both: {
                        name: 'Both', width: 452, height: 240,
                        members: ['stats', 'statscard'],
                    },
                },
                automations: {},
            },
        });
        const { add } = harness(useAutomationActions);
        const rules = () => useSettingsStore.getState().production.automations;
        add('batter-card', 'bar');
        expect(rules()['bar:batter-card'].member).toBe('stats');
        add('batter-card', 'pair');
        expect(rules()['pair:batter-card'].member).toBe('statscard');
        // Preference order decides when a roster holds both.
        add('batter-card', 'both');
        expect(rules()['both:batter-card'].member).toBe('statscard');
    });

    it('refuses a template no member on the roster can satisfy', () => {
        useSettingsStore.setState({
            production: {
                container_defs: { bare: { name: 'Bare', width: 452, height: 240, members: ['roster'] } },
                automations: {},
            },
        });
        const { add } = harness(useAutomationActions);
        expect(add('batter-card', 'bare')).toBeNull();
        expect(useSettingsStore.getState().production.automations).toEqual({});
    });
});

describe('reading rules back', () => {
    it('degrades a malformed entry to absent instead of throwing', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: {
                    ok: { container: CONTAINER, member: 'stats', template: 'batter-card', dwell: 5 },
                    nocontainer: { member: 'stats' },
                    nomember: { container: CONTAINER },
                    junk: 'not an object',
                },
            },
        });
        const rules = harness(() => ({ rules: useAutomations() })).rules;
        expect(rules.map(r => r.id)).toEqual(['ok']);
        // The template resolves off the stored id, so the row can read the
        // canned rule's own words rather than a raw state key.
        expect(rules[0].template.id).toBe('batter-card');
        expect(rules[0].enabled).toBe(true);
    });

    it('filters to one container', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: {
                    a: { container: CONTAINER, member: 'stats' },
                    b: { container: 'elsewhere', member: 'stats' },
                },
            },
        });
        const out = harness(() => ({ mine: useContainerAutomations(CONTAINER) }));
        expect(out.mine.map(r => r.id)).toEqual(['a']);
    });
});

describe('a roster edit takes its rules with it', () => {
    it('drops every rule for a deleted container', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: {
                    mine: { container: CONTAINER, member: 'stats' },
                    theirs: { container: 'other', member: 'stats' },
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
                automations: { mine: { container: CONTAINER, member: 'stats' } },
            },
        });
        const { setMember } = harness(useContainerActions);
        setMember(CONTAINER, 'stats', false);

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
                    ...defs(),
                    'stats-right': { name: 'R', width: 452, height: 240, members: [] },
                },
                automations: { mine: { container: CONTAINER, member: 'stats' } },
            },
        });
        const { setMember } = harness(useContainerActions);
        setMember('stats-right', 'stats', true);

        const after = useSettingsStore.getState().production;
        expect(after.container_defs['stats-right'].members).toEqual(['stats']);
        expect(after.container_defs[CONTAINER].members).toEqual([]);
        expect(after.container_defs[CONTAINER].resting).toBeUndefined();
        expect(after.automations).toEqual({});
    });

    it('drops them when a NEW container claims the member', () => {
        useSettingsStore.setState({
            production: {
                container_defs: defs(),
                automations: { mine: { container: CONTAINER, member: 'stats' } },
            },
        });
        const { create } = harness(useContainerActions);
        create('Stats Right', 452, 240, ['stats']);

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
            .toBe('stats');   // unchanged: not on the roster

        setResting(CONTAINER, null);
        expect(useSettingsStore.getState().production.container_defs[CONTAINER].resting)
            .toBeUndefined();

        setScope(CONTAINER, '3', '2');
        expect(useSettingsStore.getState().production.container_defs[CONTAINER].scope)
            .toEqual({ scoreboard: 3, team: 2 });
    });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { ELEMENTS } from './elements';
import { useMemberScope } from './containers';
import { useContainerPush } from './feeds';
import { SEEDED_CONTAINER_DEFS, withContainers } from '../../test/containers';

/*
 * What a Push actually sends — the frame of reference half.
 *
 * The mirrored pair (`roster-stats-1` / `roster-stats-2`) is the case that
 * breaks everything here, and it SHIPS: both containers hold the same two
 * container-scoped members, one scoped left and one scoped right. A member with
 * no content of its own draws whoever the CONTAINER's scope has on the field, so
 * every answer about it has to come from the container the row belongs to —
 * never from a lookup by element (which returns whichever roster comes first),
 * and never from what was pushed last (which carries the other side's scope).
 */

const statscard = ELEMENTS.find(e => e.id === 'statscard');
const stats = ELEMENTS.find(e => e.id === 'stats');

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: withContainers() });
    useStateStore.setState({ score: {}, production: {}, postgame: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

// One render, hooks handed back — the same seam containers/automations use.
function harness(hook) {
    const out = {};
    function Probe() {
        Object.assign(out, hook());
        return null;
    }
    render(<Probe />);
    return out;
}

const feedOn = (c) => useStateStore.getState()?.production?.feed?.container?.[c];
const memoryOf = (id) => useStateStore.getState()?.production?.feed?.last?.[id];
const remember = (id, value) => useStateStore.getState().setItems([
    { key: `production.feed.last.${id}`, value },
]);
const scopedAs = (container, scope) => useSettingsStore.setState({
    production: withContainers({
        container_defs: {
            ...SEEDED_CONTAINER_DEFS,
            [container]: { ...SEEDED_CONTAINER_DEFS[container], scope },
        },
    }),
});

describe('a container-scoped member is pushed in its CONTAINER’s frame', () => {
    it('takes board and side from the row’s container', () => {
        harness(() => useContainerPush(statscard, 1, 'roster-stats-2')).toggle();
        expect(feedOn('roster-stats-2')).toEqual({
            element: 'statscard', scoreboard: 1, team: 2,
        });
    });

    /*
     * The bug this pins. `useFeedControl` records every feed at
     * `production.feed.last.{element}`, and `resolveIntent` replays a remembered
     * payload verbatim for any feed with no FEED_INTENT entry — which is every
     * scoped member. So the FIRST Stat Card push anywhere used to fix its side
     * forever: push it left, then push it right, and the right-hand container
     * drew the left side.
     */
    it('ignores a payload remembered from the other half of the pair', () => {
        remember('statscard', { element: 'statscard', scoreboard: 1, team: 1 });
        harness(() => useContainerPush(statscard, 1, 'roster-stats-2')).toggle();
        expect(feedOn('roster-stats-2')).toMatchObject({ team: 2 });
    });

    // Same rule, one axis over: re-pointing a container's Board picker has to
    // take effect on the next push, not be overridden by the old board.
    it('follows a re-pointed scope rather than the last push', () => {
        remember('statscard', { element: 'statscard', scoreboard: 1, team: 2 });
        scopedAs('roster-stats-2', { scoreboard: 2, team: 2 });
        harness(() => useContainerPush(statscard, 2, 'roster-stats-2')).toggle();
        expect(feedOn('roster-stats-2')).toEqual({
            element: 'statscard', scoreboard: 2, team: 2,
        });
    });

    // A member with content of its own is the opposite case and must not
    // regress: its pick IS the content, so the memory is exactly what Push
    // replays. (Validated against live state first — see suggest.js.)
    it('but a content-bearing member still replays its own pick', () => {
        useStateStore.setState({
            score: { 1: { player: { 1: { character: { 0: { name: 'Daisy' } } } } } },
            production: {},
        });
        const pick = {
            element: 'stats', scoreboard: 1, team: 1, charIndex: 0,
            role: 'batting', name: 'Daisy',
        };
        remember('stats', pick);
        harness(() => useContainerPush(stats, 1, 'stats-feed')).toggle();
        expect(feedOn('stats-feed')).toMatchObject(pick);
    });

    // Clear still leaves the memory — for a scoped member it is inert either
    // way, but the key must not become a thing surfaces disagree about.
    it('clears the container without disturbing the recorded memory', () => {
        harness(() => useContainerPush(statscard, 1, 'roster-stats-1')).toggle();
        expect(memoryOf('statscard')).toMatchObject({ team: 1 });
        cleanup();
        harness(() => useContainerPush(statscard, 1, 'roster-stats-1')).toggle();
        expect(feedOn('roster-stats-1')).toBeUndefined();
        expect(memoryOf('statscard')).toMatchObject({ team: 1 });
    });
});

describe('useMemberScope', () => {
    // The whole reason the hook takes a container: `hostOf` answers with the
    // first roster naming the element, which on a mirrored pair is a coin flip.
    it('prefers the row’s container over the roster lookup', () => {
        expect(harness(() => useMemberScope(statscard, 'roster-stats-2')))
            .toMatchObject({ container: 'roster-stats-2', scoreboard: 1, team: 2 });
        cleanup();
        expect(harness(() => useMemberScope(statscard, 'roster-stats-1')))
            .toMatchObject({ container: 'roster-stats-1', team: 1 });
    });

    it('falls back to whichever roster claims the element', () => {
        expect(harness(() => useMemberScope(stats, null)))
            .toMatchObject({ container: 'stats-feed' });
    });

    // Board 1 / side 1, the same default `_scope_of` takes server-side and the
    // same one a missing ?scoreboard= means everywhere else.
    it('answers board 1 / side 1 when no container claims the element', () => {
        useSettingsStore.setState({ production: { container_defs: {} } });
        expect(harness(() => useMemberScope(statscard, null)))
            .toEqual({ container: null, scoreboard: 1, team: 1 });
    });
});

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { containerId } from './elements';
import { parseInstanceId } from './instances';
import {
    CONTAINER_MEMBERS, containerIdFor, containerOfSource, containerSizeClasses,
    containerUrl, fedTargets, fitsContainer, hostOf, useContainerActions,
} from './containers';

/*
 * Containers are producer-built definitions, and membership lives on the
 * CONTAINER. These pin the three things that makes true:
 *
 *   1. a container's id comes off the URL the same way in both runtimes,
 *   2. a roster is exclusive — an element is on exactly one,
 *   3. a member must fit, because there is no scaling.
 */

beforeEach(() => {
    useSettingsStore.setState({ production: { container_defs: {} } });
    useStateStore.setState({ production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});

describe('container id resolution', () => {
    it('reads ?container= first', () => {
        expect(containerId('http://x/layout/shared/container.html?container=lower-bar'))
            .toBe('lower-bar');
    });

    /*
     * A browser source added before containers became definitions points at a
     * named shell, and it must keep rowing and feeding — the id it always meant
     * is its filename stem.
     */
    it('falls back to the filename stem for a pre-2.0 named shell', () => {
        expect(containerId('http://x/layout/shared/stats-feed.html')).toBe('stats-feed');
        expect(containerId('http://x/layout/shared/callout-stage.html?preview=1'))
            .toBe('callout-stage');
    });

    it('survives other params riding along', () => {
        expect(containerId('http://x/layout/shared/container.html?preview=1&container=a&feed=stats'))
            .toBe('a');
    });

    /*
     * Living in one folder is what makes a source a container. Without that
     * gate, `containerId` happily reduces any overlay to its stem and would
     * call a scoreboard a container the moment somebody named one "scoreboard".
     */
    it('does not call an ordinary overlay a container', () => {
        expect(containerOfSource('http://x/layout/scoreboard1/scoreboard.html')).toBeNull();
        expect(containerOfSource('http://x/layout/shared/container.html?container=a')).toBe('a');
    });

    it('builds the URL the catalog and the picker both use', () => {
        expect(containerUrl('lower-bar')).toBe('/layout/shared/container.html?container=lower-bar');
        // Round-trips: what we build is what we can read back.
        expect(containerId(containerUrl('lower-bar'))).toBe('lower-bar');
    });
});

describe('a member has to fit', () => {
    it('accepts the container size or smaller, never larger', () => {
        const el = { width: 452, height: 118 };
        expect(fitsContainer(el, 452, 118)).toBe(true);   // exact
        expect(fitsContainer(el, 1920, 1080)).toBe(true); // smaller — centers
        expect(fitsContainer(el, 380, 118)).toBe(false);  // wider than the box
        expect(fitsContainer(el, 452, 100)).toBe(false);  // taller than the box
    });

    /*
     * The sizes offered when building a container are the CENSUS of what can go
     * in one, not a table of invented presets — so a new member with a new
     * native size makes its size offerable without anyone editing a list.
     */
    it('derives its size classes from the members themselves', () => {
        const classes = containerSizeClasses();
        const sizes = new Set(CONTAINER_MEMBERS.map(m => `${m.width}x${m.height}`));
        expect(new Set(classes.map(c => c.id))).toEqual(sizes);
        // Largest first, and each class carries what fits it.
        expect(classes[0].width * classes[0].height)
            .toBeGreaterThanOrEqual(classes[classes.length - 1].width * classes[classes.length - 1].height);
        for (const c of classes) {
            expect(c.members.every(m => fitsContainer(m, c.width, c.height))).toBe(true);
        }
    });
});

describe('the roster is the membership relation', () => {
    const defs = {
        a: { id: 'a', members: ['stats'] },
        b: { id: 'b', members: ['postgamecallout', 'postgamevs'] },
    };

    it('answers which container holds an element', () => {
        expect(hostOf(defs, 'stats')).toBe('a');
        expect(hostOf(defs, 'postgamevs')).toBe('b');
    });

    // No implicit default any more: an element nobody rostered has nowhere to
    // be pushed, and every surface reports that rather than inventing one.
    it('answers null for an element on no roster', () => {
        expect(hostOf(defs, 'hitvisualizer')).toBeNull();
        expect(fedTargets(defs).hitvisualizer).toBeUndefined();
    });

    it('maps every rostered member to its container', () => {
        expect(fedTargets(defs)).toEqual({
            stats: 'a', postgamecallout: 'b', postgamevs: 'b',
        });
    });
});

describe('a new container id', () => {
    it('slugs the name into something safe in a URL and a state key', () => {
        expect(containerIdFor('Lower Bar')).toBe('lower-bar');
        expect(containerIdFor('Replay / Stage!')).toBe('replay-stage');
    });

    it('uniquifies rather than clobbering an existing container', () => {
        expect(containerIdFor('Lower Bar', { 'lower-bar': {} })).toBe('lower-bar-2');
        expect(containerIdFor('Lower Bar', { 'lower-bar': {}, 'lower-bar-2': {} }))
            .toBe('lower-bar-3');
    });

    it('never yields an empty id', () => {
        expect(containerIdFor('!!!')).toBe('container');
        expect(containerIdFor('')).toBe('container');
    });

    /*
     * Never all digits: a container's row id is `container:{id}`, and the
     * instance grammar reads a colon followed by digits as the BOARD suffix —
     * so a container named "2" would parse as the element `container` on board
     * 2. Same rule that forbids a numeric desk name.
     */
    it('never yields an all-digit id, which would parse as a board suffix', () => {
        expect(containerIdFor('2')).toBe('c-2');
        expect(parseInstanceId(`container:${containerIdFor('2')}`).board).toBeNull();
        // …where an unguarded slug would have.
        expect(parseInstanceId('container:2').board).toBe(2);
    });
});

/*
 * The console's list of what can occupy a container and the ENGINE's list of
 * what it can actually mount are the same fact in two runtimes with no shared
 * module between `public/layout/lib` and `src/`. Pinned against each other
 * until the mount registry makes them one list.
 */
describe('members the engine can actually mount', () => {
    it('matches fed-container.js', () => {
        const src = readFileSync('public/layout/lib/fed-container.js', 'utf8');
        for (const el of CONTAINER_MEMBERS) {
            expect(
                src.includes(`'${el.id}'`),
                `fed-container.js cannot mount "${el.id}", but the console offers it as a member`,
            ).toBe(true);
        }
    });

    it('gives every member a sample occupant, so a container is never a blank preview', () => {
        const src = readFileSync('public/layout/lib/fed-container.js', 'utf8');
        const table = src.slice(src.indexOf('SAMPLE_OCCUPANTS'), src.indexOf('export function containerSample'));
        for (const el of CONTAINER_MEMBERS) {
            expect(table.includes(el.id), `no sample occupant for "${el.id}"`).toBe(true);
        }
    });
});

/*
 * The real mutations, through the real hook. An earlier draft of this file
 * re-implemented setMember and asserted against the copy, which pins nothing —
 * exclusivity has to be enforced in one place and this is where that is proven.
 */
describe('roster mutations', () => {
    const defsOf = () => useSettingsStore.getState().production.container_defs;
    const feedOf = (id) => useStateStore.getState()?.production?.feed?.container?.[id];

    let act;
    const Probe = () => { act = useContainerActions(); return null; };

    beforeEach(() => {
        useSettingsStore.setState({
            production: {
                container_defs: {
                    a: { id: 'a', name: 'A', width: 1920, height: 1080, members: ['stats'] },
                    b: { id: 'b', name: 'B', width: 1920, height: 1080, members: [] },
                },
            },
        });
        render(<Probe />);
    });

    afterEach(cleanup);

    /*
     * Adding a member is a MOVE. A container holds exactly one occupant, so an
     * element two rosters both claim could only ever occupy one of them —
     * "shared container" and "mutually exclusive" are the same statement.
     */
    it('takes a member off its previous container', () => {
        act.setMember('b', 'stats', true);
        expect(defsOf().a.members).toEqual([]);
        expect(defsOf().b.members).toEqual(['stats']);
        expect(hostOf(defsOf(), 'stats')).toBe('b');
    });

    it('is idempotent — adding a member it already has changes nothing', () => {
        act.setMember('a', 'stats', true);
        expect(defsOf().a.members).toEqual(['stats']);
    });

    /*
     * Taking a member off releases the feed if that member is what the
     * container is carrying. Leaving it up would strand content on air that
     * nothing can then clear — the element no longer has a container to
     * address, so its own Clear is gone too.
     */
    it('releases the feed when the carried member leaves', () => {
        useStateStore.setState({
            production: { feed: { container: { a: { element: 'stats', scoreboard: 1 } } } },
        });
        act.setMember('a', 'stats', false);
        expect(defsOf().a.members).toEqual([]);
        expect(feedOf('a')).toBeUndefined();
    });

    it('leaves a feed alone when a DIFFERENT member leaves', () => {
        useSettingsStore.setState({
            production: {
                container_defs: {
                    a: {
                        id: 'a', name: 'A', width: 1920, height: 1080,
                        members: ['postgamecallout', 'postgamevs'],
                    },
                },
            },
        });
        useStateStore.setState({
            production: { feed: { container: { a: { element: 'postgamevs', scoreboard: 1 } } } },
        });
        act.setMember('a', 'postgamecallout', false);
        expect(feedOf('a')).toEqual({ element: 'postgamevs', scoreboard: 1 });
    });

    it('creates a container and claims its members off whatever held them', () => {
        const id = act.create('Lower Bar', 452, 118, ['stats']);
        expect(id).toBe('lower-bar');
        expect(defsOf()['lower-bar']).toMatchObject({
            name: 'Lower Bar', width: 452, height: 118, members: ['stats'],
        });
        expect(defsOf().a.members).toEqual([]);
    });

    it('renames without changing the id the URL and the feed key are built on', () => {
        act.rename('a', 'Callouts');
        expect(defsOf().a.name).toBe('Callouts');
        expect(defsOf().a.id).toBe('a');
        expect(Object.keys(defsOf())).toContain('a');
    });

    /*
     * Deleting the definition clears the feed but never removes the OBS source:
     * the console does not delete a source the producer watched appear. The
     * source keeps rendering, and its panel says it has no definition left.
     */
    it('deletes the definition and clears its feed, leaving the source alone', () => {
        useStateStore.setState({
            production: { feed: { container: { a: { element: 'stats', scoreboard: 1 } } } },
        });
        act.remove('a');
        expect(defsOf().a).toBeUndefined();
        expect(feedOf('a')).toBeUndefined();
    });
});

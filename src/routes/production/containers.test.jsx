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
 * module between `public/layout/lib` and `src/`, so they are pinned against each
 * other here.
 *
 * Read out of the source text rather than imported: `fed-container.js` imports
 * the mounts by absolute `/layout/…` URL and drags in three.js and GSAP, none of
 * which belongs in a unit test. The mechanics it delegates to
 * `container-layers.js` ARE imported and tested directly — see
 * container-layers.test.js.
 */
function engineMembers() {
    const src = readFileSync('public/layout/lib/fed-container.js', 'utf8');
    const start = src.indexOf('const MEMBERS = {');
    expect(start, 'fed-container.js no longer declares a MEMBERS registry').toBeGreaterThan(-1);
    const table = src.slice(start, src.indexOf('\n};', start));

    // Entries are the table's own two-space-indented keys, so a nested `size:`
    // or `sample:` can't be mistaken for one.
    const marks = [...table.matchAll(/\n {2}(\w+): \{/g)];
    const out = {};
    marks.forEach((m, i) => {
        const body = table.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : table.length);
        const size = /size: \[(\d+), (\d+)\]/.exec(body);
        out[m[1]] = {
            size: size ? [Number(size[1]), Number(size[2])] : null,
            hasSample: /sample: \{/.test(body),
        };
    });
    return out;
}

describe('members the engine can actually mount', () => {
    const engine = engineMembers();

    it('has an entry for every member the console offers', () => {
        for (const el of CONTAINER_MEMBERS) {
            expect(
                engine[el.id],
                `fed-container.js cannot mount "${el.id}", but the console offers it as a member`,
            ).toBeTruthy();
        }
    });

    /*
     * The engine centers a member in a box of its NATIVE size, and the console
     * filters the member picker by the same number (`fitsContainer`) and creates
     * the OBS source at it. Three readers, one fact — and the size the census
     * quoted for `stats` was the standalone stats.html card's (452×118) rather
     * than the fed stats bar's (325×120), which seeded a container its only
     * member did not fit.
     */
    it('agrees with the element registry about every member size', () => {
        for (const el of CONTAINER_MEMBERS) {
            expect(engine[el.id].size, `no size declared for "${el.id}"`).toEqual([el.width, el.height]);
        }
    });

    it('gives every member a sample occupant, so a container is never a blank preview', () => {
        for (const el of CONTAINER_MEMBERS) {
            expect(engine[el.id].hasSample, `no sample occupant for "${el.id}"`).toBe(true);
        }
    });
});

/*
 * The seeded definitions have to obey the rule the console enforces on the
 * producer's own containers: a member must FIT. They are written in Python and
 * read here as text for the same reason as above — one fact, two runtimes.
 */
describe('the seeded container definitions', () => {
    const src = readFileSync('server/settings.py', 'utf8');
    const start = src.indexOf('"container_defs": {');
    const raw = src.slice(src.indexOf('{', start), src.indexOf('\n            },', start) + 14);
    const defs = JSON.parse(
        raw.split('\n')
            .filter(line => !/^\s*#/.test(line))   // drop comment-only lines
            .join('\n')
            .replace(/,(\s*[}\]])/g, '$1'),        // Python's trailing commas
    );

    it('seeds every container at a size its members fit', () => {
        for (const [id, def] of Object.entries(defs)) {
            for (const m of def.members) {
                const el = CONTAINER_MEMBERS.find(e => e.id === m);
                expect(el, `"${id}" rosters "${m}", which is not a container member`).toBeTruthy();
                expect(
                    fitsContainer(el, def.width, def.height),
                    `"${id}" is ${def.width}×${def.height}, too small for its member "${m}" `
                    + `(${el.width}×${el.height})`,
                ).toBe(true);
            }
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

    /*
     * The SHARED-MEMBER exception, and the reason there is one.
     *
     * Exclusivity answers "where does a push land". A container-scoped member
     * (a roster, a stat card) has no content of its own — it draws whoever the
     * CONTAINER's scope has on the field — so the container is the subject and
     * two rosters holding it is not a contradiction. It is the mirrored pair the
     * automation engine was designed around: two scoped containers, the same two
     * members, one canned rule, one showing the batter and the other the
     * pitcher. Moving would have made that unbuildable anywhere but a text
     * editor.
     */
    it('adds a container-scoped member instead of moving it', () => {
        useSettingsStore.setState({
            production: {
                container_defs: {
                    left: { id: 'left', name: 'L', width: 452, height: 240, members: ['roster'] },
                    right: { id: 'right', name: 'R', width: 452, height: 240, members: [] },
                },
            },
        });
        act.setMember('right', 'roster', true);
        expect(defsOf().left.members).toEqual(['roster']);
        expect(defsOf().right.members).toEqual(['roster']);
    });

    it('still takes a shared member off the one container it was removed from', () => {
        useSettingsStore.setState({
            production: {
                container_defs: {
                    left: { id: 'left', name: 'L', width: 452, height: 240, members: ['roster'] },
                    right: { id: 'right', name: 'R', width: 452, height: 240, members: ['roster'] },
                },
            },
        });
        act.setMember('left', 'roster', false);
        expect(defsOf().left.members).toEqual([]);
        expect(defsOf().right.members).toEqual(['roster']);
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

    /*
     * The engine's mirrored REASON is per-container state the server only ever
     * writes — `settle_all` walks the definitions that still exist, so nothing
     * revisits a deleted one. Ids come off the NAME, so rebuilding a container
     * with the same name reclaims the id and inherited that reason; because
     * `ReasonLine` doesn't gate on carrying anything, the fresh container's
     * panel opened claiming a producer push was suspending its rules.
     *
     * Deleting AT REST is the case that matters: `releaseFeed` early-returns
     * with nothing carried, so this needs its own unset rather than riding the
     * feed clear.
     */
    it('drops the mirrored feed reason, even deleting a container at rest', () => {
        useStateStore.setState({
            production: { feed: { container: {}, reason: { a: 'manual' } } },
        });

        act.remove('a');

        expect(useStateStore.getState()?.production?.feed?.reason?.a).toBeUndefined();
    });
});

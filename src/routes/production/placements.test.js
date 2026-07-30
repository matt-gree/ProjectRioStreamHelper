import { describe, it, expect } from 'vitest';
import {
    catalogPlacements, genericElement, parsePlacementId, placementId, placementTarget,
    placementsInScene, resolvePlacement, sceneRole, sourcelessPlacement, togglePin,
} from './placements';
import { fedTargets } from './containers';
import { chipFor } from './kit';

/*
 * Placements are the console's row identity now: element + board + SCENE. These
 * pin the three rules that make scene grouping honest —
 *
 *   1. a row exists because a SOURCE exists (source → row, never row → source),
 *   2. fed elements row where their CONTAINER is, several to a source,
 *   3. a stored id resolves; it is never rewritten.
 */

const item = (id, sourceName, url, enabled = false) =>
    ({ id, sourceName, url, enabled, inputKind: 'browser_source', isGroup: false, isPrsh: true });

const scene = (name, where, ...items) => ({ scene: name, where, items });

/*
 * Container DEFINITIONS, the shape settings hold them in. Membership lives on
 * the container now, so a test that used to hand `fedTargets` an element →
 * container map builds a roster instead — which is the point: one relationship,
 * one home.
 */
const defs = (spec) => Object.fromEntries(Object.entries(spec).map(([id, members]) => [
    id, { id, name: id, width: 1920, height: 1080, members },
]));
const DEFAULT_DEFS = defs({ 'callout-stage': ['postgamecallout', 'postgamevs'] });
const targets = fedTargets(DEFAULT_DEFS);
const rows = (sc) => placementsInScene(sc, targets, {}, DEFAULT_DEFS);

const SB = 'http://x/layout/scoreboard1/scoreboard.html';
const LOWER = 'http://x/layout/lowerthird/lowerthird.html';
const CALLOUT = 'http://x/layout/shared/callout-stage.html';
const ROSTER = 'http://x/layout/scoreboard1/roster.html';
const SHELL = 'http://x/layout/shared/container.html';

describe('placement ids', () => {
    // Scene names are arbitrary user strings; the instance half never is.
    it('splits on the FIRST separator, so a scene name may contain anything', () => {
        expect(parsePlacementId('scoreboard:2@Break')).toEqual({ instance: 'scoreboard:2', scene: 'Break' });
        expect(parsePlacementId(placementId('lowerthird', 'A@B: the sequel')))
            .toEqual({ instance: 'lowerthird', scene: 'A@B: the sequel' });
    });

    it('reads a pre-scene id as an instance with no scene', () => {
        expect(parsePlacementId('scoreboard:2')).toEqual({ instance: 'scoreboard:2', scene: null });
    });
});

describe('sceneRole', () => {
    const obs = { programScene: 'Game', previewScene: 'Break', studioMode: true };

    it('names the program and studio-preview scenes', () => {
        expect(sceneRole('Game', obs)).toBe('program');
        expect(sceneRole('Break', obs)).toBe('preview');
        expect(sceneRole('Intermission', obs)).toBe('other');
    });

    // With studio mode off there IS no preview scene, whatever OBS last held.
    it('does not call a scene preview while studio mode is off', () => {
        expect(sceneRole('Break', { ...obs, studioMode: false })).toBe('other');
    });
});

describe('placementsInScene — source → row', () => {
    it('rows a direct element at the board its URL names', () => {
        const [p] = rows(scene('Game', 'program', item(1, 'SB2', `${SB}?scoreboard=2`)));
        expect(p.id).toBe('scoreboard:2@Game');
        expect(p.element.id).toBe('scoreboard');
        expect(p.board).toBe(2);
        expect(p.where).toBe('program');
    });

    it('reads a paramless source as board 1, matching how binding compares it', () => {
        expect(rows(scene('Game', 'program', item(1, 'SB', SB)))[0].id).toBe('scoreboard:1@Game');
    });

    it('gives a global element no board suffix', () => {
        expect(rows(scene('Game', 'program', item(1, 'L3', LOWER)))[0].id).toBe('lowerthird@Game');
    });

    /*
     * The same overlay in two scenes is TWO rows. They are two scene items with
     * their own enabled state, and controlling them as one is the bug scene
     * grouping exists to fix.
     */
    it('rows the same overlay once per scene it appears in', () => {
        const game = rows(scene('Game', 'program', item(1, 'SB', SB)));
        const brk = rows(scene('Break', 'other', item(9, 'SB', SB)));
        expect([game[0].id, brk[0].id]).toEqual(['scoreboard:1@Game', 'scoreboard:1@Break']);
        expect(game[0].instance).toBe(brk[0].instance);
    });

    it('rows two boards in one scene separately', () => {
        const out = rows(scene('Game', 'program',
            item(1, 'A', `${SB}?scoreboard=1`), item(2, 'B', `${SB}?scoreboard=2`)));
        expect(out.map(p => p.id)).toEqual(['scoreboard:1@Game', 'scoreboard:2@Game']);
        expect(out.map(p => p.item.sourceName)).toEqual(['A', 'B']);
    });

    /*
     * A shared container IS the source, so it takes the row; the fed elements
     * aimed at it nest underneath. Both still row here — collapsing them into
     * one would take away a control the producer drives separately — but the
     * container owns the scene item, and they are alternatives on it.
     */
    it('rows a container with its fed elements nested under it', () => {
        const out = rows(scene('Game', 'program', item(3, 'Callout', CALLOUT)));
        expect(out[0].container).toBe('callout-stage');
        expect(out[0].parent).toBeUndefined();
        expect(out.slice(1).map(p => p.element.id).sort())
            .toEqual(['postgamecallout', 'postgamevs']);
        // Every child points at the container row, and they share its item.
        expect(out.slice(1).every(p => p.parent === out[0].id)).toBe(true);
        expect(new Set(out.map(p => p.item.id))).toEqual(new Set([3]));
    });

    /*
     * The container's row does not depend on anything being aimed at it. It used
     * to appear only when NOTHING targeted it (falling through to genericElement)
     * and vanish when something did — a row blinking in and out on a setting.
     */
    it('rows a container nobody is aimed at just the same', () => {
        const moved = defs({
            'callout-stage': [],
            'split-screen': ['postgamecallout', 'postgamevs'],
        });
        const out = placementsInScene(
            scene('Game', 'program', item(3, 'Callout', CALLOUT)), fedTargets(moved), {}, moved,
        );
        expect(out).toHaveLength(1);
        expect(out[0].container).toBe('callout-stage');
        expect(out[0].feeds).toEqual([]);
    });

    it('follows a fed element re-pointed at another container', () => {
        const repointed = defs({
            'callout-stage': ['postgamecallout'],
            'split-screen': ['postgamevs'],
        });
        const out = placementsInScene(
            scene('Game', 'program', item(3, 'Callout', CALLOUT)),
            fedTargets(repointed), {}, repointed,
        );
        expect(out.map(p => p.element.id)).toEqual(['container:callout-stage', 'postgamecallout']);
    });

    /*
     * Every container is rendered by ONE generic shell, so identity has to come
     * from the container id — keying on the pathname would give two containers
     * in one scene the same row id, and a panel would drive whichever the
     * lookup reached first. Same bug the board and variant axes exist to stop.
     */
    it('keeps two containers on one shell apart', () => {
        const two = defs({ 'callout-stage': ['postgamecallout'], bar: ['stats'] });
        const out = placementsInScene(scene('Game', 'program',
            item(3, 'Callout', `${SHELL}?container=callout-stage`),
            item(4, 'Bar', `${SHELL}?container=bar`)), fedTargets(two), {}, two);
        expect(out.filter(p => p.container && !p.parent).map(p => p.id))
            .toEqual(['container:callout-stage@Game', 'container:bar@Game']);
    });

    // A source still pointing at a pre-2.0 named shell resolves to the same
    // container id its filename always meant, so it keeps rowing and feeding.
    it('resolves a legacy named shell to its stem', () => {
        const out = rows(scene('Game', 'program', item(3, 'Callout', CALLOUT)));
        expect(out[0].container).toBe('callout-stage');
    });

    // An unregistered overlay outside shared/ is NOT a container — it gets a
    // plain row, and nothing nests under it.
    it('does not treat an ordinary unregistered overlay as a container', () => {
        const [p] = rows(scene('Game', 'program', item(4, 'Roster', ROSTER)));
        expect(p.container).toBeNull();
        expect(p.feeds).toEqual([]);
    });

    /*
     * A PRSH source the registry has never heard of still gets a row. The Add
     * picker offers the whole layout catalog, so being blind to these would mean
     * adding something the producer then cannot find.
     */
    it('rows an unregistered PRSH source rather than dropping it', () => {
        const [p] = rows(scene('Game', 'program', item(4, 'Roster', ROSTER)));
        expect(p.element.generic).toBe(true);
        expect(p.element.name).toBe('Roster');
        expect(p.id).toBe('layout:/layout/scoreboard1/roster.html@Game');
    });

    it('names a generic element from its file, not its query', () => {
        expect(genericElement('http://x/layout/shared/split-screen.html?team=2').name)
            .toBe('Split Screen');
    });

    /*
     * THE TEAM AXIS. Every team-variant layout (roster, stats, teamlogo,
     * controller…) is unregistered, so both sides row through genericElement —
     * which keys on the PATHNAME. Left at that, team 1 and team 2 share one id:
     * duplicate React keys in the rack, and `resolvePlacement`'s find() handing
     * the left-side panel the right-side source. Same class of bug as two boards
     * sharing a row, one axis over.
     */
    it('rows two team variants of one layout separately', () => {
        const out = rows(scene('Game', 'program',
            item(4, 'Roster L', `${ROSTER}?team=1`), item(5, 'Roster R', `${ROSTER}?team=2`)));
        expect(out.map(p => p.id)).toEqual([
            'layout:/layout/scoreboard1/roster.html~t1@Game',
            'layout:/layout/scoreboard1/roster.html~t2@Game',
        ]);
        expect(out.map(p => p.item.sourceName)).toEqual(['Roster L', 'Roster R']);
        // One TYPE wearing two variants — the element is still the layout.
        expect(new Set(out.map(p => p.element.id)).size).toBe(1);
    });

    // Same axis on a registered element: one board, two sizes, two sources.
    it('rows two size variants of one board separately', () => {
        const out = rows(scene('Game', 'program',
            item(1, 'Big', `${SB}?scoreboard=1&size=l`), item(2, 'Small', `${SB}?scoreboard=1&size=s`)));
        expect(out.map(p => p.id)).toEqual(['scoreboard:1~zl@Game', 'scoreboard:1~zs@Game']);
    });

    /*
     * Fed elements take neither axis. Their container is board-agnostic and the
     * board rides in the pushed payload, so reading a variant off the container
     * URL would split one container's pushers into rows that can't both push.
     */
    it('leaves fed elements unsharded by a param on their container', () => {
        const out = rows(scene('Game', 'program', item(3, 'Callout', `${CALLOUT}?team=2`)));
        expect(out.filter(p => p.parent).map(p => p.id).sort())
            .toEqual(['postgamecallout@Game', 'postgamevs@Game']);
    });
});

describe('resolvePlacement — stored ids are resolved, never rewritten', () => {
    const game = rows(scene('Game', 'program', item(1, 'SB1', `${SB}?scoreboard=1`)));
    const brk = rows(scene('Break', 'other', item(2, 'SB2', `${SB}?scoreboard=2`)));
    const all = [...game, ...brk];

    it('keeps an id that still names a live placement', () => {
        expect(resolvePlacement('scoreboard:2@Break', all).id).toBe('scoreboard:2@Break');
    });

    it('rescues a selection whose scene is gone, keeping the board', () => {
        expect(resolvePlacement('scoreboard:2@Deleted', all).id).toBe('scoreboard:2@Break');
    });

    /*
     * A NAMED SCENE OUTRANKS "nearest air". A pin written before instances
     * existed still says which scene it meant, and answering with the program
     * copy would hand the producer a card that flies the wrong scene — the
     * whole failure scene grouping exists to prevent, one axis over.
     */
    it('honours the scene in a stale id instead of jumping to the air copy', () => {
        expect(resolvePlacement('scoreboard@Break', all).id).toBe('scoreboard:2@Break');
    });

    // Program → preview → anywhere: "the scoreboard" means the one on air.
    it('prefers the copy nearest air when the id names no scene', () => {
        expect(resolvePlacement('scoreboard:1', all).id).toBe('scoreboard:1@Game');
        expect(resolvePlacement('scoreboard', all).id).toBe('scoreboard:1@Game');
    });

    /*
     * Nothing in any scene answers to it — the panel still opens. Several stage
     * bodies write STATE, not OBS (authoring a lower third the night before is a
     * real workflow), so a selection must not evaporate because OBS is closed.
     */
    it('falls back to a sourceless placement instead of nothing', () => {
        const p = resolvePlacement('lowerthird', []);
        expect(p.element.id).toBe('lowerthird');
        expect(p.item).toBeNull();
        expect(p.scene).toBeNull();
    });

    it('defaults a sourceless board-scoped element to board 1', () => {
        expect(sourcelessPlacement('scoreboard').board).toBe(1);
        expect(sourcelessPlacement('scoreboard:3').board).toBe(3);
    });

    // Nothing to read a variant off, so it is carried through — answering a
    // selection that said team 2 with a team-1 panel would be a silent swap.
    it('keeps the variant on a sourceless placement', () => {
        const p = sourcelessPlacement('scoreboard:2~zs');
        expect(p.id).toBe('scoreboard:2~zs');
        expect(p.variant).toBe('zs');
    });

    // A variant is part of the identity, so it narrows like the board does.
    it('does not answer one variant with another', () => {
        const two = rows(scene('Game', 'program',
            item(1, 'L', `${ROSTER}?team=1`), item(2, 'R', `${ROSTER}?team=2`)));
        expect(resolvePlacement('layout:/layout/scoreboard1/roster.html~t2@Game', two).item.sourceName)
            .toBe('R');
    });

    it('returns null for an id no element answers to', () => {
        expect(resolvePlacement('retired-element', all)).toBeNull();
        expect(resolvePlacement(null, all)).toBeNull();
    });
});

describe('togglePin — compared by what a pin RESOLVES to', () => {
    const all = rows(scene('Game', 'program', item(1, 'SB1', `${SB}?scoreboard=1`)));

    it('unpins a legacy id through the placement it renders as', () => {
        expect(togglePin(['scoreboard'], 'scoreboard:1@Game', all)).toEqual([]);
    });

    it('cannot make two cards for one source', () => {
        expect(placementTarget('scoreboard', all)).toBe('scoreboard:1@Game');
        expect(togglePin(['scoreboard'], 'scoreboard:1@Game', all)).not.toContain('scoreboard:1@Game');
    });

    it('writes new pins canonical, so the rail converges as it is used', () => {
        expect(togglePin([], 'scoreboard:1@Game', all)).toEqual(['scoreboard:1@Game']);
    });

    it('passes through a pin placements do not own (a desk)', () => {
        expect(placementTarget('desk:capture', all)).toBe('desk:capture');
        expect(togglePin(['desk:capture'], 'desk:capture', all)).toEqual([]);
    });
});

/*
 * ── The catalog tier: the rack with no OBS ────────────────────────────────
 *
 * Source → row is right when there is a source. With OBS closed there is none,
 * and the console used to collapse to three desk rows — no row to select, so no
 * stage, so no way to author a lower third, build a container or preview
 * anything. These pin the trade: it lists what PRSH can CONFIGURE, in the same
 * placement shape everything downstream already consumes.
 */
describe('catalogPlacements — what PRSH can configure with no OBS', () => {
    const defs = {
        'callout-stage': {
            id: 'callout-stage', name: 'Callout Stage', width: 1920, height: 1080,
            members: ['postgamecallout', 'postgamevs'],
        },
    };
    const all = (o) => catalogPlacements({ defs, boards: [1], ...o });
    const idsOf = (rows) => rows.map(p => p.id);

    it('rows every direct element, with no source and no scene', () => {
        const rows = all();
        const lt = rows.find(p => p.element.id === 'lowerthird');
        expect(lt).toMatchObject({ id: 'lowerthird', item: null, scene: null, where: 'none' });
        // Which is exactly what makes the chip honest without a new word for it.
        expect(chipFor(lt)).toBe('unbound');
    });

    /*
     * Ids are the PRE-SCENE form, which is also what a legacy pin looks like — so
     * a selection or pin made offline resolves to the real scene copy the moment
     * OBS opens. Read-time resolution, nothing rewritten.
     */
    it('keys rows in the pre-scene form, so they resolve once OBS is up', () => {
        const offline = all().find(p => p.element.id === 'scoreboard');
        expect(offline.id).toBe('scoreboard:1');

        const online = rows(scene('Game', 'program', item(1, 'SB1', `${SB}?scoreboard=1`)));
        expect(resolvePlacement(offline.id, online).id).toBe('scoreboard:1@Game');
    });

    // The one legitimate reader left for the DECLARED board list: with no OBS
    // there is nothing to discover boards from, and Settings knows the rig.
    it('gives a board-scoped element one row per declared board', () => {
        const ids = idsOf(all({ boards: [1, 2, 3] }));
        expect(ids).toContain('scoreboard:1');
        expect(ids).toContain('scoreboard:3');
        expect(ids.filter(i => i.startsWith('scorecard:'))).toHaveLength(3);
        // …and a global element stays single.
        expect(ids.filter(i => i === 'lowerthird')).toHaveLength(1);
    });

    it('rows a container from its definition, with its roster nested under it', () => {
        const rows = all();
        const stage = rows.find(p => p.id === 'container:callout-stage');
        expect(stage).toMatchObject({ container: 'callout-stage', item: null });
        expect(stage.element.name).toBe('Callout Stage');
        expect(stage.feeds).toEqual(['postgamecallout', 'postgamevs']);

        const kids = rows.filter(p => p.parent === stage.id).map(p => p.element.id);
        expect(kids).toEqual(['postgamecallout', 'postgamevs']);
    });

    // Feeding a container is a STATE write and needs no OBS, so `mine` has to be
    // right offline too — it is what the row's radio reads.
    it('marks which member the container is carrying', () => {
        const rows = all({ feeds: { 'callout-stage': { element: 'postgamevs' } } });
        const byId = Object.fromEntries(rows.map(p => [p.element.id, p]));
        expect(byId.postgamevs.mine).toBe(true);
        expect(byId.postgamecallout.mine).toBe(false);
    });

    /*
     * A fed element no roster claims rows at the TOP level. Online it has no
     * container source to nest under and simply doesn't appear; offline, being
     * unreachable is the problem — its stage is where the producer finds out it
     * needs a container.
     */
    it('still rows a fed element that no container has rostered', () => {
        const orphan = catalogPlacements({ defs: {}, boards: [1] })
            .find(p => p.element.id === 'stats');
        expect(orphan).toBeTruthy();
        expect(orphan.parent).toBeUndefined();
    });

    it('never rows the same thing twice', () => {
        const ids = idsOf(all({ boards: [1, 2] }));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

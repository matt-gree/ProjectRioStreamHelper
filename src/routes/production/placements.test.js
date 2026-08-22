import { describe, it, expect } from 'vitest';
import { ELEMENTS } from './elements';
import {
    catalogPlacements, genericElement, parsePlacementId, placementFlavor, placementId,
    placementTarget, placementsInScene, resolvePlacement, sceneRole, sourcelessPlacement,
    togglePin,
} from './placements';
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
 * the container now, so a test that used to hand an element → container map
 * builds a roster instead — which is the point: one relationship, one home, and
 * the rack reads it straight rather than inverting it.
 */
const defs = (spec) => Object.fromEntries(Object.entries(spec).map(([id, members]) => [
    id, { id, name: id, width: 1920, height: 1080, members },
]));
const DEFAULT_DEFS = defs({ 'callout-stage': ['postgamecallout', 'postgamevs'] });
const rows = (sc) => placementsInScene(sc, {}, DEFAULT_DEFS);

const SB = 'http://x/layout/scoreboard1/scoreboard.html';
const LOWER = 'http://x/layout/lowerthird/lowerthird.html';
const CALLOUT = 'http://x/layout/shared/callout-stage.html';
// The Character Spotlight's OWN source. It is a container member AND a direct
// element now, which is the pair these tests exist to keep apart.
const SPOTLIGHT = 'http://x/layout/postgame/spotlight.html';
/*
 * A PRSH layout the registry has never heard of, with a ?team= variant.
 *
 * SYNTHETIC ON PURPOSE. This exemplar has already had to move twice — Roster,
 * then Team Logo — because each time the console grew a stage panel for one, it
 * stopped being unregistered and took these tests with it. What is under test is
 * the GENERIC path, not any particular layout, so the URL is one no element will
 * ever claim. Registering something must not be able to break the fallback for
 * everything else.
 */
const UNREGISTERED = 'http://x/layout/custom/panel.html';
const ROSTER = 'http://x/layout/scoreboard1/roster.html';
const PLAYERNAME = 'http://x/layout/scoreboard1/playername.html';
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
            scene('Game', 'program', item(3, 'Callout', CALLOUT)), {}, moved,
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
            {}, repointed,
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
            item(4, 'Bar', `${SHELL}?container=bar`)), {}, two);
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
        const [p] = rows(scene('Game', 'program', item(4, 'Panel', UNREGISTERED)));
        expect(p.container).toBeNull();
        expect(p.feeds).toEqual([]);
    });

    /*
     * A PRSH source the registry has never heard of still gets a row. The Add
     * picker offers the whole layout catalog, so being blind to these would mean
     * adding something the producer then cannot find.
     */
    it('rows an unregistered PRSH source rather than dropping it', () => {
        const [p] = rows(scene('Game', 'program', item(4, 'Panel', UNREGISTERED)));
        expect(p.element.generic).toBe(true);
        expect(p.element.name).toBe('Panel');
        expect(p.id).toBe('layout:/layout/custom/panel.html@Game');
    });

    it('names a generic element from its file, not its query', () => {
        expect(genericElement('http://x/layout/shared/split-screen.html?team=2').name)
            .toBe('Split Screen');
    });

    /*
     * THE TEAM AXIS, on a layout the registry does not carry. It rows through
     * genericElement — which keys on the PATHNAME. Left at that, team 1 and
     * team 2 share one id: duplicate React keys in the rack, and
     * `resolvePlacement`'s find() handing the left-side panel the right-side
     * source. Same class of bug as two boards sharing a row, one axis over.
     */
    it('rows two team variants of one layout separately', () => {
        const out = rows(scene('Game', 'program',
            item(4, 'Panel L', `${UNREGISTERED}?team=1`), item(5, 'Panel R', `${UNREGISTERED}?team=2`)));
        expect(out.map(p => p.id)).toEqual([
            'layout:/layout/custom/panel.html~t1@Game',
            'layout:/layout/custom/panel.html~t2@Game',
        ]);
        expect(out.map(p => p.item.sourceName)).toEqual(['Panel L', 'Panel R']);
        // One TYPE wearing two variants — the element is still the layout.
        expect(new Set(out.map(p => p.element.id)).size).toBe(1);
    });

    /*
     * Roster is a REGISTERED element now — it has to be, since a container can
     * only host something the element registry carries a size for, and a
     * container resting on a roster is half of what the combined Roster + Stats
     * source was. Its two sides still row separately: the variant is read off
     * `?team=` whether or not the element is registered.
     */
    it('rows a registered roster as an element, one row per side', () => {
        const out = rows(scene('Game', 'program',
            item(6, 'Roster L', `${ROSTER}?scoreboard=1&team=1`),
            item(7, 'Roster R', `${ROSTER}?scoreboard=1&team=2`)));
        expect(out.map(p => p.id)).toEqual(['roster~t1@Game', 'roster~t2@Game']);
        expect(out.every(p => p.element.generic)).toBe(false);
    });

    /*
     * Player Name is registered too, so a producer who places a name outside the
     * scoreboard gets a rack row and a stage panel for it — which is where its
     * alignment and prefix-position settings live. Without the registration the
     * settings exist and nothing can reach them.
     */
    it('rows a registered player name as an element, one row per side', () => {
        const out = rows(scene('Game', 'program',
            item(8, 'Name L', `${PLAYERNAME}?scoreboard=1&team=1`),
            item(9, 'Name R', `${PLAYERNAME}?scoreboard=1&team=2`)));
        expect(out.map(p => p.id)).toEqual(['playername~t1@Game', 'playername~t2@Game']);
        expect(out.every(p => p.element.generic)).toBe(false);
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
    /*
     * A member that owns a SOURCE is two rows, and they must not be one id.
     * Being fed is a property of the placement, not of the element: the
     * spotlight's own source is a direct row with an eye, and its slot on the
     * Callout Stage is a fed row with a Push. Before the slot half of the id
     * grammar the two collided — duplicate React keys, and a panel driving
     * whichever `find()` reached first.
     */
    it('rows a member’s own source and its container slot as two rows', () => {
        const out = rows(scene('Game', 'program',
            item(1, 'Spotlight', SPOTLIGHT),
            item(2, 'Callout Stage', CALLOUT)));

        const own = out.find(p => p.id === 'postgamecallout@Game');
        expect(own.item.sourceName).toBe('Spotlight');
        expect(own.slot).toBeUndefined();
        expect(placementFlavor(own)).toBe('direct');

        const onStage = out.find(p => p.id === 'postgamecallout+callout-stage@Game');
        expect(onStage).toMatchObject({ slot: 'callout-stage', container: 'callout-stage' });
        expect(onStage.item.sourceName).toBe('Callout Stage');
        expect(placementFlavor(onStage)).toBe('fed');
    });

    /*
     * Every member the roster names nests, not just the ones with no source of
     * their own. Leaving the source-owning members out meant a container listed
     * a roster the rack disagreed with — nothing said the hit visualizer was a
     * member, and there was no row to push it from.
     */
    it('nests every rostered member, including ones that own a source', () => {
        const withHit = defs({ 'split-screen': ['hitvisualizer'] });
        const out = placementsInScene(
            scene('Game', 'program', item(1, 'Split', `${SHELL}?container=split-screen`)),
            {}, withHit,
        );
        expect(out.filter(p => p.slot).map(p => p.id))
            .toEqual(['hitvisualizer+split-screen@Game']);
    });

    /*
     * A container-SCOPED member sits on several rosters — the exception that
     * makes a mirrored pair buildable — so nesting reads each container's OWN
     * roster rather than the inverted element→container map, which answers with
     * whichever container it finds first. With the inverted read the pair's
     * second container rowed empty in the rack while its own panel listed two
     * members.
     */
    it('nests a shared member under every container that rosters it', () => {
        const pair = defs({
            'roster-stats-1': ['roster', 'statscard'],
            'roster-stats-2': ['roster', 'statscard'],
        });
        const out = placementsInScene(
            scene('Game', 'program',
                item(1, 'Left', `${SHELL}?container=roster-stats-1`),
                item(2, 'Right', `${SHELL}?container=roster-stats-2`)),
            {}, pair,
        );
        expect(out.filter(p => p.slot).map(p => p.id)).toEqual([
            'roster+roster-stats-1@Game', 'statscard+roster-stats-1@Game',
            'roster+roster-stats-2@Game', 'statscard+roster-stats-2@Game',
        ]);
    });

    it('leaves fed elements unsharded by a param on their container', () => {
        const out = rows(scene('Game', 'program', item(3, 'Callout', `${CALLOUT}?team=2`)));
        expect(out.filter(p => p.parent).map(p => p.id).sort())
            .toEqual(['postgamecallout+callout-stage@Game', 'postgamevs+callout-stage@Game']);
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
            item(1, 'L', `${UNREGISTERED}?team=1`), item(2, 'R', `${UNREGISTERED}?team=2`)));
        expect(resolvePlacement('layout:/layout/custom/panel.html~t2@Game', two).item.sourceName)
            .toBe('R');
    });

    /*
     * A CONTAINER has no entry in ELEMENTS — its element is synthesised from the
     * definition — so an id naming one used to resolve to nothing at all, and the
     * stage fell through to its empty state. That inverted the rule this branch
     * exists for: a container's own panel is the ONLY place its roster, resting
     * occupant, scope and rules can be edited, and none of that needs a source.
     * Deleting the browser source made the container unreachable, while closing
     * OBS entirely brought it back (the catalog tier synthesises the same row).
     */
    it('opens a container’s panel when no source answers for it', () => {
        const p = resolvePlacement('container:roster-stats-2@Break', [], {
            'roster-stats-2': { name: 'Roster + Stats — Right', width: 452, height: 240 },
        });
        expect(p.element.id).toBe('container:roster-stats-2');
        expect(p.element.name).toBe('Roster + Stats — Right');
        expect(p.container).toBe('roster-stats-2');
        expect(p.item).toBeNull();
        expect(p.where).toBe('none');
    });

    // The definitions are optional: the panel still opens without them, it just
    // falls back to the id for its name and has no canvas to preview at.
    it('still opens one with no definition to hand', () => {
        const p = sourcelessPlacement('container:gone');
        expect(p.element.name).toBe('gone');
        expect(p.element.width).toBeUndefined();
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
        expect(placementTarget('desk:board:2', all)).toBe('desk:board:2');
        expect(togglePin(['desk:board:2'], 'desk:board:2', all)).toEqual([]);
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
        const offline = all().find(p => p.id === 'scoreboard:1');
        expect(offline).toBeTruthy();

        const online = rows(scene('Game', 'program', item(1, 'SB1', `${SB}?scoreboard=1`)));
        expect(resolvePlacement(offline.id, online).id).toBe('scoreboard:1@Game');
    });

    /*
     * Sizes read in the order they are declared. They used to be emitted with the
     * default hoisted to the front so a bare pin resolved to it — which listed
     * the board as Large, Small, Medium. That was invisible while the default
     * printed no label and plainly wrong once it named itself, so the resolution
     * rule moved into resolvePlacement and the order became the list's own.
     */
    it('lists an element’s sizes in declared order, default included', () => {
        const ids = idsOf(all()).filter(i => i.startsWith('scoreboard:1'));
        expect(ids).toEqual(['scoreboard:1~zs', 'scoreboard:1~zm', 'scoreboard:1']);
    });

    // …and a bare pin still answers with the default size rather than with
    // whichever row now happens to come first.
    it('answers a bare pin with the canonical instance, not the first row', () => {
        const rowsOut = all({ boards: [1] });
        expect(resolvePlacement('scoreboard', rowsOut).id).toBe('scoreboard:1');
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
        // Slot ids, exactly as online — a catalog id has to be the same string
        // the scene copy will be, or a pin made offline opens the other row.
        expect(rows.filter(p => p.parent === stage.id).map(p => p.id))
            .toEqual(['postgamecallout+callout-stage', 'postgamevs+callout-stage']);
    });

    /*
     * …and the member's own source still rows on its own, because it owns one.
     * That is the whole reason the Character Spotlight is reachable with no
     * container at all now: it is a source like any other.
     */
    it('rows a member’s own source alongside its slot', () => {
        const rows = all();
        const own = rows.find(p => p.id === 'postgamecallout');
        expect(own).toMatchObject({ item: null, scene: null, where: 'none' });
        expect(placementFlavor(own)).toBe('direct');
        // With no container claiming it at all, the own-source row is all there is.
        const alone = catalogPlacements({ defs: {}, boards: [1] })
            .filter(p => p.element.id === 'postgamecallout');
        expect(alone.map(p => p.id)).toEqual(['postgamecallout']);
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

    /*
     * SHELVED ≠ GONE. A `hidden` element drops out of the catalog — the rows the
     * console invents when there is no OBS to discover them from — and stays in
     * the source → row lookup, so a producer who already has one in a scene
     * keeps their row, their stage panel and their settings. Filtering the
     * lookup instead would quietly demote a live source to a generic layout.
     */
    it('leaves a shelved element out of the catalog but still recognises its source', () => {
        const shelved = ELEMENTS.filter(el => el.hidden);
        expect(shelved.length, 'nothing is shelved — drop this test with the flag').toBeGreaterThan(0);

        const offered = all({ boards: [1, 2] }).map(p => p.element.id);
        for (const el of shelved) expect(offered, el.id).not.toContain(el.id);

        // …and the same element still derives a row from a real source.
        const el = shelved[0];
        const online = rows(scene('Game', 'program', item(1, 'X', `http://x${el.url}`)));
        expect(online.map(p => p.element.id)).toContain(el.id);
    });
});

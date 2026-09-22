import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useObsStore } from '../../../context/obs';
import { useStateStore } from '../../../context/store';
import { boardOfUrl } from '../../../lib/obs-binding';
import { ELEMENTS, readsBoard } from '../elements';
import {
    CONTAINER_MEMBERS, containerOfSource, fedTargets, useContainerDefs,
} from '../containers/containers';
import {
    flipSideVariant, instanceId, parseInstanceId, sidePairVariant, slotInstanceId,
    variantLabelFor, variantOf,
    variantTagFor, withVariant,
} from './instances';
import { useActiveBoards, useBoardTag } from '../board/boards';
import { useSideLabels } from '../sides';

/*
 * Placements — what the rack actually lists once the grouping axis is SCENES.
 *
 * A placement is one thing the producer can control, IN ONE SCENE. It is the
 * third and last term in the identity chain the console has been converging on:
 *
 *   element    "Scoreboard"                       — a type
 *   instance   "Scoreboard on board 2"            — + which board or variant
 *   placement  "Scoreboard on board 2, in Break"  — + which scene's copy
 *
 * The scene has to be part of the identity for the same reason the board did.
 * A source in two scenes is two scene items with their own enabled state, so a
 * console that keys control on the instance alone drives whichever scene it
 * happened to resolve first — the exact bug board-aware binding fixed along the
 * other axis. It is also the whole payoff of scene grouping: staging a Break
 * scene while the Game scene is live means toggling THAT copy, not this one.
 *
 * DERIVATION RUNS SOURCE → ROW, not row → source.
 *
 * The rack used to hold a fixed list of elements and search OBS for each one's
 * source, which is why it grew dead "—" rows for everything nobody had added,
 * and why it needed a lone-candidate retry to cope with a source it couldn't
 * quite match. Scanning the scene instead means a row exists because a SOURCE
 * exists: no guessing, no dead rows, and a PRSH source the registry has never
 * heard of still shows up (see `genericElement`) instead of being invisible.
 *
 * The Add picker (./addsource) is the other half of that trade: with unbound
 * rows gone, it is how a source comes into being.
 */

export const PLACEMENT_SEP = '@';

/*
 * `{instance}@{scene}` — e.g. `scoreboard:2@Break`, `lowerthird@Game`.
 *
 * Scene names are arbitrary user strings and may contain anything, including
 * '@' and ':'. The instance half never does (element ids are plain identifiers,
 * the board suffix is digits), so splitting on the FIRST '@' is unambiguous in
 * the only direction we parse. Don't reverse it.
 */
export function placementId(instance, scene) {
    return `${instance}${PLACEMENT_SEP}${scene}`;
}

export function parsePlacementId(id) {
    const i = (id ?? '').indexOf(PLACEMENT_SEP);
    if (i < 0) return { instance: id ?? null, scene: null };
    return { instance: id.slice(0, i), scene: id.slice(i + 1) };
}

/*
 * What a scene is to the broadcast right now. This is the ONLY thing that
 * decides a chip, which is why it lives with the placement rather than being
 * re-derived per surface.
 */
export function sceneRole(scene, { programScene, previewScene, studioMode }) {
    if (scene && scene === programScene) return 'program';
    if (studioMode && scene && scene === previewScene) return 'preview';
    return 'other';
}

// A source URL reduced to the part that identifies the overlay. Origin and
// query are both incidental: the host varies per rig, the query carries
// variants and cache-busters.
const ORIGIN = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'http://localhost';

export function pathOf(url) {
    try { return new URL(url || '', ORIGIN).pathname; } catch { return (url || '').split('?')[0]; }
}

const DIRECT_ELEMENTS = ELEMENTS.filter(el => el.flavor === 'direct');
const FED_ELEMENTS = ELEMENTS.filter(el => el.flavor === 'fed');

/*
 * What the console OFFERS, as opposed to what it understands.
 *
 * A `hidden` element is shelved, not gone (see elements.js): a source already
 * pointing at it still derives a row from `DIRECT_ELEMENTS` above and keeps its
 * stage panel, and only the catalog tier — the rows the console invents when
 * there is no OBS to discover them from — leaves it out. Filtering the
 * source→row lookup instead would demote a producer's live source to a generic
 * layout, which is the opposite of shelving.
 */
const OFFERED_DIRECT = DIRECT_ELEMENTS.filter(el => !el.hidden);
const OFFERED_FED = FED_ELEMENTS.filter(el => !el.hidden);

/*
 * WHICH KIND OF ROW THIS IS — the one statement of it, read by every surface.
 *
 * Fed is a property of the PLACEMENT, not of the element. A member sitting on a
 * container's roster rows under that container and pushes into it; the same
 * element's own dedicated source rows on its own and only shows and hides. Both
 * are true at once for a member that owns a source (the hit visualizer, the two
 * post-game callouts), and asking `element.flavor` answered with one of them
 * whichever row the producer had actually clicked — which is how the Character
 * Spotlight's own source ended up wearing a Push button aimed at a container
 * that did not exist.
 *
 * An element with no source of its own (`flavor: 'fed'`) has one possible
 * answer, so it keeps reporting fed even with no roster claiming it: there is
 * genuinely nowhere else for its content to go, and the panel says so rather
 * than offering to bind a source it doesn't have. The registry has no such
 * element today (the Stat Card was the last, and now owns a source), which is
 * exactly why the rule is stated over the placement and not the element: every
 * member's slot row is still fed.
 *
 * `slot` — the container this row is a MEMBER of — is what says which kind of
 * row this is. Not `container`, which a container's OWN row also carries, and
 * not `parent`, which a stored slot id resolves without.
 */
export const placementFlavor = (placement) => (
    placement?.slot ? 'fed' : (placement?.element?.flavor ?? 'direct')
);

export const isFedPlacement = (placement) => placementFlavor(placement) === 'fed';

/*
 * A PRSH source the element registry doesn't know — a roster, a team logo, a
 * player name. Setup has always been able to add these and Production has
 * always been blind to them; now that the Add picker offers the whole layout
 * catalog, being blind to them would mean adding something you then can't find.
 *
 * It gets a row, a chip and the Air slot — everything that needs only the OBS
 * source. It deliberately gets NO preview: the registry is where native
 * dimensions come from, and previewing an unknown layout at a guessed aspect is
 * the exact failure mode the stage preview was rebuilt to avoid.
 */
export function genericElement(url) {
    // PATHNAME, not the whole URL. A source on a dual-machine rig points at the
    // PRSH host by IP, so keying identity on the origin would give the same
    // overlay two ids — and this id is what selection and rail pins persist.
    // Same reason obs-binding.js compares by pathname.
    const path = pathOf(url);
    const file = path.split('/').pop() || 'overlay';
    const stem = file.replace(/\.html?$/i, '');
    return {
        id: `layout:${path}`,
        name: stem.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        flavor: 'direct',
        generic: true,
        url: path,
        match: (u) => pathOf(u) === path,
    };
}

/*
 * A CONTAINER's row, synthesised from its definition.
 *
 * Deliberately not `genericElement`: every container is now rendered by the one
 * generic shell, so keying identity on the pathname would give every container
 * in a scene the same id — duplicate React keys and a panel driving whichever
 * source `find()` reached first, which is the bug the board and variant axes
 * exist to prevent. The container id IS the identity here, and it comes off the
 * URL exactly as the overlay reads it.
 *
 * It also carries the definition's name and native size, so the rack row reads
 * as the producer's own container and the stage can preview it — the two things
 * a generic element cannot supply.
 */
// A container's element id is `container:{id}`. Named because `sourcelessPlacement`
// has to read it back out — a container is not in ELEMENTS, so it is the one
// element id that must be re-synthesised rather than looked up.
export const CONTAINER_PREFIX = 'container:';

export function containerElement(id, def) {
    return {
        id: `${CONTAINER_PREFIX}${id}`,
        name: def?.name || id,
        flavor: 'direct',
        generic: true,
        container: id,
        url: def?.url || `/layout/shared/container.html?container=${id}`,
        width: def?.width,
        height: def?.height,
        match: (u) => containerOfSource(u) === id,
    };
}

/*
 * The members that row under one container — READ OFF THAT CONTAINER'S ROSTER,
 * in the order the producer put them in.
 *
 * Members are NOT discovered from sources the way direct rows are, and the
 * difference is load-bearing: Character Spotlight and Game Summary can share
 * one Callout Stage source, so a source→row scan alone would collapse two
 * elements the producer drives separately into a single row. The container
 * source decides WHICH SCENE they row in, and every member rows there, nested.
 *
 * The roster, not the inverted element→container map (`fedTargets`): that map
 * answers with the FIRST container claiming an element, which is right for "an
 * element's own row" and wrong here. A container-SCOPED member legitimately
 * sits on several rosters — that exception is what makes a mirrored pair
 * buildable — and the inverted read gave the pair's second container an empty
 * roster in the rack while its own panel listed two members.
 *
 * Every member, not just the fed-only ones: one that also owns a dedicated
 * source (the hit visualizer, the two post-game callouts) is on this container
 * for exactly the same reason the others are, and leaving it out meant no row
 * to push it from and nothing saying it was a member at all.
 */
const BY_ID = new Map(CONTAINER_MEMBERS.map(el => [el.id, el]));
const membersOf = (def) => (def?.members ?? []).map(id => BY_ID.get(id)).filter(Boolean);

/*
 * One scene's rows. Order follows OBS's own scene-item order, so the rack reads
 * the way the producer's source list does.
 */
export function placementsInScene({ scene, where, items = [] }, feeds = {}, defs = {}) {
    const out = [];
    for (const item of items) {
        const url = item.url || '';

        // A direct element owns its source outright.
        const direct = DIRECT_ELEMENTS.find(el => el.match(url));
        if (direct) {
            // Every source that NAMES a board carries it — not only the
            // board-scoped elements — or a board-1 and a board-2 Stat Bar on
            // the same side are one id in one scene (see readsBoard).
            const board = readsBoard(direct) ? boardOfUrl(url) : null;
            const variant = variantOf(url);
            const instance = instanceId(direct, board, url);
            out.push({
                id: placementId(instance, scene),
                instance, element: direct, board, variant, scene, where, item,
            });
            continue;
        }

        /*
         * Everything else is a source we row on its own terms: an unregistered
         * PRSH overlay, or a shared CONTAINER.
         *
         * The element is the PATH (one type per layout) and the variant is the
         * instance — which is what keeps team 1's roster and team 2's roster two
         * rows rather than one id serving both. See ./instances.
         */
        const stem = containerOfSource(url);
        const isContainer = !!stem;
        const el = isContainer ? containerElement(stem, defs[stem]) : genericElement(url);
        const variant = variantOf(url);
        const instance = instanceId(el, null, url);
        const id = placementId(instance, scene);
        const children = isContainer ? membersOf(defs[stem]) : [];

        // Which element's content the container is holding right now. Carried on
        // the row rather than re-read per surface, because three of them need
        // it: the fed row's chip, its preview, and the container's own caption.
        const carrying = isContainer ? (feeds[stem]?.element ?? null) : null;

        out.push({
            id, instance, element: el, board: null, variant, scene, where, item,
            container: isContainer ? stem : null,
            feeds: children.map(f => f.id),
            carrying,
        });

        /*
         * A container's fed elements nest UNDER it, and they are mutually
         * exclusive: production.feed.container.{id} holds one value, so exactly
         * one of them can be on the container at a time.
         *
         * They used to be top-level rows and the container had none, which was
         * wrong three ways: two rows shared one scene item so both chips read
         * AIR when at most one could be on screen, either row's eye toggled the
         * other's source, and the container itself appeared as a row only while
         * nothing was aimed at it. Nesting says what is true — one source, and
         * a choice of what occupies it.
         *
         * Fed rows take NEITHER identity axis: the container is board-agnostic
         * by design, and reading a variant off its URL would split one
         * container's pushers into rows that can't both push. What they DO take
         * is the container itself (`slotInstanceId`) — a member's slot and that
         * member's own source are two placements of one element, and the bare
         * id can only name one of them.
         */
        for (const f of children) {
            const slot = slotInstanceId(f.id, stem);
            out.push({
                id: placementId(slot, scene),
                instance: slot, element: f, board: null, variant: '',
                scene, where, item,
                parent: id, container: stem, slot: stem,
                mine: carrying === f.id,
                carrying,
            });
        }
    }
    return out;
}

/*
 * Every scene the console can see, in rack order: program, then the studio
 * preview scene, then everything else in OBS's own list order.
 *
 * `mirrored`/`loading` ride along from the store so a section can tell "this
 * scene is empty" from "nobody has expanded it yet" — the distinction lazy
 * mirroring makes possible and a "no sources here" message must not get wrong.
 */
export function useConsoleScenes() {
    const { scenes, sceneItems, mirroredScenes, programScene, previewScene, studioMode } =
        useObsStore(useShallow(s => ({
            scenes: s.scenes,
            sceneItems: s.sceneItems,
            mirroredScenes: s.mirroredScenes,
            programScene: s.programScene,
            previewScene: s.previewScene,
            studioMode: s.studioMode,
        })));

    return useMemo(() => {
        const roles = { programScene, previewScene, studioMode };
        const seen = new Set();
        const ordered = [];
        const add = (name) => {
            if (!name || seen.has(name)) return;
            seen.add(name);
            ordered.push(name);
        };
        add(programScene);
        if (studioMode) add(previewScene);
        for (const name of scenes) add(name);

        return ordered.map(scene => ({
            scene,
            where: sceneRole(scene, roles),
            items: (sceneItems[scene] || []).filter(i => i.isPrsh),
            mirrored: mirroredScenes.includes(scene),
            loading: mirroredScenes.includes(scene) && !sceneItems[scene],
        }));
    }, [scenes, sceneItems, mirroredScenes, programScene, previewScene, studioMode]);
}

/*
 * ── With no OBS: the CATALOG tier ────────────────────────────────────────
 *
 * Source → row is the right derivation when there is a source to derive from.
 * With OBS closed there is none, and the console used to collapse to three desk
 * rows and an apology — no way to select an element, so no stage, so no way to
 * author a lower third, build a container, set a scorecard's bands or preview
 * any of it. Everything the console does that isn't show/hide became unreachable
 * because of the one thing it can't do.
 *
 * OBS IS THE CONTROL SURFACE, NOT THE CONTENT PIPELINE. Without it PRSH can
 * still author, preview, feed a container and hand out source URLs; what it
 * loses is showing/hiding and knowing what is in a scene. So the rack degrades
 * along exactly that line: it stops mirroring and lists what PRSH can CONFIGURE
 * — every element, plus the producer's containers with their rostered members
 * nested under them, exactly as they nest online.
 *
 * These are the same shape as `sourcelessPlacement` (`item: null`, `scene: null`)
 * because that is what they are: things we know the identity of and not the
 * location. Everything downstream therefore works untouched — `chipFor` reads
 * `—`, the stage opens, the fed radio still writes a feed (a state write needs
 * no OBS), and only the controls that need a scene item stand down.
 *
 * Ids are the PRE-SCENE form (`scoreboard:1`), which is also exactly what a
 * legacy pin looks like — so a selection or a pin made with OBS closed resolves
 * to the real scene copy the moment it opens. Read-time resolution again; no
 * migration, nothing rewritten.
 */
export function catalogPlacements({ defs = {}, boards = [1], feeds = {} } = {}) {
    const targets = fedTargets(defs);
    const out = [];
    const row = (element, board = null, extra = null) => {
        // The variant is part of the IDENTITY, not decoration on it — two sizes
        // of one board's scoreboard are two rows, two selections and two stage
        // panels, exactly as they are once real sources exist.
        const instance = withVariant(instanceId(element, board), extra?.variant ?? '');
        return {
            id: instance, instance, element, board, variant: '',
            scene: null, where: 'none', item: null, ...extra,
        };
    };

    /*
     * A board-scoped element gets one row per board the producer actually runs.
     * This is the one legitimate reader left for the DECLARED board list: with
     * no OBS there is nothing to discover them from, and Settings genuinely
     * knows how many boards the rig has.
     *
     * An element declaring `sizes` or `perSide` gets one row per VARIANT on top
     * of that, because online a variant is read off a source that already
     * exists — so with OBS closed the console could only ever offer the one row
     * a bare URL resolves to. For sizes that meant Copy URL handing over a Large
     * board however small the one you wanted; for sides it meant side 1 of the
     * Roster, the Player Name, the Team Logo and the Controller and no way to
     * reach side 2 at all, which is half of every element that comes in pairs.
     * The tags are the same `t1`/`zs` the online path derives from a URL, so a
     * selection made here still resolves once the source exists.
     */
    for (const el of OFFERED_DIRECT) {
        /*
         * The two axes differ in whether there is a DEFAULT.
         *
         * A size has one: a source with no ?size= is exactly that size, so the
         * default size takes the BARE instance id and the row a producer pinned
         * with OBS closed is the row their source becomes when OBS comes up.
         * Rows come out in DECLARED order (small → medium → large), which is the
         * order a list of sizes should read in now that all three are named.
         *
         * A side has none. `?team=` has a URL default of 1, but the Add picker
         * only ever creates explicit `?team=1` / `?team=2` sources
         * (`_TEAM_VARIANTS`, layouts.py), so both real rows carry a tag and a
         * bare `roster` row would resolve to neither of them. Emitting `t1` and
         * `t2` is what makes the offline pin land on the source the producer
         * later adds.
         *
         * Composed side-before-size to match VARIANT_PARAMS order, so a catalog
         * id is the same string `variantOf` derives from the real URL. Nothing
         * shipped declares both today; getting the order right costs a line and
         * a wrong one would be a silent mismatch at the moment something does.
         */
        const sides = el.perSide ? [1, 2].map(n => variantTagFor('team', n)) : [''];
        const sizes = (el.sizes ?? []).length
            ? el.sizes.map(z => (z.default ? '' : variantTagFor('size', z.value)))
            : [''];
        const variants = sides.flatMap(t => sizes.map(z => [t, z].filter(Boolean).join('.')));
        const forBoard = (b) => variants.forEach(v => out.push(row(el, b, { variant: v })));
        if (el.scope === 'board') for (const b of boards) forBoard(b);
        else forBoard(null);
    }

    for (const def of Object.values(defs).sort((a, b) => a.name.localeCompare(b.name))) {
        const children = membersOf(def);
        const carrying = feeds[def.id]?.element ?? null;
        const parent = row(containerElement(def.id, def), null, {
            container: def.id, feeds: children.map(f => f.id), carrying,
        });
        out.push(parent);
        // Slot ids, exactly as online — a member's slot and its own source are
        // two rows of one element, and a catalog id has to be the same string
        // the scene copy will be or a pin made offline opens the other one.
        for (const f of children) {
            const slot = slotInstanceId(f.id, def.id);
            out.push({
                ...row(f, null, {
                    parent: parent.id, container: def.id, slot: def.id,
                    mine: carrying === f.id, carrying,
                }),
                id: slot, instance: slot,
            });
        }
    }

    // A fed-only element no roster claims rows at the TOP level rather than not
    // at all. Online it has no container source to nest under and simply
    // doesn't appear; here, being unreachable is the problem — its stage is
    // where the producer finds out it needs a container and which one to add it
    // to. A member that owns a source has already rowed above, from
    // DIRECT_ELEMENTS, which is the whole point of it owning one.
    for (const f of OFFERED_FED) if (!targets[f.id]) out.push(row(f));

    return out;
}

/*
 * Whether the console is running without OBS.
 *
 * `connecting` deliberately does NOT count: scenes are empty then too, and
 * swapping the rack to the catalog for the third of a second before the mirror
 * lands would read as a glitch. The rack says "Connecting…" instead.
 *
 * That only holds because a BACKGROUND reconnect never publishes 'connecting'
 * (see obs.jsx `connect`). When it did, the reconnect timer's 30s retry against
 * a closed OBS flipped this false→true on every attempt, blanking the console
 * for the second the refused handshake took.
 */
export function useConsoleOffline() {
    const status = useObsStore(s => s.status);
    return status === 'disconnected' || status === 'error';
}

// Every placement across every scene the console can see. One derivation, so
// the rack, the stage and the rail cannot disagree about what exists.
export function useConsolePlacements(consoleScenes) {
    const defs = useContainerDefs();
    // What each container is currently CARRYING — the second half of a fed
    // element's chip, since being on air takes both the container being up and
    // the container holding this element's content.
    const feeds = useStateStore(useShallow(s => s?.production?.feed?.container ?? {}));
    const boards = useActiveBoards();
    const offline = useConsoleOffline();
    return useMemo(() => {
        if (offline) return catalogPlacements({ defs, boards, feeds });
        return consoleScenes.flatMap(sc => placementsInScene(sc, feeds, defs));
    }, [consoleScenes, defs, feeds, boards, offline]);
}

/*
 * How a placement names itself in the rack, on the stage and on a rail card:
 * the element's name, plus the DETAIL that tells it from its siblings — the
 * board alias, the variant ("Team 2", "Small"), or both.
 *
 * The detail appears only when the element has more than one INSTANCE —
 * counted distinctly, not per placement. One board's scoreboard sitting in three
 * scenes is still one thing to tell apart from nothing, and suffixing all three
 * would be the board mechanism charging rent it isn't paying. The scene is not
 * in the name either: the section header above the row already says it.
 *
 * The two axes are counted SEPARATELY, because they answer separate questions.
 * A single-board rig offering three scoreboard sizes has three instances, and a
 * shared "more than one" flag then printed the board on every row — "Scoreboard ·
 * Scoreboard 1" three times over, where the board was never in doubt and the
 * size was the only thing telling them apart. Each half of the detail now earns
 * its own place.
 *
 * A board with no alias contributes a NUMBER, not a name (`boardTag`). The
 * default alias is "Scoreboard {N}", so on a rig with three boards every
 * scoreboard row read "Scoreboard · Scoreboard 1 · Medium" — the word twice, in
 * a ~278px row, and the half that repeated the element carried nothing. An
 * aliased board keeps its alias, because the producer chose it to mean something.
 */
export function usePlacementLabel(placements) {
    const boardTag = useBoardTag();
    // The `?team=` variant reads in the producer's side vocabulary, so the row
    // and the panel it opens name the same source the same way (../sides).
    const { mode } = useSideLabels();
    return useMemo(() => {
        const axes = new Map();
        for (const p of placements) {
            if (!axes.has(p.element.id)) {
                axes.set(p.element.id, { boards: new Set(), variants: new Set() });
            }
            const a = axes.get(p.element.id);
            a.boards.add(p.board);
            a.variants.add(p.variant || '');
        }
        return (p) => {
            const a = axes.get(p.element.id);
            /*
             * A PER-SIDE ELEMENT ALWAYS NAMES ITS SIDE, however many of it are
             * placed. The `size > 1` rule is right for a size variant, which has
             * a default row and only needs disambiguating against a sibling —
             * and wrong for `?team=`, where there IS no default and the element's
             * name is a position it cannot supply on its own ("Player Name" says
             * nothing about which player). A producer with only side 1 in their
             * scenes got a row and a panel titled "Player Name", which is the
             * one title that element must never carry.
             *
             * It also settles the subject beside it (../subject `SideSubject`):
             * that row spends its one line on the NAME precisely because the
             * title is guaranteed to carry the side.
             */
            const detail = [
                a?.boards.size > 1 && p.board != null ? boardTag(p.board) : null,
                (a?.variants.size > 1 || p.element.perSide)
                    ? variantLabelFor(p.element, p.variant, mode) : null,
            ].filter(Boolean).join(' · ');
            return { name: p.element.name, detail: detail || null };
        };
    }, [placements, boardTag, mode]);
}

/*
 * THE OTHER HALF OF A PAIR — this placement's own element, in the same scene,
 * wearing the other `?team=` (on the same board when there is one).
 *
 * Derived from the SAME placement list every other surface reads, rather than
 * scanning OBS for a URL: a sibling found any other way is a source the rack
 * may not have a row for, and the console's whole claim is that one derivation
 * decides what exists.
 *
 * All four coordinates have to match, and the scene is the one worth stating.
 * A pair is placed per scene — side 1 and side 2 sit at their own sizes in
 * Game and at different ones in Break — so "the other side" means the copy in
 * THIS scene. Reaching across scenes would offer to size a source against one
 * the producer isn't looking at.
 *
 * The BOARD is a preference, not a coordinate. It used to be the fourth, which
 * was harmless while a source's board was fixed at Add time and stopped being
 * so the day the stage's Board row could re-point one half: a Roster with side
 * 1 moved to board 2 and side 2 left on board 1 lost its Size row, although
 * nothing about the two boxes in OBS had changed — a size is geometry, and
 * which board a source READS has nothing to do with it. So the same board wins
 * where there is one (a rig with a board-1 and a board-2 pair in one scene
 * matches within its own pair), and otherwise the lowest-numbered board's other
 * half answers; the row names that board, so a cross-board match is never a
 * surprise.
 *
 * A FED row is excluded on purpose. A member's row commands the CONTAINER's
 * source (see placementFlavor), which is shared with every other member and
 * sized as the container — resizing it there would be a panel quietly editing
 * something that isn't its own. The same element's dedicated source, one row
 * over, is where its size lives.
 */
export function sideSibling(placement, placements = []) {
    if (!placement?.item || !placement.scene || isFedPlacement(placement)) return null;
    const other = flipSideVariant(placement.variant);
    if (!other) return null;
    const halves = placements.filter(p => (
        p.scene === placement.scene
        && sidePairVariant(p.variant) === other
        && p.element?.id === placement.element?.id
        && p.item
        && p.item.id !== placement.item.id
        && !isFedPlacement(p)
    ));
    return halves.find(p => p.board === placement.board)
        ?? [...halves].sort((a, b) => (a.board ?? 0) - (b.board ?? 0))[0]
        ?? null;
}

/*
 * A placement for something with NO source anywhere — the selection's last
 * resort, and the one case the rack deliberately does not have a row for.
 *
 * The rack lists only what is really in a scene, which is right for a monitor
 * but would otherwise mean a producer with OBS closed (or not yet running)
 * cannot open a panel at all — and several stage bodies write STATE, not OBS.
 * Authoring a lower third or a caster list the night before is a real workflow
 * and has nothing to do with whether a browser source exists yet. So a stored
 * selection or pin still opens its panel: chip '—', the strip offering Bind,
 * and every control that doesn't need a source working normally.
 *
 * It is keyed in the pre-scene form, because that is exactly what it is: a
 * thing we know the identity of and not the location.
 */
export function sourcelessPlacement(id, defs = null) {
    const { instance } = parsePlacementId(id);
    const { elementId, board, variant, slot } = parseInstanceId(instance);
    /*
     * A CONTAINER is not in ELEMENTS — its element is synthesised from the
     * definition — so an id naming one found nothing here and the panel never
     * opened. That inverted the rule this function exists for: a container's own
     * stage is the ONLY place its roster, resting occupant, scope and automation
     * rules can be edited, and none of that needs a source. Deleting the browser
     * source (or opening the console before its scene is mirrored) therefore made
     * the container unreachable — while closing OBS entirely brought it back,
     * because the catalog tier synthesises the same row.
     *
     * `defs` is optional: without it the row still works, it just falls back to
     * the id for its name and has no native size to preview at.
     */
    if (elementId?.startsWith(CONTAINER_PREFIX)) {
        const cid = elementId.slice(CONTAINER_PREFIX.length);
        const element = containerElement(cid, defs?.[cid]);
        return {
            id: element.id, instance: element.id, element,
            board: null, variant: '', container: cid,
            scene: null, where: 'none', item: null,
        };
    }
    const element = ELEMENTS.find(e => e.id === elementId);
    if (!element) return null;
    const b = element.scope === 'board' ? (board ?? 1) : null;
    // The variant is carried through rather than re-derived: there is no source
    // to read it off, and dropping it would answer a selection that said "team
    // 2" with a panel pointed at team 1. Same for the SLOT: an id naming a
    // member's place on a container means that slot even when the container's
    // source has gone, and answering with the element's own source would hand
    // the producer a panel for the other half of a two-row element.
    const key = slot
        ? slotInstanceId(element.id, slot)
        : withVariant(instanceId(element, b), variant);
    return {
        id: key, instance: key, element, board: slot ? null : b,
        variant: slot ? '' : (variant ?? ''),
        slot: slot ?? undefined, container: slot ?? undefined,
        scene: null, where: 'none', item: null,
    };
}

/*
 * What a stored id means TODAY — the same read-time resolution instances use,
 * extended along the scene axis (./instances explains why this is resolved and
 * never rewritten).
 *
 * Five cases collapse to "the best placement of the thing you named":
 *
 *   'scoreboard:2@Break'  still there                → itself
 *   'scoreboard:2@Gone'   that scene is gone         → scoreboard:2 wherever it is
 *   'scoreboard@Break'    pinned before instances    → the BREAK copy, not the air one
 *   'scoreboard'          pinned before scenes       → the copy nearest air
 *   anything with no source at all                   → a sourceless panel
 *
 * "Best" is program → preview → anywhere, because that is the copy a producer
 * asking for "the scoreboard" means: the one currently reaching air. But a
 * named scene outranks that — an id that says Break means Break.
 */
const ROLE_RANK = { program: 0, preview: 1, other: 2, none: 3 };

export function resolvePlacement(id, placements, defs = null) {
    if (!id) return null;
    const exact = placements.find(p => p.id === id);
    if (exact) return exact;

    const { instance, scene } = parsePlacementId(id);
    if (!instance) return null;
    const { elementId } = parseInstanceId(instance);

    // Narrow as far as the id still describes something real: this exact
    // instance if it exists, else any placement of the element (which is what
    // rescues a pre-instance id like 'scoreboard').
    const byInstance = placements.filter(p => p.instance === instance);
    const pool = byInstance.length
        ? byInstance
        : placements.filter(p => p.element.id === elementId);
    if (!pool.length) return sourcelessPlacement(id, defs);

    // A named scene still counts even when the instance half has gone stale —
    // 'scoreboard@Break' means the Break copy, and answering with the program
    // one would hand the producer a card that flies the wrong scene.
    const inScene = scene ? pool.filter(p => p.scene === scene) : [];
    const scoped = inScene.length ? inScene : pool;
    // Then the same VARIANT: a stale id that said side 2 still means side 2.
    // Without this a `statsbar~t2` pin written before board-reading sources
    // carried their board resolved to whichever side OBS listed first.
    const wanted = parseInstanceId(instance).variant ?? '';
    const sameVariant = scoped.filter(p => (p.variant || '') === wanted);
    const candidates = sameVariant.length ? sameVariant : scoped;
    return candidates.slice()
        .sort((a, b) => (ROLE_RANK[a.where] ?? 9) - (ROLE_RANK[b.where] ?? 9)
            /*
             * Then the CANONICAL instance — the variant-less one. An id like
             * 'scoreboard' means the element's default size, and this used to be
             * true only because catalogPlacements emitted that row first, which
             * made list ORDER carry resolution meaning: the catalog had to list
             * Large, Small, Medium to keep a bare pin working. Saying it here
             * frees the list to read in the order the sizes are declared.
             */
            || (a.variant ? 1 : 0) - (b.variant ? 1 : 0))[0] ?? null;
}

// What a stored pin currently POINTS AT — its resolved placement id, or the pin
// itself for anything placements don't own (desk ids, a source since deleted).
export const placementTarget = (pin, placements) =>
    resolvePlacement(pin, placements)?.id ?? pin;

/*
 * Pin/unpin by placement id, against pins that may still be stored in any older
 * form. Comparing by TARGET rather than by stored string is what stops a legacy
 * `scoreboard` pin and a freshly written `scoreboard:1@Game` from sitting on the
 * rail as two cards for one source; new pins are written canonical, so a rail
 * converges as it is used rather than needing a rewrite pass.
 *
 * BOTH SIDES ARE RESOLVED, because the callers hand over different forms: the
 * rack passes the row's placement id, but the rail's ◆ passes the pin AS STORED
 * — and a stored legacy `scoreboard` resolves to `scoreboard:1@Game`, never to
 * itself, so comparing targets against the raw id found no match and APPENDED
 * a second copy. Unpinning from the rail duplicated the card it meant to remove.
 */
export function togglePin(pins, id, placements) {
    const cur = pins ?? [];
    const target = placementTarget(id, placements);
    return cur.some(p => placementTarget(p, placements) === target)
        ? cur.filter(p => placementTarget(p, placements) !== target)
        : [...cur, target];
}

/*
 * ── IS OBS SCALING THIS PLACEMENT'S SOURCE — the factor, or null ────────────
 *
 * The verdict itself is mirrored on the scene item (`mapItem`, ../../context/
 * obs.jsx). This is the question of WHICH ROWS ARE ENTITLED TO SAY SO, and it
 * lives here rather than in either surface because the rack badge and the stage
 * row must not be able to disagree about it.
 *
 * ONLY THE PLAYER NAME, for now, and not out of caution — the other elements
 * genuinely have less to complain about. Every one of them fits its artwork to
 * whatever viewport it is handed, so a scaled item costs them sharpness and
 * nothing else, and a warning on all of them would put an amber badge on most
 * of a producer's rack for a fidelity note. The Player Name is the one element
 * that draws at an ABSOLUTE size: `nameSize` is a number the producer typed, so
 * a half-scale item is drawing 24px type from a 48px setting, and the setting
 * and the broadcast disagree with nothing anywhere to say why. That is a
 * correctness fault, not a quality one, and it is what earns the row.
 *
 * The gate is on the ELEMENT, so widening it later is this list growing — and
 * the day another element takes a fixed size, it belongs in it.
 *
 * A FED row is excluded on top of that: the source being scaled is the
 * container's, and the container has its own row above it. Warning on both
 * would double every count and point half of them at a panel with no fix.
 */
const SCALE_SENSITIVE = new Set(['playername']);

export function stretchOfPlacement(p) {
    if (!isScaleSensitive(p)) return null;
    return p.item?.stretch ?? null;
}

/*
 * The same gate as a question rather than a reading, for the THIRD surface that
 * needs it: matching a pair's size (../../../lib/obs-transform, `sameInputSize`).
 *
 * A stretch warning and a size match are the two halves of one fact — that this
 * element's drawn size and its render resolution are different numbers and both
 * matter — so they read the same list. Asked through a function because
 * `stretchOfPlacement` answers null both for an element that is not sensitive
 * and for a sensitive one that is drawn 1:1, and the size match needs those
 * apart: the second still has both sizes to copy.
 */
export function isScaleSensitive(p) {
    return !!p && !isFedPlacement(p) && SCALE_SENSITIVE.has(p.element?.id);
}

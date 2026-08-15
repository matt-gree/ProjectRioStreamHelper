import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useObsStore } from '../../context/obs';
import { useStateStore } from '../../context/store';
import { boardOfUrl } from '../../lib/obs-binding';
import { ELEMENTS } from './elements';
import {
    CONTAINER_MEMBERS, containerOfSource, fedTargets, useContainerDefs,
} from './containers';
import {
    instanceId, parseInstanceId, slotInstanceId, variantLabelFor, variantOf, variantTagFor,
    withVariant,
} from './instances';
import { useActiveBoards, useBoardTag } from './boards';

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
 * than offering to bind a source it doesn't have.
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
export function containerElement(id, def) {
    return {
        id: `container:${id}`,
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
            const board = direct.scope === 'board' ? boardOfUrl(url) : null;
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
     * An element declaring `sizes` gets one row per SIZE on top of that, because
     * online the size is read off a source that already exists — so with OBS
     * closed the console could only ever offer the default canvas, and Copy URL
     * handed over a Large board however small the one you wanted. The variant
     * tag is the same `zs`/`zm`/`zl` the online path derives from a URL, so a
     * selection made here still resolves once the source exists.
     */
    for (const el of DIRECT_ELEMENTS) {
        /*
         * The default size gets the BARE instance id, because a source with no
         * ?size= is exactly that size — so the row a producer pinned with OBS
         * closed is the row their source becomes when OBS comes up.
         *
         * Rows come out in DECLARED order (small → medium → large), because that
         * is the order a list of sizes should read in now that all three are
         * named — the default one used to print no label, so its position looked
         * arbitrary rather than wrong. It used to be hoisted to the front so a
         * bare pin ('scoreboard') resolved to it; `resolvePlacement` prefers the
         * canonical instance outright now, so order no longer carries that.
         */
        const variants = (el.sizes ?? [])
            .map(s => (s.default ? '' : variantTagFor('size', s.value)));
        const forBoard = (b) => (variants.length
            ? variants.forEach(v => out.push(row(el, b, { variant: v })))
            : out.push(row(el, b)));
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
    for (const f of FED_ELEMENTS) if (!targets[f.id]) out.push(row(f));

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
            const detail = [
                a?.boards.size > 1 && p.board != null ? boardTag(p.board) : null,
                a?.variants.size > 1 ? variantLabelFor(p.element, p.variant) : null,
            ].filter(Boolean).join(' · ');
            return { name: p.element.name, detail: detail || null };
        };
    }, [placements, boardTag]);
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
export function sourcelessPlacement(id) {
    const { instance } = parsePlacementId(id);
    const { elementId, board, variant, slot } = parseInstanceId(instance);
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

export function resolvePlacement(id, placements) {
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
    if (!pool.length) return sourcelessPlacement(id);

    // A named scene still counts even when the instance half has gone stale —
    // 'scoreboard@Break' means the Break copy, and answering with the program
    // one would hand the producer a card that flies the wrong scene.
    const inScene = scene ? pool.filter(p => p.scene === scene) : [];
    const candidates = inScene.length ? inScene : pool;
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
 */
export function togglePin(pins, id, placements) {
    const cur = pins ?? [];
    return cur.some(p => placementTarget(p, placements) === id)
        ? cur.filter(p => placementTarget(p, placements) !== id)
        : [...cur, id];
}

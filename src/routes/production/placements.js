import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useObsStore } from '../../context/obs';
import { useSettingsStore, useStateStore } from '../../context/store';
import { boardOfUrl } from '../../lib/obs-binding';
import { containerId, defaultContainerFor, ELEMENTS } from './elements';
import { instanceId, parseInstanceId, variantLabel, variantOf, withVariant } from './instances';
import { useBoardLabel } from './boards';

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
 * A PRSH source the element registry doesn't know — a roster, a team logo, a
 * fourcam frame. Setup has always been able to add these and Production has
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
 * Which named container each fed element is currently pointed at. Fed elements
 * are NOT discovered from sources the way direct ones are, and the difference is
 * load-bearing: Character Spotlight and Game Summary share one Callout Stage
 * source, so a source→row scan alone would collapse two elements the producer
 * drives separately into a single row. Instead the container source decides
 * WHICH SCENE they row in, and both row there — nested under it.
 */
export function fedTargets(containers = {}) {
    const out = {};
    for (const el of FED_ELEMENTS) out[el.id] = containers[el.id] || defaultContainerFor(el);
    return out;
}

// Shared containers live in one folder, and that is what makes a source a
// container rather than an overlay that happens to be unregistered.
const SHARED_PATH = /\/layout\/shared\//i;

/*
 * One scene's rows. Order follows OBS's own scene-item order, so the rack reads
 * the way the producer's source list does.
 */
export function placementsInScene({ scene, where, items = [] }, targets = {}, feeds = {}) {
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
        const el = genericElement(url);
        const variant = variantOf(url);
        const instance = instanceId(el, null, url);
        const id = placementId(instance, scene);
        const stem = containerId(url);
        const isContainer = SHARED_PATH.test(pathOf(url));
        const children = isContainer
            ? FED_ELEMENTS.filter(f => targets[f.id] === stem)
            : [];

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
         * container's pushers into rows that can't both push.
         */
        for (const f of children) {
            out.push({
                id: placementId(f.id, scene),
                instance: f.id, element: f, board: null, variant: '',
                scene, where, item,
                parent: id, container: stem,
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

// Every placement across every scene the console can see. One derivation, so
// the rack, the stage and the rail cannot disagree about what exists.
export function useConsolePlacements(consoleScenes) {
    const containers = useSettingsStore(useShallow(s => s?.production?.containers ?? {}));
    // What each container is currently CARRYING — the second half of a fed
    // element's chip, since being on air takes both the container being up and
    // the container holding this element's content.
    const feeds = useStateStore(useShallow(s => s?.production?.feed?.container ?? {}));
    return useMemo(() => {
        const targets = fedTargets(containers);
        return consoleScenes.flatMap(sc => placementsInScene(sc, targets, feeds));
    }, [consoleScenes, containers, feeds]);
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
 */
export function usePlacementLabel(placements) {
    const boardLabel = useBoardLabel();
    return useMemo(() => {
        const instances = new Map();
        for (const p of placements) {
            if (!instances.has(p.element.id)) instances.set(p.element.id, new Set());
            instances.get(p.element.id).add(p.instance);
        }
        return (p) => {
            const many = (instances.get(p.element.id)?.size ?? 0) > 1;
            const detail = many
                ? [p.board != null ? boardLabel(p.board) : null, variantLabel(p.variant)]
                    .filter(Boolean).join(' · ')
                : '';
            return { name: p.element.name, detail: detail || null };
        };
    }, [placements, boardLabel]);
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
    const { elementId, board, variant } = parseInstanceId(instance);
    const element = ELEMENTS.find(e => e.id === elementId);
    if (!element) return null;
    const b = element.scope === 'board' ? (board ?? 1) : null;
    // The variant is carried through rather than re-derived: there is no source
    // to read it off, and dropping it would answer a selection that said "team
    // 2" with a panel pointed at team 1.
    const key = withVariant(instanceId(element, b), variant);
    return {
        id: key, instance: key, element, board: b, variant: variant ?? '',
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
const ROLE_RANK = { program: 0, preview: 1, other: 2 };

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
        .sort((a, b) => ROLE_RANK[a.where] - ROLE_RANK[b.where])[0] ?? null;
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

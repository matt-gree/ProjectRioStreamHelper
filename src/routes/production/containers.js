import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, useStateStore } from '../../context/store';
import { stageOrRun } from '../../context/staging';
import { containerId, ELEMENTS } from './elements';

/*
 * Shared containers — producer-built.
 *
 * A container is ONE OBS browser source that hosts whichever of its MEMBERS the
 * producer feeds it. It is not a file: `settings.production.container_defs.{id}`
 * carries its display name, its native size and its member roster, and one
 * generic shell (`/layout/shared/container.html?container={id}`) renders any of
 * them. The catalog reports a row per definition, so a container the producer
 * built is added from the Add picker like anything else.
 *
 * MEMBERSHIP LIVES ON THE CONTAINER, AND IT IS EXCLUSIVE. It used to be stored
 * per element (`production.containers.{elementId}` → container id) with the
 * element's own layout stem as an implicit default, which meant one relationship
 * had two homes and a default that no UI ever wrote — the shape these drift
 * apart in. The roster IS the target now: an element is fed into the container
 * whose roster names it, and adding it to a second one removes it from the
 * first, because `production.feed.container.{id}` holds exactly one occupant
 * and two containers claiming one element could never both be honoured.
 *
 * The known loss is "the same element in two differently-sized containers per
 * scene". The escape hatch is that one container source sits in as many scenes
 * as the producer likes; if two sizes are genuinely wanted, that is two
 * containers and a re-point.
 */

export const CONTAINER_DEFS_KEY = 'production.container_defs';

// The generic shell, told which definition to be. One builder, so the catalog
// row, the Add picker and any preview all name a container the same way.
export const containerUrl = (id) => `/layout/shared/container.html?container=${encodeURIComponent(id)}`;

/*
 * A source's container id, or null if the source isn't a container.
 *
 * Living in one folder is what makes a source a container — `containerId` alone
 * would happily reduce a scoreboard's URL to the stem "scoreboard" and hand it
 * back as a container id the moment somebody named a container that.
 */
const SHARED_PATH = /\/layout\/shared\//i;
export const containerOfSource = (url) => (SHARED_PATH.test(url || '') ? containerId(url) : null);

/*
 * What a container can hold.
 *
 * Every `fed` element, by definition — a container is the only place its
 * content can go. Plus the elements that declare `containerHostable`: the hit
 * visualizer owns a dedicated source AND can be fed into a container ("Split
 * feed" on its stage), so being hostable is not the same question as flavor,
 * and a roster is a list of MEMBERS rather than a list of fed elements.
 *
 * This is the console's half of a fact `fed-container.js` also holds — the
 * mounts it can actually stand up. `containers.test.js` pins the two together
 * until the mount registry makes them one list.
 */
export const CONTAINER_MEMBERS = ELEMENTS.filter(
    el => el.flavor === 'fed' || el.containerHostable,
);

/*
 * Does this element fit a container of this size? Same size or smaller.
 *
 * There is no scaling system — OBS does placement — so a member larger than its
 * container is unrepresentable rather than handled, and the member picker is
 * filtered to what fits. A SMALLER member centers, which is safe for exactly
 * the reason scaling was not: no aspect math, no resampling, no blur.
 */
export const fitsContainer = (el, width, height) =>
    !!el && el.width <= width && el.height <= height;

/*
 * The sizes a new container can be, from the census of what can go in one —
 * derived, never a table of invented presets. Each distinct member size is a
 * class, and it carries the members that fit it so the creation flow can say
 * what the choice buys ("1920 × 1080 — Character Spotlight, Game Summary").
 * Largest first: the full canvas is the common case.
 */
export function containerSizeClasses(members = CONTAINER_MEMBERS) {
    const seen = new Map();
    for (const el of members) {
        if (!el.width || !el.height) continue;
        const key = `${el.width}x${el.height}`;
        if (!seen.has(key)) seen.set(key, { id: key, width: el.width, height: el.height });
    }
    return [...seen.values()]
        .map(c => ({ ...c, members: members.filter(el => fitsContainer(el, c.width, c.height)) }))
        .sort((a, b) => (b.width * b.height) - (a.width * a.height));
}

// Normalise one stored definition. Settings are user-editable JSON, so a
// malformed entry must degrade to something the console can still render
// rather than throw inside a selector.
function normalizeDef(id, raw) {
    if (!raw || typeof raw !== 'object') return null;
    const width = Number(raw.width) || 0;
    const height = Number(raw.height) || 0;
    return {
        id,
        name: raw.name || id,
        width,
        height,
        members: Array.isArray(raw.members) ? raw.members.filter(m => typeof m === 'string') : [],
        url: containerUrl(id),
    };
}

const EMPTY_DEFS = Object.freeze({});

// Every container definition, as an id → def map. One selector, so the rack,
// the stage, the Add picker and the feed hooks read one answer.
export function useContainerDefs() {
    const raw = useSettingsStore(useShallow(s => s?.production?.container_defs ?? EMPTY_DEFS));
    return useMemo(() => {
        const out = {};
        for (const [id, d] of Object.entries(raw)) {
            const def = normalizeDef(id, d);
            if (def) out[id] = def;
        }
        return out;
    }, [raw]);
}

// The same, as a list in display order. Named for what it has always been
// called at the call sites: the containers an element can be fed into.
export function useSharedContainers() {
    const defs = useContainerDefs();
    return useMemo(
        () => Object.values(defs).sort((a, b) => a.name.localeCompare(b.name)),
        [defs],
    );
}

/*
 * Which container hosts this element — the roster read backwards.
 *
 * Exclusivity is enforced on write, so a well-formed settings file has at most
 * one match; taking the first keeps a hand-edited one deterministic rather than
 * letting two rosters fight per render.
 */
export function hostOf(defs, elementId) {
    for (const def of Object.values(defs || {})) {
        if (def?.members?.includes(elementId)) return def.id;
    }
    return null;
}

// Element id → its container id, for every fed element. The rack's nesting and
// the feed hooks read this one derivation.
export function fedTargets(defs) {
    const out = {};
    for (const el of CONTAINER_MEMBERS) {
        const host = hostOf(defs, el.id);
        if (host) out[el.id] = host;
    }
    return out;
}

/*
 * The container this element is fed into, or null when no roster names it.
 *
 * Null is a real state, not an error: a producer who has not put an element on
 * any container has nowhere to push it, and every surface says so rather than
 * inventing a default. That default is precisely what the old per-element model
 * had, and it is why membership could look configured when nothing had been
 * configured.
 */
export function useContainerOf(element) {
    const defs = useContainerDefs();
    const id = element?.id;
    return useMemo(() => {
        const container = id ? hostOf(defs, id) : null;
        return { container, def: container ? defs[container] : null };
    }, [defs, id]);
}

// Release whatever a container is carrying. Broadcast-visible, so it goes
// through the staging gateway like any other feed write.
function releaseFeed(container, elementId = null) {
    const key = `production.feed.container.${container}`;
    const live = useStateStore.getState()?.production?.feed?.container?.[container];
    if (!live) return;
    if (elementId && live.element !== elementId) return;
    stageOrRun({
        key: `feed:${container}`,
        label: `Clear ${container} feed`,
        value: null,
        run: () => useStateStore.getState().deleteItems([key]),
    });
}

// Write the whole map back. Definitions are config — immediate, never staged —
// but any feed a write orphans is on screen, so that part stages.
function writeDefs(next) {
    useSettingsStore.getState().setItem(CONTAINER_DEFS_KEY, next);
}

function rawDefs() {
    return useSettingsStore.getState()?.production?.container_defs || {};
}

/*
 * A new container's id: a slug of its name, uniquified.
 *
 * It ends up in a URL (`?container=`) and in a state key
 * (`production.feed.container.{id}`), so it is restricted to what is safe in
 * both, and it never changes afterwards — renaming edits `name`, which is the
 * only thing any surface displays.
 */
export function containerIdFor(name, taken = {}) {
    const slug = (name || '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    /*
     * Never all digits. A container's row id is `container:{id}`, and
     * `parseInstanceId` reads a colon followed by DIGITS as the board suffix —
     * so a container named "2" would parse as the element `container` on board
     * 2. Same reason the instance grammar forbids a numeric desk name.
     */
    const base = !slug ? 'container' : (/^\d+$/.test(slug) ? `c-${slug}` : slug);
    if (!(base in taken)) return base;
    for (let n = 2; ; n += 1) {
        const candidate = `${base}-${n}`;
        if (!(candidate in taken)) return candidate;
    }
}

// The container mutations, as one hook so every surface edits rosters the same
// way — and so exclusivity is enforced in exactly one place.
export function useContainerActions() {
    const create = useCallback((name, width, height, members = []) => {
        const defs = rawDefs();
        const id = containerIdFor(name, defs);
        const next = { ...defs };
        // A new container claiming a member takes it off whatever held it.
        for (const [otherId, other] of Object.entries(next)) {
            const kept = (other?.members || []).filter(m => !members.includes(m));
            if (kept.length !== (other?.members || []).length) {
                next[otherId] = { ...other, members: kept };
                releaseFeed(otherId);
            }
        }
        next[id] = { name: name || id, width, height, members: [...members] };
        writeDefs(next);
        return id;
    }, []);

    const rename = useCallback((id, name) => {
        const defs = rawDefs();
        if (!defs[id]) return;
        writeDefs({ ...defs, [id]: { ...defs[id], name: name || id } });
    }, []);

    const remove = useCallback((id) => {
        const defs = rawDefs();
        if (!defs[id]) return;
        const next = { ...defs };
        delete next[id];
        releaseFeed(id);
        writeDefs(next);
    }, []);

    /*
     * Put an element on a container's roster, or take it off.
     *
     * Adding is a MOVE: the element comes off any other roster first, because a
     * container holds one occupant and an element that two containers both claim
     * could only ever occupy one of them. Removing releases the feed if this
     * element is what the container is currently carrying — leaving it up would
     * strand content on air that nothing can then clear.
     */
    const setMember = useCallback((id, elementId, on) => {
        const defs = rawDefs();
        if (!defs[id]) return;
        const next = { ...defs };
        if (on) {
            for (const [otherId, other] of Object.entries(next)) {
                if (otherId === id) continue;
                if (!(other?.members || []).includes(elementId)) continue;
                next[otherId] = {
                    ...other,
                    members: other.members.filter(m => m !== elementId),
                };
                releaseFeed(otherId, elementId);
            }
            const members = defs[id].members || [];
            if (!members.includes(elementId)) {
                next[id] = { ...defs[id], members: [...members, elementId] };
            }
        } else {
            next[id] = {
                ...defs[id],
                members: (defs[id].members || []).filter(m => m !== elementId),
            };
            releaseFeed(id, elementId);
        }
        writeDefs(next);
    }, []);

    return { create, rename, remove, setMember };
}

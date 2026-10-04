/*
 * LOOKS — named variations of one element's settings.
 *
 *   overlays.{type}.looks.{id} = { name, values: { key: value, … } }
 *
 * Each element keeps its own list; Main is the element's ordinary settings and
 * is never stored as a look. A look holds ONLY what differs from Main, so
 * anything it leaves alone follows Main as Main changes.
 *
 * A SOURCE picks its look with `?look={id}` on its URL (absent = Main), the way
 * `?size=` and `?layout=` pick a canvas — so two scenes can carry the same
 * element in two looks. A container picks one per member on its definition
 * (`production.container_defs.{id}.looks.{member}`), because a member has no
 * URL of its own.
 *
 * How a look is APPLIED lives in overlay-base.js (`projectLooks`), which is a
 * classic script and cannot import this module; this is the pure half the
 * console shares with the overlays. Pure and dependency-free, like
 * side-styles.js.
 */

export const LOOK_PARAM = 'look';
export const MAIN_LOOK = null;

// The settings path of one element's looks, and of one look's values.
export const looksKey = (type) => `overlays.${type}.looks`;
export const lookKey = (type, id) => `${looksKey(type)}.${id}`;
export const lookValuesNs = (type, id) => `${type}.looks.${id}.values`;

/*
 * A new look's id. Unique across EVERY element, not just this one: a container
 * page applies several looks at once (one per member) and each must land on the
 * one element that owns it. Lowercase alphanumerics only, because the id rides
 * in a placement id (`~k{id}`), where `.`, `~`, `@` and `+` are separators.
 */
export function newLookId(taken = []) {
    const used = new Set(taken);
    for (;;) {
        const id = `k${Math.random().toString(36).slice(2, 8)}`;
        if (!used.has(id)) return id;
    }
}

// The look a source URL names, or null for Main.
export function lookOfUrl(url) {
    try {
        return new URL(url || '', 'http://x').searchParams.get(LOOK_PARAM) || null;
    } catch {
        return null;
    }
}

// The URL with its look set (null = Main, which drops the param), every other
// param kept and in place.
export function urlWithLook(url, id) {
    let u;
    try { u = new URL(url || '', 'http://x'); } catch { return url; }
    if (id) u.searchParams.set(LOOK_PARAM, id);
    else u.searchParams.delete(LOOK_PARAM);
    const abs = /^[a-z]+:\/\//i.test(url || '');
    return abs ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
}

// One element's looks as a list, in the order they were made.
export function looksOf(overlays, type) {
    const bag = overlays?.[type]?.looks;
    if (!bag || typeof bag !== 'object') return [];
    return Object.entries(bag)
        .filter(([, l]) => l && typeof l === 'object')
        .map(([id, l]) => ({ id, name: l.name || 'Untitled', values: l.values || {} }));
}

/*
 * The next default name for a new look on this element: `Look {n}`, the lowest
 * n not already taken. Prefilled so making one is a single press.
 */
export function defaultLookName(looks) {
    const taken = new Set((looks || []).map((l) => String(l.name).trim().toLowerCase()));
    for (let n = 1; ; n += 1) if (!taken.has(`look ${n}`)) return `Look ${n}`;
}

/*
 * SEPARATE SIDE STYLES — `overlays.global.splitSides`, off by default.
 *
 * The paired elements (the ones with a `?team=` source AND settings to split)
 * normally share one `overlays.{type}.*` for both sides. With the switch on,
 * each side reads `overlays.{type}.side{T}.*` instead — the Scorecard's
 * `scorecard.{N}` board shape, keyed by side — so side 2's Player Name can carry
 * a different colour, font or size from side 1's.
 *
 *   styleNs       the namespace a mount hands `applyDesignSettings` /
 *                 `clearDesignSettings`. OVERRIDES read that namespace ALONE,
 *                 the rule every scoped override follows, so turning the switch
 *                 on copies the shared namespace into both sides in the same
 *                 commit (src/routes/design/sideStyles.js) — without it every
 *                 per-element pin would drop off air as the switch flipped.
 *   styleSetting  an element setting, resolved side → shared → fallback, so a
 *                 key the side copy lacks still draws what it did.
 *
 * Pure and dependency-free, like container-members.js, so the console imports
 * SIDE_STYLE_TYPES from here rather than keeping a second list. Both take the
 * SETTINGS object the mount was handed, never OverlayBase's, so a mount keeps
 * reading exactly what its caller passed.
 *
 * The Team Logo is per-side but has no settings and paints no palette — nothing
 * to split, so it is not listed.
 */

export const SPLIT_SIDES_KEY = 'overlays.global.splitSides';
export const SIDE_STYLE_TYPES = ['statsbar', 'statscard', 'roster', 'playername', 'controller'];

function get(obj, path) {
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[seg];
    }
    return cur;
}

// `settingOn(v, false)` from overlay-base.js — a boolean is itself and the
// string a `PUT /api/v1/settings` stores means what it says. With a false
// default that reduces to these two values, so it needs no third copy of the
// truth table.
export const splitSidesOn = (settings) => {
    const v = get(settings, SPLIT_SIDES_KEY);
    return v === true || v === 'true';
};

export function styleNs(settings, type, team) {
    const t = Number(team);
    if ((t !== 1 && t !== 2) || !SIDE_STYLE_TYPES.includes(type)) return type;
    return splitSidesOn(settings) ? `${type}.side${t}` : type;
}

export function styleSetting(settings, type, team, key, fallback) {
    const ns = styleNs(settings, type, team);
    if (ns !== type) {
        const v = get(settings, `overlays.${ns}.${key}`);
        if (v != null) return v;
    }
    // OverlayBase.deepGet's rule: a stored null is unset.
    const shared = get(settings, `overlays.${type}.${key}`);
    return shared == null ? fallback : shared;
}

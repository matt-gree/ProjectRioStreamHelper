// SEPARATE SIDE STYLES — the console half of `overlays.global.splitSides`.
//
// Off (the default), a paired element's two sources share one
// `overlays.{type}.*`. On, each side reads and writes `overlays.{type}.side{T}.*`,
// so side 1 and side 2 can be styled apart. The rule itself — which types, how
// a side resolves — lives in the overlay runtime (public/layout/lib/side-styles.js)
// and is imported from there, so the panel and the overlay cannot disagree.

import { useSettingsStore } from '../../context/store';
import {
    SIDE_STYLE_TYPES, SPLIT_SIDES_KEY, splitSidesOn,
} from '../../../public/layout/lib/side-styles.js';

export { SIDE_STYLE_TYPES, SPLIT_SIDES_KEY };

export const sideSegment = (side) => `side${side}`;

const isBag = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

export function useSplitSides() {
    return useSettingsStore(s => splitSidesOn(s));
}

/**
 * The namespace segment a stage panel reads and writes for this type and side,
 * or null for the shared namespace — which is every case but a split, paired
 * type whose side is known.
 */
export function sideStyleSegment(type, side, split) {
    if (!split || !SIDE_STYLE_TYPES.includes(type)) return null;
    return side === 1 || side === 2 ? sideSegment(side) : null;
}

/**
 * The writes that turn the switch on WITHOUT changing the broadcast: every
 * shared leaf copied into each side that has no copy yet. Overrides read the
 * side namespace alone, so without the copy every per-element pin would drop
 * off air the moment the switch flipped.
 *
 * A side that already has a bag is left alone — it is the producer's split
 * from a previous time the switch was on, and turning it back on is asking for
 * that again. Leaves are written one key each, so an overlay's settings filter
 * (`overlays.{type}.…`) sees them the same way it sees any other edit.
 */
export function seedSideStyles(overlays) {
    const sets = [];
    for (const type of SIDE_STYLE_TYPES) {
        const bag = isBag(overlays?.[type]) ? overlays[type] : {};
        for (const side of [1, 2]) {
            const seg = sideSegment(side);
            if (isBag(bag[seg])) continue;
            for (const [key, value] of Object.entries(bag)) {
                if (key === 'side1' || key === 'side2' || isBag(value) || value == null) continue;
                sets.push({ key: `overlays.${type}.${seg}.${key}`, value });
            }
        }
    }
    return sets;
}

/** Flip the switch — one commit, the seed riding with it when turning on. */
export function setSplitSides(on) {
    const store = useSettingsStore.getState();
    const seed = on ? seedSideStyles(store?.overlays) : [];
    return store.applyBatch([...seed, { key: SPLIT_SIDES_KEY, value: !!on }]);
}

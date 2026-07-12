/*
 * Resolve-by-copy: turn an address-book row into score.{N}.player.{T}.* entries.
 *
 * This is the bridge between the registry (which overlays never read) and the
 * live State keys overlays DO read. Picking a person copies their enrichment
 * into the player sub-tree — a full identity swap, so EVERY mapped field is
 * written (falling back to "" when the row leaves it blank). Writing only the
 * non-empty ones would let a sparse row inherit stale values (e.g. a prefix)
 * left over from whoever was previously in that slot.
 *
 * mainCharacter has no scoreboard target and is intentionally skipped here.
 */

// registry display.* / identities.* field -> score.player.* field
const FIELD_MAP = [
    ["display.tag", "name"],
    ["display.prefix", "team"],
    ["display.fullName", "full_name"],
    ["display.pronoun", "pronoun"],
    ["display.country", "country"],
    ["display.state", "state"],
    ["display.twitter", "twitter"],
    ["display.youtube", "youtube"],
    ["identities.rioName", "rioName"],
];

const dig = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * @param {object} row     participant row { identities, display, ... }
 * @param {string} basePath e.g. `score.1.player.2`
 * @returns {{key:string,value:any}[]} entries for useStateStore.setItems()
 */
export function participantToScoreEntries(row, basePath) {
    if (!row) return [];
    const entries = [];
    for (const [src, dst] of FIELD_MAP) {
        const v = dig(row, src);
        entries.push({ key: `${basePath}.${dst}`, value: v != null ? v : "" });
    }
    return entries;
}

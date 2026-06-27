/*
 * Resolve-by-copy: turn an address-book row into score.{N}.player.{T}.* entries.
 *
 * This is the bridge between the registry (which overlays never read) and the
 * live State keys overlays DO read. Picking a person copies their enrichment
 * into the player sub-tree. Only NON-EMPTY registry fields are written, so a
 * sparse row never clobbers a value already on the scoreboard.
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
        if (v != null && v !== "") {
            entries.push({ key: `${basePath}.${dst}`, value: v });
        }
    }
    return entries;
}

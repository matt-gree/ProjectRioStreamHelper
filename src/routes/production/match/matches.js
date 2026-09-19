/*
 * Small match helpers shared by the console surfaces (matchup stage, lower
 * third slots, Match desk). The match model itself lives in
 * src/context/match.js — this is display-only.
 */

/*
 * "M3 · Winners Final — Alice vs Bob", falling back to whatever the fixture has.
 *
 * LEADS WITH THE ID, in the console's own `M{id}` spelling (the board desk's
 * fixture slot, `Clear & unbind M3`). Names alone cannot tell two fixtures
 * between one pair apart — which is the doubleheader, the night's common
 * repeat — so every picker built on this offered two identical entries. A
 * fixture with nothing else to say keeps its old "Match 3" rather than a bare
 * "M3".
 */
export function matchDisplayLabel(matches, id) {
    const m = matches?.[id] || {};
    const names = [m?.player?.[1]?.rioName, m?.player?.[2]?.rioName].filter(Boolean).join(' vs ');
    const rest = m.label ? `${m.label}${names ? ` — ${names}` : ''}` : names;
    return rest ? `M${id} · ${rest}` : `Match ${id}`;
}

// The numeric match ids in state, ascending. State keys are strings.
export function matchIds(matches) {
    return Object.keys(matches || {}).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
}

/*
 * Small match helpers shared by the console surfaces (matchup stage, lower
 * third slots, Match desk). The match model itself lives in
 * src/context/match.js — this is display-only.
 */

// "Winners Final — Alice vs Bob", falling back to whatever the fixture has.
export function matchDisplayLabel(matches, id) {
    const m = matches?.[id] || {};
    const names = [m?.player?.[1]?.rioName, m?.player?.[2]?.rioName].filter(Boolean).join(' vs ');
    return m.label ? `${m.label}${names ? ` — ${names}` : ''}` : (names || `Match ${id}`);
}

// The numeric match ids in state, ascending. State keys are strings.
export function matchIds(matches) {
    return Object.keys(matches || {}).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
}

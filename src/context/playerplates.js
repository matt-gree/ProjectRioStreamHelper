/*
 * Player Plates actions — REST writes to the two-player name/sub-plate band.
 *
 * Like Commentary (server/commentary.py) and the Match module, the band lives in
 * the State socket store, so the AUTHORING UI reads `playerplates.*` straight
 * from `useStateStore`. This module holds only the write action: a PUT replaces
 * the whole config object (mode · source · matchId · two sides). The server
 * normalizes + re-projects the resolved overlay keys.
 */
import { useStateStore } from "./store";
// The sub-plate field vocabulary is shared with Commentary (the server validates
// against the same SUBFIELD_LABELS), so re-export it rather than duplicate.
import { SUBFIELD_OPTIONS } from "./commentary";
import { makeReq, jsonBody } from "../lib/api";

const req = makeReq("/api/v1");

export const PP_SUBFIELD_OPTIONS = SUBFIELD_OPTIONS;

export const PP_MODE_OPTIONS = [
    { value: "both", label: "Both" },
    { value: "p1", label: "Player 1" },
    { value: "p2", label: "Player 2" },
];

export const PP_SOURCE_OPTIONS = [
    { value: "match", label: "Match" },
    { value: "manual", label: "Manual" },
];

export const PP_LOCATION_OPTIONS = [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
];

/** Default shape for one side of the band. */
export const blankSide = (location) => ({
    name: "",
    subField: "",
    subLabel: "",
    subValue: "",
    visible: true,
    subVisible: true,
    location,
});

/** Fill a raw config with defaults so the UI always has a complete object. */
export function normalizeConfig(c) {
    c = c || {};
    const sides = c.sides || {};
    return {
        mode: ["both", "p1", "p2"].includes(c.mode) ? c.mode : "both",
        source: ["match", "manual"].includes(c.source) ? c.source : "match",
        matchId: c.matchId ?? null,
        sides: {
            1: { ...blankSide("left"), ...(sides["1"] || sides[1] || {}) },
            2: { ...blankSide("right"), ...(sides["2"] || sides[2] || {}) },
        },
    };
}

/** Current authored config, read live off the State store. */
export function getConfig() {
    return normalizeConfig(useStateStore.getState()?.playerplates?.config);
}

/** Replace the whole config (server normalizes + re-projects). */
export async function setPlayerPlatesConfig(config) {
    return req("/playerplates", { ...jsonBody({ config }), method: "PUT" });
}

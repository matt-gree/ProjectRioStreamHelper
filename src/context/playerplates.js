/*
 * Player Plates actions — REST writes to the two-player name/sub-plate band.
 *
 * Like Commentary (server/commentary.py) and the Match module, the band lives in
 * the State socket store, so the AUTHORING UI reads `playerplates.*` straight
 * from `useStateStore`. This module holds only the write action: a PUT replaces
 * the whole config object (source · matchId · two sides). The server normalizes
 * + re-projects the resolved overlay keys.
 */
// The sub-plate field vocabulary is shared with Commentary (the server validates
// against the same SUBFIELD_LABELS), so re-export it rather than duplicate.
import { SUBFIELD_OPTIONS } from "./commentary";
import { makeReq, jsonBody } from "../lib/api";

const req = makeReq("/api/v1");

export const PP_SUBFIELD_OPTIONS = SUBFIELD_OPTIONS;

export const PP_SOURCE_OPTIONS = [
    { value: "match", label: "Match" },
    { value: "manual", label: "Manual" },
];

export const PP_LOCATION_OPTIONS = [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
];

/*
 * Which anchor each plate takes when BOTH are up. Mirrors `pair_anchor` in
 * server/playerplates.py: side 1's own location decides the order (coerced to
 * left|right — `center` has no room in a pair) and side 2 takes the other
 * anchor. Derived from ONE side so two stored locations can never collide, and
 * so the order needs no swap flag of its own to contradict.
 */
export const pairAnchor = (side1Location) => (side1Location === "right"
    ? { 1: "right", 2: "left" }
    : { 1: "left", 2: "right" });

/** Default shape for one side of the band. */
export const blankSide = (location) => ({
    participantId: null,
    name: "",
    subField: "",
    subLabel: "",
    subValue: "",
    visible: true,
    subVisible: true,
    location,
});

/**
 * Fill a raw config with defaults so the UI always has a complete object.
 *
 * Also folds a legacy band-wide `mode` ("both" | "p1" | "p2") onto the per-side
 * `visible` flags — the mode said which plates were included, which is what each
 * side's own eye says, so the two were one fact with two switches. Mirrors
 * `normalize_config` in server/playerplates.py; both are idempotent, so a config
 * stored before the collapse reads the same in either runtime until the next
 * edit saves the folded shape.
 */
export function normalizeConfig(c) {
    c = c || {};
    const sides = c.sides || {};
    const one = (k, loc) => ({ ...blankSide(loc), ...(sides[k] || sides[Number(k)] || {}) });
    const out = {
        source: ["match", "manual"].includes(c.source) ? c.source : "match",
        matchId: c.matchId ?? null,
        sides: { 1: one("1", "left"), 2: one("2", "right") },
    };
    if (c.mode === "p1") out.sides[2].visible = false;
    else if (c.mode === "p2") out.sides[1].visible = false;
    return out;
}

/** Replace the whole config (server normalizes + re-projects). */
export async function setPlayerPlatesConfig(config) {
    return req("/playerplates", { ...jsonBody({ config }), method: "PUT" });
}

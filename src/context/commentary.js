/*
 * Commentary actions — REST writes to the registry-bound caster desk.
 *
 * Like the Match module (and unlike the participant registry), the commentary
 * desk lives in the State socket store, so the AUTHORING UI reads `commentary.*`
 * straight from `useStateStore`. This module only holds the write side, and the
 * write is deliberately ONE verb: a PUT replaces the whole (≤4) slot list, so
 * add/remove/reorder/edit all reduce to "compute the new array, send it". The
 * server normalizes + re-projects. Keeping it to the whole-array PUT is what
 * lets the desk's stage stage an edit as a single entry (see
 * `routes/production/stage/commentary.jsx`); don't add per-index helpers back.
 */
import { makeReq, jsonBody } from "../lib/api";

const req = makeReq("/api/v1");

export const MAX_COMMENTATORS = 4;

// Sub-plate field options the producer can choose per caster. Keys must match
// SUBFIELD_LABELS in server/commentary.py (the server validates against them).
export const SUBFIELD_OPTIONS = [
    { value: "fullName", label: "Full Name" },
    { value: "pronoun", label: "Pronouns" },
    { value: "prefix", label: "Prefix" },
    { value: "country", label: "Country" },
    { value: "state", label: "State" },
    { value: "twitter", label: "Twitter" },
    { value: "youtube", label: "YouTube" },
    { value: "rioName", label: "Rio Name" },
];

/**
 * What a sub-plate field reads for one address-book row — the client's copy of
 * `_resolve_sub` in server/commentary.py, so the console can say what a field
 * WILL draw before the projector has run (a staged pick, a field not chosen
 * yet). `rioName` is an identity, every other field a display value.
 */
export function subFieldValue(row, field) {
    if (!row || !field) return "";
    if (field === "rioName") return row.identities?.rioName || "";
    return row.display?.[field] || "";
}

/**
 * Whether a slot takes a plate on the strip. The mount draws a caster only when
 * it is both shown AND named (commentary-mount.js gathers `name && visible`), so
 * a shown seat with nobody picked is not on air — and anything that counts or
 * numbers plates has to ask the same question or it numbers a hole.
 */
export const isOnStrip = (slot) => slot?.visible !== false && !!slot?.participantId;

/** Replace the whole slot list (server caps at MAX_COMMENTATORS). */
export async function setCommentarySlots(slots) {
    return req("/commentary", { ...jsonBody({ slots }), method: "PUT" });
}

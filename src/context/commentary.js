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
    { value: "mainCharacter", label: "Main" },
    { value: "country", label: "Country" },
    { value: "state", label: "State" },
    { value: "twitter", label: "Twitter" },
    { value: "youtube", label: "YouTube" },
    { value: "rioName", label: "Rio Name" },
];

/** Replace the whole slot list (server caps at MAX_COMMENTATORS). */
export async function setCommentarySlots(slots) {
    return req("/commentary", { ...jsonBody({ slots }), method: "PUT" });
}

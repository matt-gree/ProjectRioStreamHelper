/*
 * Commentary actions — REST writes to the registry-bound caster desk.
 *
 * Like the Match module (and unlike the participant registry), the commentary
 * desk lives in the State socket store, so the AUTHORING UI reads `commentary.*`
 * straight from `useStateStore`. This module only holds the write actions: a PUT
 * replaces the whole (≤4) slot list, so add/remove/reorder/edit all reduce to
 * "compute the new array, send it". The server normalizes + re-projects.
 */
import { useStateStore } from "./store";

const BASE = "/api/v1";

async function req(path, options) {
    const resp = await fetch(`${BASE}${path}`, options);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw new Error(data?.error || `Request failed: ${resp.status}`);
    }
    return data;
}

const jsonBody = (body) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
});

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

const blankSlot = () => ({ participantId: null, subField: "", visible: true, subVisible: true });

/** Current authored slots, read live off the State store. */
export function getSlots() {
    const s = useStateStore.getState()?.commentary?.slots;
    return Array.isArray(s) ? s : [];
}

/** Replace the whole slot list (server caps at MAX_COMMENTATORS). */
export async function setCommentarySlots(slots) {
    return req("/commentary", { ...jsonBody({ slots }), method: "PUT" });
}

/** Patch one slot by index and persist. */
export function updateSlot(index, patch) {
    const slots = getSlots().map((s, i) => (i === index ? { ...s, ...patch } : s));
    return setCommentarySlots(slots);
}

/** Append an empty caster slot (no-op at the cap). */
export function addSlot() {
    const slots = getSlots();
    if (slots.length >= MAX_COMMENTATORS) return Promise.resolve();
    return setCommentarySlots([...slots, blankSlot()]);
}

/** Remove a caster slot by index. */
export function removeSlot(index) {
    return setCommentarySlots(getSlots().filter((_, i) => i !== index));
}

/** Move a slot up (dir -1) or down (dir +1) in the desk order. */
export function moveSlot(index, dir) {
    const slots = getSlots();
    const j = index + dir;
    if (j < 0 || j >= slots.length) return Promise.resolve();
    const next = slots.slice();
    [next[index], next[j]] = [next[j], next[index]];
    return setCommentarySlots(next);
}

/** Move a slot from one index to another (drag-to-reorder). */
export function reorderSlots(from, to) {
    const slots = getSlots();
    if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) {
        return Promise.resolve();
    }
    const next = slots.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return setCommentarySlots(next);
}

/*
 * Organizer actions — REST writes to the address-book-bound staff list.
 *
 * Same shape as the Commentary module: the authored list lives in the State
 * socket store, so the AUTHORING UI reads `tournamentInfo.organizers` (and the
 * projected `tournamentInfo.organizer_{i}_*` keys) straight from
 * `useStateStore`. This module only holds the write side, and the write is ONE
 * verb — a PUT replaces the whole (≤3) list, so add/remove/reorder/clear all
 * reduce to "compute the new array, send it". The server normalizes and
 * re-projects against the registry.
 *
 * It has to go through REST rather than a plain state write: the projected trio
 * is what overlays and the stream_labels .txt mirror read, and only the server
 * can resolve a participant id into it.
 */
import { makeReq, jsonBody } from "../lib/api";

const req = makeReq("/api/v1");

export const MAX_ORGANIZERS = 3;

/** Replace the whole organizer list (server caps at MAX_ORGANIZERS). */
export async function setOrganizers(organizers) {
    return req("/organizers", { ...jsonBody({ organizers }), method: "PUT" });
}

/*
 * Schedule actions — the producer's running order (`schedule.queue`).
 *
 * The queue lives in the State socket store, so every surface reads
 * `schedule.*` straight from `useStateStore` and this module only holds the
 * writes (same shape as ../context/match.js).
 *
 * MEMBERSHIP AND ORDER ARE PER-ID CALLS. There is deliberately no
 * "send the whole reordered queue" helper: the schedule stage panel used to do
 * that, and a whole-list write drops anything added between the client's read
 * and its write — a real window now that creating a match enrols it. Ask the
 * server to move one match and let it own the list.
 */

import { makeReq, jsonBody } from "../lib/api";

const req = makeReq("/api/v1");

/** Put match `m` at the end of the running order (idempotent). */
export async function queueMatch(m) {
    return req(`/schedule/queue/${m}`, { method: "POST" });
}

/** Take match `m` out of the running order. The match itself survives. */
export async function unqueueMatch(m) {
    return req(`/schedule/queue/${m}`, { method: "DELETE" });
}

/** Shift match `m` by `delta` places, clamped to the ends of the queue. */
export async function moveQueuedMatch(m, delta) {
    return req(`/schedule/queue/${m}/move?delta=${delta}`, { method: "POST" });
}

/** The schedule overlay's heading ("Upcoming Matches"). */
export async function setScheduleTitle(title) {
    return req("/schedule", { ...jsonBody({ title }), method: "PUT" });
}

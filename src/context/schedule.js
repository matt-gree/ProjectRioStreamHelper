/*
 * Schedule actions — the producer's running orders (`schedule.queues`).
 *
 * The queues live in the State socket store, so every surface reads `schedule.*`
 * straight from `useStateStore` and this module only holds the writes (same
 * shape as ../context/match.js).
 *
 * MEMBERSHIP AND ORDER ARE PER-ID CALLS. There is deliberately no
 * "send the whole reordered queue" helper: the schedule stage panel used to do
 * that, and a whole-list write drops anything added between the client's read
 * and its write — a real window now that creating a match enrols it. Ask the
 * server to move one match and let it own the list.
 *
 * `moveQueuedMatch` sends NO queue id, also on purpose: the server resolves which
 * running order holds the match, so a client working from a stale read cannot
 * reorder the wrong one.
 */

import { makeReq, jsonBody } from "../lib/api";

const req = makeReq("/api/v1");

/**
 * Put match `m` at the end of a running order (idempotent). Naming a different
 * queue MOVES it — membership is exclusive, a fixture belongs to one order.
 */
export async function queueMatch(m, queue) {
    const q = queue ? `?queue=${encodeURIComponent(queue)}` : "";
    return req(`/schedule/queue/${m}${q}`, { method: "POST" });
}

/** Take match `m` out of every running order. The match itself survives. */
export async function unqueueMatch(m) {
    return req(`/schedule/queue/${m}`, { method: "DELETE" });
}

/** Shift match `m` by `delta` places within its own order, clamped to its ends. */
export async function moveQueuedMatch(m, delta) {
    return req(`/schedule/queue/${m}/move?delta=${delta}`, { method: "POST" });
}

/** Add a running order. Its id is minted from the title and never changes. */
export async function createQueue(title) {
    return req("/schedule/queues", { ...jsonBody({ title }), method: "POST" });
}

/** Retitle a running order. The id is stable, so board assignments survive. */
export async function renameQueue(qid, title) {
    return req(`/schedule/queues/${encodeURIComponent(qid)}`,
        { ...jsonBody({ title }), method: "PUT" });
}

/** Drop a running order — its matches survive, unenrolled. 409 on the last one. */
export async function deleteQueue(qid) {
    return req(`/schedule/queues/${encodeURIComponent(qid)}`, { method: "DELETE" });
}

/** Shift a whole running order's position in the list, clamped to the ends. */
export async function moveQueue(qid, delta) {
    return req(`/schedule/queues/${encodeURIComponent(qid)}/move?delta=${delta}`,
        { method: "POST" });
}

/**
 * The schedule overlay's heading (`schedule.title`) — the ticker's own broadcast
 * string, belonging to NO running order. An order's title is a producer's private
 * label for a list of fixtures; projecting the first one's into the heading put
 * the word "WINNERS" over a union of Winners + Losers.
 */
export async function setScheduleTitle(title) {
    return req("/schedule", { ...jsonBody({ title }), method: "PUT" });
}

/*
 * Match actions — REST writes to the fixture object above scoreboards.
 *
 * Unlike the participant registry, a Match lives in the State socket store, so
 * the AUTHORING UI reads `match.{M}.*` straight from `useStateStore` (like
 * `score.*`). This module only holds the write actions; there is no local cache.
 * Every write re-projects the bound board(s) server-side (see server/match.py).
 */

import { makeReq, jsonBody } from "../lib/api";

const req = makeReq("/api/v1");

/**
 * Create the next match, enrolled in a running order. Returns { id, match }.
 *
 * `queue` names WHICH order it joins; omitted means the first, which is the
 * whole story on a single-order rig. 404 on an order that no longer exists,
 * which is a stale client read — the desk's headings are the ids it sends.
 */
export async function createMatch(queue) {
    const q = queue ? `?queue=${encodeURIComponent(queue)}` : "";
    return req(`/match${q}`, { ...jsonBody({}), method: "POST" });
}

/** Delete a match (unbinds + blanks any bound boards server-side). */
export async function deleteMatch(m) {
    return req(`/match/${m}`, { method: "DELETE" });
}

/**
 * Merge-update a match with a partial (nested) body, e.g.
 *   updateMatch(2, { gameMode: "Superstar" })
 *   updateMatch(2, { player: { 1: { captainIndex: 3 } } })
 * The server flattens nested dicts into match.{M}.<dotpath> writes.
 */
export async function updateMatch(m, partial) {
    return req(`/match/${m}`, { ...jsonBody(partial), method: "PUT" });
}

/** Bind board `sb` to match `m`, or unbind when `m` is null. */
export async function bindScoreboard(sb, m) {
    return req(`/scoreboards/${sb}/match`, {
        ...jsonBody({ match: m ?? null }),
        method: "PUT",
    });
}

/*
 * Put the next queued fixture on board `sb`.
 *
 * "Next" is resolved SERVER-side (Schedule.next_up + bind under one lock), not
 * passed in: two boards advancing in the same tick would otherwise both send the
 * same match id and the second bind would steal it from the first. Rejects with
 * 409 when nothing in the queue is waiting for a board.
 */
export async function takeNextMatch(sb) {
    return req(`/scoreboards/${sb}/next-match`, { ...jsonBody({}), method: "POST" });
}

/** Swap participant 1↔2 on a match (authoring flip); series wins follow. */
export async function flipMatch(m) {
    return req(`/match/${m}/flip`, { ...jsonBody({}), method: "POST" });
}

/** Producer override: force the series decided for `side` (null clears it). */
export async function decideMatch(m, side) {
    return req(`/match/${m}/decide`, {
        ...jsonBody({ side: side ?? null }),
        method: "POST",
    });
}

/** Clear a board's match conflict, keeping the match bound ("ignore this game"). */
export async function dismissMatchConflict(sb) {
    return req(`/scoreboards/${sb}/match-conflict/dismiss`, {
        ...jsonBody({}),
        method: "POST",
    });
}

/**
 * Fill match `m` from a start.gg set: the server fetches the set with full
 * player detail, upserts both players into the participant registry, seats
 * them on sides 1/2, and stamps the round name as the label.
 */
export async function loadStartGGSet(m, setId) {
    return req(`/match/${m}/startgg-set`, {
        ...jsonBody({ setId }),
        method: "POST",
    });
}

/**
 * Create (or reuse) a match seeded from a start.gg set, without binding a board.
 * The bracket page's "load into a match" path — the producer binds the returned
 * match to a scoreboard afterwards on the Match tab. Returns { id, created, match }.
 */
export async function loadStartGGSetToMatch(setId) {
    return req("/match/from-startgg", {
        ...jsonBody({ setId }),
        method: "POST",
    });
}

/** Fetch + project the head-to-head record for match `m` (matchup.* state). */
export async function fetchMatchup(m) {
    return req(`/matchup/fetch?match=${m}`, { method: "POST" });
}

/** Blank the matchup band. */
export async function clearMatchup() {
    return req("/matchup/clear", { method: "POST" });
}

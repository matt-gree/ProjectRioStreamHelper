/*
 * Match actions — REST writes to the fixture object above scoreboards.
 *
 * Unlike the participant registry, a Match lives in the State socket store, so
 * the AUTHORING UI reads `match.{M}.*` straight from `useStateStore` (like
 * `score.*`). This module only holds the write actions; there is no local cache.
 * Every write re-projects the bound board(s) server-side (see server/match.py).
 */

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

/** Create the next match. Returns { id, match }. */
export async function createMatch() {
    return req("/match", { ...jsonBody({}), method: "POST" });
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

/** Convenience: set one side's fixture field. */
export function setMatchPlayerField(m, side, field, value) {
    return updateMatch(m, { player: { [side]: { [field]: value } } });
}

/** Bind board `sb` to match `m`, or unbind when `m` is null. */
export async function bindScoreboard(sb, m) {
    return req(`/scoreboards/${sb}/match`, {
        ...jsonBody({ match: m ?? null }),
        method: "PUT",
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

/** Fetch + project the head-to-head record for match `m` (matchup.* state). */
export async function fetchMatchup(m) {
    return req(`/matchup/fetch?match=${m}`, { method: "POST" });
}

/** Blank the matchup band. */
export async function clearMatchup() {
    return req("/matchup/clear", { method: "POST" });
}

/*
 * Shared thin REST helpers for the action modules under src/context/
 * (match, commentary, playerplates, participants), which each used to carry
 * an identical copy.
 *
 * makeReq(base) returns the standard `req(path, options)`:
 *   - fetches `${base}${path}`
 *   - parses the JSON body (a non-JSON/empty body degrades to {})
 *   - resolves with the parsed data on 2xx
 *   - throws Error(data.error || "Request failed: {status}") otherwise
 *
 * jsonBody(body) builds the JSON-POST/PUT fetch-options fragment; callers
 * spread it and add `method`:  req("/x", { ...jsonBody(payload), method: "POST" })
 */

export function makeReq(base = "") {
    return async function req(path, options) {
        const resp = await fetch(`${base}${path}`, options);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data?.error || `Request failed: ${resp.status}`);
        }
        return data;
    };
}

export const jsonBody = (body) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
});

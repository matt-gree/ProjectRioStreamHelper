/*
 * Shared thin REST helpers for the action modules under src/context/
 * (match, commentary, playerplates, participants), which each used to carry
 * an identical copy.
 *
 * makeReq(base) returns the standard `req(path, options)`:
 *   - fetches `${base}${path}`
 *   - parses the JSON body (a non-JSON/empty body degrades to {})
 *   - resolves with the parsed data on 2xx
 *   - throws Error(<server message> || "Request failed: {status}") otherwise,
 *     where the message is FastAPI's `detail` (what every HTTPException
 *     carries) or a handler's own `error`
 *
 * jsonBody(body) builds the JSON-POST/PUT fetch-options fragment; callers
 * spread it and add `method`:  req("/x", { ...jsonBody(payload), method: "POST" })
 */

export function makeReq(base = "") {
    return async function req(path, options) {
        const resp = await fetch(`${base}${path}`, options);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            // `detail` is a list on a 422 validation error — not a sentence.
            const detail = typeof data?.detail === "string" ? data.detail : "";
            throw new Error(detail || data?.error || `Request failed: ${resp.status}`);
        }
        return data;
    };
}

export const jsonBody = (body) => ({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
});

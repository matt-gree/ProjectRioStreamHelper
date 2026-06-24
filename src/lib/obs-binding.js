/*
 * obs-binding.js — match a PRSH overlay URL to the streamer's OBS browser
 * sources.
 *
 * The Setup (Layouts) tab and the Production page both need to answer the same
 * question: "is this overlay already a source in OBS, and where?" Sources can
 * live on a different host/port than PRSH (dual-machine setups), so we compare
 * by URL *pathname* — `/layout/.../foo.html` — plus the handful of query params
 * that actually distinguish one overlay from another (scoreboard number, size,
 * team, controller port, bracket side). Host, port, and incidental params
 * (preview flags, cache-busters) are ignored.
 */

const ORIGIN = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'http://localhost';

// When both URLs name `key`, they must agree; if either omits it, we can't
// distinguish on it, so we don't reject. `dflt` lets a missing value stand in
// for the overlay's documented default (e.g. scoreboard defaults to 1).
function paramMatch(a, b, key, dflt) {
    const av = a.searchParams.get(key) ?? dflt;
    const bv = b.searchParams.get(key) ?? dflt;
    if (av == null || bv == null) return true;
    return String(av) === String(bv);
}

export function urlsMatch(layoutUrl, obsUrl) {
    if (!layoutUrl || !obsUrl) return false;
    let a, b;
    try { a = new URL(layoutUrl, ORIGIN); } catch { return false; }
    try { b = new URL(obsUrl, ORIGIN); } catch { return false; }
    if (a.pathname.replace(/\/$/, '') !== b.pathname.replace(/\/$/, '')) return false;
    return paramMatch(a, b, 'scoreboard', '1')
        && paramMatch(a, b, 'size', null)
        && paramMatch(a, b, 'team', null)
        && paramMatch(a, b, 'port', null)
        && paramMatch(a, b, 'winners_only', null)
        && paramMatch(a, b, 'losers_only', null);
}

/*
 * Resolve a layout URL against the OBS scene mirror. The store only tracks the
 * program + preview scenes (where firing happens), so binding is reported
 * relative to those:
 *   live    — present in the program scene
 *   preview — present only in the preview scene (studio mode)
 *   absent  — not in either tracked scene
 * `matches` lists every hit so callers can show counts / disambiguate.
 */
export function bindingForUrl(layoutUrl, { sceneItems = {}, programScene, previewScene } = {}) {
    let program = null;
    let preview = null;
    const matches = [];
    for (const [scene, items] of Object.entries(sceneItems)) {
        for (const it of items || []) {
            if (it?.url && urlsMatch(layoutUrl, it.url)) {
                const hit = { scene, sourceName: it.sourceName, enabled: it.enabled };
                matches.push(hit);
                if (scene === programScene && !program) program = hit;
                else if (scene === previewScene && !preview) preview = hit;
            }
        }
    }
    if (program) return { state: 'live', ...program, matches };
    if (preview) return { state: 'preview', ...preview, matches };
    return { state: 'absent', matches };
}

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

/*
 * The params that distinguish one INSTANCE of an overlay from another, with the
 * value a missing param stands in for. `scoreboard` documents a default (board
 * 1), so a source with no `?scoreboard=` and one with `?scoreboard=1` are the
 * same instance — which is what makes a board-blind canonical URL comparable to
 * a board-qualified source URL at all. The rest default to null, meaning "not
 * stated, so it can't distinguish".
 */
const DISTINGUISHING_PARAMS = [
    ['scoreboard', '1'],
    ['size', null],
    ['team', null],
    ['port', null],
    ['winners_only', null],
    ['losers_only', null],
];

// When both URLs name `key`, they must agree; if either omits it, we can't
// distinguish on it, so we don't reject. `dflt` lets a missing value stand in
// for the overlay's documented default (e.g. scoreboard defaults to 1).
function paramMatch(a, b, key, dflt) {
    const av = a.searchParams.get(key) ?? dflt;
    const bv = b.searchParams.get(key) ?? dflt;
    if (av == null || bv == null) return true;
    return String(av) === String(bv);
}

function parse(url) {
    if (!url) return null;
    try { return new URL(url, ORIGIN); } catch { return null; }
}

/*
 * Do two URLs name the same INSTANCE, ignoring which overlay they are?
 *
 * Split out from urlsMatch because the two surfaces identify the overlay
 * differently and only agree on the instance half. Setup holds a real layout
 * URL and can compare pathnames; Production holds an element whose `match()` is
 * a deliberately loose regex (it tolerates `/scoreboard2/`, `?intro=0`, a
 * different host) and must keep using it for TYPE detection — but that regex
 * cannot tell board 1's source from board 2's, which is exactly the ambiguity
 * this function resolves.
 */
export function paramsMatch(aUrl, bUrl) {
    const a = parse(aUrl), b = parse(bUrl);
    if (!a || !b) return false;
    return DISTINGUISHING_PARAMS.every(([key, dflt]) => paramMatch(a, b, key, dflt));
}

/*
 * Which board a source URL names — the number in `?scoreboard=N`, or 1.
 *
 * The default lives here rather than at the call sites because it is the same
 * fact DISTINGUISHING_PARAMS already states: a source with no `?scoreboard=` IS
 * board 1's, which is why a board-blind canonical URL matches a board-1 source.
 * Discovering instances and matching them have to agree on that or a producer's
 * paramless scoreboard would show up as a board of its own.
 */
export function boardOfUrl(url) {
    const u = parse(url);
    if (!u) return null;
    const n = Number(u.searchParams.get('scoreboard') ?? 1);
    return Number.isInteger(n) && n > 0 ? n : null;
}

export function urlsMatch(layoutUrl, obsUrl) {
    const a = parse(layoutUrl), b = parse(obsUrl);
    if (!a || !b) return false;
    if (a.pathname.replace(/\/$/, '') !== b.pathname.replace(/\/$/, '')) return false;
    return paramsMatch(layoutUrl, obsUrl);
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

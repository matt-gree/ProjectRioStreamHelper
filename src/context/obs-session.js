/*
 * The OBS connection's shared state, and the per-input facts derived from it.
 *
 * obs.jsx (the store, connect/disconnect, event wiring) and the two modules
 * split out of it (obs-renames.js, obs-source-passes.js) all read and write
 * the same connection, so its state is one object here rather than six
 * module-level variables only one file could reach. Every field is reset by
 * `resetMirror` on connect and disconnect, except `client` and `generation`,
 * which connect/disconnect own.
 */

export const session = {
    // The single OBS client, shared by the store actions and the React manager.
    client: null,
    // Bumped on every connect()/disconnect(); async work and event handlers from a
    // superseded generation no-op, so a settings change mid-flight can't race.
    generation: 0,

    /*
     * Which scenes we mirror. Program + preview are eager (refreshAll re-seeds them
     * on every connect and studio-mode change); every other scene joins on demand
     * via mirrorScene() and then stays for the life of the connection.
     *
     * This set is also the AUTHORITY for scene-item events. Before lazy mirroring
     * the handlers refreshed whatever scene an event named, which quietly pulled
     * scenes nobody had asked for into the store; now an event for an untracked
     * scene is dropped, and one for a lazily-mirrored scene is honoured — the whole
     * point, since a producer staging a Break scene needs it live, not a snapshot.
     */
    tracked: new Set(),

    /*
     * sourceName -> Promise<inputSettings | null>.
     *
     * GetInputSettings is one round trip per browser source, and refreshScene ran
     * it per source PER SCENE. At program+preview that was the "scenes are small,
     * so the per-source call is cheap" bargain; across N mirrored scenes sharing
     * sources it stops being cheap, and it is exactly what lazy mirroring would
     * otherwise multiply. Caching the PROMISE (not the value) also collapses the
     * two concurrent refreshes of scenes sharing a source into one call.
     *
     * Invalidated by InputSettingsChanged and InputRemoved — a name can be reused
     * by a different input, so a stale entry is not merely out of date.
     */
    inputCache: new Map(),

    /*
     * Which scenes hold each GROUP — `group name -> Set(scene)`.
     *
     * An item inside a group lives in the group's own scene as far as obs-websocket
     * is concerned: its events arrive with `sceneName` = the group, and every
     * request against it has to name the group, never the scene the producer sees
     * it in. This is how an event about a group's contents finds the mirrored
     * scenes that list it.
     */
    groupParents: new Map(),

    /*
     * NAMES ARE THE PRODUCER'S, AND OBS ADDRESSES EVERYTHING BY NAME.
     *
     * obs-websocket 5 on OBS 28/29 has no stable id for an input or a scene — every
     * request names one — and a producer can rename either in OBS at any moment
     * (PRSH renames its own sources too: followUrlWithName). So anything holding a
     * name across time is holding something that can go stale under it: a staged
     * confirm-mode action whose `run` captured "Stat Bar — Side 1 (Board 1)", a
     * Go Live that runs a board switch and then, a beat later, a redraw of the
     * same source the switch has just renamed.
     *
     * `aliases` is old name -> current name, for every rename seen on this
     * connection, kept flat (a chain A -> B -> C stores A -> C and B -> C). Every
     * store action passes the names it was handed through `liveName` at the moment
     * it calls OBS, so a request made under a name that has since moved still
     * reaches the thing it meant. A name reused by a NEW input or scene drops its
     * alias (InputCreated / SceneCreated): from then on it means the new thing.
     */
    aliases: new Map(),
};

export function liveName(name) {
    return (name != null && session.aliases.get(name)) || name;
}

/*
 * A Controller source from before PRSH proxied gc-overlay (/gc/) iframed it
 * directly on its own port. Recognised by the ports PRSH has ON RECORD — the
 * default, the one the retired setting held, and this launch's
 * (`legacy_ports` in /controller/status, loaded on every connect) — plus the
 * root path and a controller `port` of 1-4. Never a guessed range: whatever
 * this claims, the address repair rewrites, and a range would have claimed a
 * producer's own tool on 8080.
 */
let gcLegacyPorts = new Set([8069]);

export async function loadGcLegacyPorts() {
    try {
        const s = await (await fetch('/api/v1/controller/status')).json();
        if (Array.isArray(s?.legacy_ports) && s.legacy_ports.length) gcLegacyPorts = new Set(s.legacy_ports.map(Number));
    } catch { /* keep the last answer */ }
}

// Tests only.
export function setGcLegacyPorts(ports) { gcLegacyPorts = new Set(ports); }

function isLegacyGcUrl(u) {
    return gcLegacyPorts.has(Number(u.port)) && u.pathname === '/'
        && /^[1-4]$/.test(u.searchParams.get('port') || '');
}

export function resetMirror() {
    session.tracked = new Set();
    session.inputCache = new Map();
    session.groupParents = new Map();
    session.aliases = new Map();
}

/*
 * The OBS scene a mirrored item must be ADDRESSED through — the group, for an
 * item inside one. Every request that names a (scene, item id) pair goes
 * through this, because an item id is only unique within the scene that owns
 * it: a child of a group asked for by its outer scene is either a 600 or, worse,
 * a different item that happens to share the number.
 */
export const ownerScene = (sceneName, item) => item?.owner ?? sceneName;

export function isPrshUrl(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return false;
        if (u.pathname.startsWith('/layout/')) return true;
        if (u.pathname === '/gc' || u.pathname.startsWith('/gc/')) return true;
        return isLegacyGcUrl(u);
    } catch {
        return false;
    }
}

// A browser source is "fed by PRSH" when it's one of the app's overlays:
//   1. served from the app's /layout/ mount (host/port can be anything, so
//      this holds in single- and dual-machine setups), OR
//   2. gc-overlay, served through PRSH's /gc/ proxy — or, from before the
//      proxy, iframed directly on its own port (http://<host>:8069/?port=N, no
//      /layout/ path, so matched by port). The address repair moves those
//      onto /gc/, since that port is now picked per launch.
// Everything else (cams, game capture, audio, third-party browser sources) is
// ignored — the rail should only show PRSH's own overlay elements.
// A PRSH overlay's intro animation is disabled per-source via `?intro=0` on its
// URL (see reveal-gate.js). That single flag also decides the OBS browser
// source's "Shutdown source when not visible" property:
//   • intro ON  (default) → shutdown TRUE: the source fully unloads on hide and
//     gets a fresh, clean load on every show, so its reveal animation always
//     plays from a blank frame — no retained full-alpha texture to flash (the
//     eye-toggle stutter). This is the only page-independent cure for the
//     OBS-native eye, which can't be intercepted the way the app's hide is.
//   • intro OFF → shutdown FALSE: nothing animates, so a retained texture is
//     harmless; keep the source resident (no reload flash) — what a persistent
//     always-on overlay wants.
function urlIntroDisabled(url) {
    try { return new URL(url).searchParams.get('intro') === '0'; } catch { return false; }
}
// Only overlays that play a reveal on show are affected — static overlays
// (stats, roster, team logo, bracket, ticker, scenes) have nothing to stutter,
// so we leave their source resident (OBS default shutdown=false) and never
// touch them. Matches the scoreboard BAND specifically (scoreboardN/scoreboard),
// not the sibling stats/roster/teamlogo files in the same folder.
// The post-game callouts belong here for the same reason the hit visualizer
// does — a GSAP walkthrough on show, and a heavy one. Their in-page gate
// (lib/reveal-gate.js) covers the app's own hide and the container path, but
// the OBS-NATIVE eye stops the source's frames before any snap-dark can be
// painted, so a resident callout composites the last frame of the finished
// graphic for a beat before the intro starts. A fresh load per show is the
// only cure for that one, and it is the trade every animated PRSH source
// already makes.
const ANIMATED_LAYOUT = /\/layout\/(?:scoreboard\d*\/scoreboard|scorecard\/|lowerthird\/|matchup\/|commentary\/|playerplates\/|hitvisualizer\/|postgame\/)/i;
function layoutAnimates(url) {
    try { return ANIMATED_LAYOUT.test(new URL(url).pathname); } catch { return false; }
}
export function desiredShutdown(url) {
    return layoutAnimates(url) && !urlIntroDisabled(url);
}

/*
 * Auto-correct the "Shutdown source when not visible" property for PRSH
 * overlays so their reveals never flash a stale OBS texture (see
 * desiredShutdown). Idempotent: only writes when the current value differs, so
 * it settles after one pass and can't loop on the InputSettingsChanged echo.
 *
 * Runs once per source rather than once per (source × scene) — it hangs off
 * the cache miss, which is the one place a source's settings are freshly seen.
 */
export function reconcileShutdown(sourceName, settings) {
    const url = settings?.url || '';
    if (!isPrshUrl(url) || !url.includes('/layout/')) return;
    const want = desiredShutdown(url);
    if ((settings.shutdown === true) === want) return;
    session.client?.call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: { shutdown: want },
        overlay: true,
    }).catch(() => { /* best-effort */ });
}

export function inputSettingsFor(sourceName, gen) {
    const hit = session.inputCache.get(sourceName);
    if (hit) return hit;
    const pending = (async () => {
        try {
            const { inputSettings } = await session.client.call('GetInputSettings', { inputName: sourceName });
            const settings = inputSettings || {};
            if (gen === session.generation) reconcileShutdown(sourceName, settings);
            return settings;
        } catch {
            // Input may have been removed between calls — don't cache the miss,
            // or a source recreated under the same name stays invisible.
            session.inputCache.delete(sourceName);
            return null;
        }
    })();
    session.inputCache.set(sourceName, pending);
    return pending;
}

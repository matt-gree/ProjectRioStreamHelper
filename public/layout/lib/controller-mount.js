/*
 * controller-mount.js — the controller-input display, bound to a scoreboard SIDE.
 *
 * A thin wrapper around gc-overlay, which is a SUBPROCESS on its own port
 * (default 8069) rather than anything PRSH renders. This mount's whole job is
 * deciding which controller port to show and iframing gc-overlay at it.
 *
 * PRSH OWNS THE SIDE→PORT MAPPING. The HUD reports each player's controller
 * port, which provider.py writes to `score.{N}.player.{T}.port`; this reads that
 * key. So a left/right source follows whoever is on that side even when Project
 * Rio reassigns away/home between games — the port travels with the player
 * through the side cascade. No gc-overlay changes required, and the iframe is
 * reloaded only when the port actually changes.
 *
 * Offered on every platform: gc-overlay carries a Dolphin transport for each,
 * and what gates the element is whether the reader is INSTALLED, which this
 * mount reports as its own blank. See the controller-overlay skill.
 */

/*
 * ── The query string PRSH hands gc-overlay ───────────────────────────────────
 *
 * Split in two, by who owns the answer.
 *
 * PLUMBING (below) is PRSH's and is not a producer setting. gc-overlay's page
 * is also a standalone tool a person opens in a browser, so it ships its
 * interactive chrome on by default: a settings gear, a "P1" port label, and a
 * "Waiting for controller data..." line. All three would go out on air here,
 * and PRSH already says each of those things somewhere a producer can act on —
 * the port comes from the side cascade, the reader's health is on the
 * Connections tab, and a missing reader is one of this mount's three named
 * blanks. `bg=transparent` is plumbing for a different reason: the page paints
 * an opaque #1a1a2e unless asked, so without it the iframe lands in OBS as a
 * solid dark box no matter how transparent this layout is. A producer control
 * for any of these would be a knob whose only correct value is the one PRSH
 * already picks.
 *
 * APPEARANCE (DISPLAY_KEYS) is the producer's, and reads `overlays.controller.*`
 * — one layer, authored on the element's Production stage panel like every
 * other element's look.
 *
 * These ride as per-source URL params rather than gc-overlay's
 * `POST /api/settings`, which moves the reader's SERVER-WIDE defaults and
 * pushes them to every connected client — including the Connections tab's
 * diagnostic previews, which deliberately draw the reader's own look rather
 * than the broadcast's.
 */
import { styleSetting } from './side-styles.js';

const GC_PLUMBING = 'bg=transparent&gear=0&portlabel=0&status=0';

/*
 * gc-overlay's query alias, and PRSH's settings key under `overlays.controller`.
 *
 * Two spellings because each side keeps its own convention (gc-overlay's short
 * aliases, camelCase in `overlays.*`), and one table is what stops them
 * drifting apart. A new gc-overlay display setting is one row here, one in
 * LAYOUT_SETTINGS.controller, and one in the layout's <meta> whitelist.
 */
const DISPLAY_KEYS = [
    { param: 'labels', key: 'labels', kind: 'bool', fallback: true },
    { param: 'keyline', key: 'keyline', kind: 'bool', fallback: true },
    /*
     * An OPACITY, 0..1, carried in gc-overlay's own unit end to end — nothing
     * between the console slider and the query string converts it. The one
     * translation this file already owns (the 1-indexed port) is the argument
     * for not adding a second: a unit that changes hands silently is wrong only
     * on air. The percentage the console shows is a presentation, applied and
     * undone inside the control that shows it.
     */
    { param: 'idlefill', key: 'idleFillOpacity', kind: 'unit', fallback: 0 },
];

// Settings keys that change what this mount draws — everything else is somebody
// else's overlay, and waking on it would reload the iframe for nothing.
export function watchesSetting(key) {
    return key === 'overlays.controller' || key.startsWith('overlays.controller.')
        // Flipping Separate side styles moves which namespace this side reads.
        || key === 'overlays.global' || key === 'overlays.global.splitSides';
}

// The appearance half of the query string — this side's copy when Separate
// side styles is on (OverlayBase.styleNs), else the shared one.
function displayParams(settings, team) {
    return DISPLAY_KEYS.map(({ param, key, kind, fallback }) => {
        const raw = styleSetting(settings, 'controller', team, key, null);
        if (kind === 'bool') {
            return `${param}=${(typeof raw === 'boolean' ? raw : fallback) ? 1 : 0}`;
        }
        // Clamped rather than trusted: gc-overlay REJECTS an opacity outside
        // 0..1, and on a query string a rejected key is skipped — so an
        // out-of-range value would silently draw the reader's default instead
        // of anything the producer set.
        const n = Number.isFinite(raw) ? raw : fallback;
        return `${param}=${Math.min(1, Math.max(0, n))}`;
    }).join('&');
}

const PORT_KEY = (sb, team) => `score.${sb}.player.${team}.port`;
const NAME_KEY = (sb, team) => `score.${sb}.player.${team}.rioName`;

/*
 * A CPU SIDE HAS NO CONTROLLER. Project Rio names the computer's side exactly
 * `CPU` and still reports a port for it — the port of the pad that started the
 * game — so a vs-CPU game drew the one human's controller on BOTH sides. The
 * port is left alone in state (it still tints the scoreboard); only this element
 * reads a CPU side as having nothing to show. The raw `rioName` and not the
 * display override: what Rio says is playing is what decides whether a pad is.
 */
export function isCpuSide(name) {
    return typeof name === 'string' && name.trim().toUpperCase() === 'CPU';
}

export function mountController({ host, sb = 1, team = 1, portOverride = null }) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute; inset:0; overflow:hidden;';
    const frame = document.createElement('iframe');
    frame.setAttribute('allowtransparency', 'true');
    frame.style.cssText = 'width:100%; height:100%; border:0; background:transparent; display:none;';
    wrap.appendChild(frame);
    host.appendChild(wrap);

    const key = PORT_KEY(sb, team);
    const nameKey = NAME_KEY(sb, team);
    let gcBaseUrl = null;     // e.g. http://192.168.1.20:5260/gc, from controller status
    // The URL the iframe currently holds. Tracked whole rather than as a port,
    // because the appearance settings are part of it now and a producer
    // changing one has to reach a source that is already loaded — gc-overlay
    // takes its settings from the query string its client connected with, and
    // this frame is cross-origin, so a reload IS the update mechanism.
    let lastSrc;
    let retry = null;
    let disposed = false;

    /*
     * Where the running gc-overlay is, or '' when it is not running.
     *
     * The status endpoint is the only thing that knows whether anything is
     * serving — nothing is until the producer starts the subprocess from the
     * Connections tab. Its `url` is PATH-ONLY (`/gc`, PRSH's proxy), resolved
     * against the address THIS page was loaded from: an OBS on another
     * machine reached PRSH at its LAN address, and `localhost:8069` — what it
     * used to say — named the OBS machine there, where no reader runs.
     */
    async function resolveGcBaseUrl() {
        try {
            const r = await fetch(`${OverlayBase.BASE_URL}/api/v1/controller/status`);
            if (!r.ok) return '';
            const s = await r.json();
            if (!(s && s.running && s.url)) return '';
            return new URL(s.url, OverlayBase.BASE_URL || location.href).toString().replace(/\/$/, '');
        } catch { return ''; }
    }

    function currentPort(state) {
        // A producer's fixed ?port= is a deliberate pick and outranks the CPU rule.
        if (portOverride != null && !Number.isNaN(portOverride)) return portOverride;
        if (isCpuSide(OverlayBase.deepGet(state, nameKey))) return null;
        const p = OverlayBase.deepGet(state, key);
        return (typeof p === 'number') ? p : null;
    }

    async function update(state) {
        if (disposed) return;
        const port = currentPort(state);

        // No port on this side: nothing to show. Blank rather than keep the last
        // player's controller on screen. The HUD reports ports only once a game
        // is loaded, so BEFORE first pitch the one source of a port is the bound
        // fixture's (Match desk → Port, projected onto this same key) — the note
        // names it, since that is the answer to "why is side 2 empty until the
        // game starts?".
        if (port == null) {
            if (isCpuSide(OverlayBase.deepGet(state, nameKey)) && portOverride == null) {
                OverlayBase.setBlank('This side is the CPU — no controller to show.');
                frame.style.display = 'none';
                frame.src = 'about:blank';
                lastSrc = undefined;
                return;
            }
            OverlayBase.setBlank('No controller port on this side yet — the HUD reports one once a game loads. To show it sooner, set this side’s Port on its match.');
            frame.style.display = 'none';
            frame.src = 'about:blank';
            lastSrc = undefined;
            return;
        }

        if (!gcBaseUrl) {
            gcBaseUrl = await resolveGcBaseUrl();
            if (!gcBaseUrl) {
                // gc-overlay is not up yet — the producer may not have started it.
                // Keep asking, quietly, rather than deciding it never will be.
                //
                // THREE different blanks look identical on a transparent source
                // (no reader, no port, no game), so each says which — the note
                // paints in PREVIEW_MODE and always lands on `data-prsh-blank`.
                OverlayBase.setBlank('The controller reader isn’t running — start it on the Connections tab.');
                frame.style.display = 'none';
                if (retry === null && !disposed) {
                    retry = setTimeout(() => { retry = null; update(OverlayBase.state); }, 2000);
                }
                return;
            }
        }

        /*
         * gc-overlay's `?port=` is 1-INDEXED (its page does `p - 1` and ignores
         * anything outside 1..4), while the HUD — and so
         * `score.{N}.player.{T}.port`, and this mount's own `?port=` override —
         * is 0-indexed. Untranslated, port 0 worked by accident (it failed
         * gc-overlay's range guard and fell back to its default of 0) and every
         * other side showed the WRONG player's controller. The Connections
         * tab's per-port previews already speak gc-overlay's convention; only
         * this path needed it.
         */
        const display = displayParams(OverlayBase.settings, team);
        const src = `${gcBaseUrl}/?port=${port + 1}&${GC_PLUMBING}&${display}`;
        if (src !== lastSrc) {
            lastSrc = src;
            frame.src = src;
        }
        OverlayBase.setBlank(null);
        frame.style.display = '';
    }

    function dispose() {
        disposed = true;
        if (retry !== null) { clearTimeout(retry); retry = null; }
        frame.src = 'about:blank';
        wrap.remove();
    }

    return { update, dispose, shouldRender: (k) => k === key || k === nameKey };
}

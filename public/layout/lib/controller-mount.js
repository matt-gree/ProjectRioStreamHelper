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
    return key === 'overlays.controller' || key.startsWith('overlays.controller.');
}

// The appearance half of the query string.
function displayParams(settings) {
    return DISPLAY_KEYS.map(({ param, key, kind, fallback }) => {
        const raw = OverlayBase.deepGet(settings, `overlays.controller.${key}`, null);
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

export function mountController({ host, sb = 1, team = 1, portOverride = null }) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute; inset:0; overflow:hidden;';
    const frame = document.createElement('iframe');
    frame.setAttribute('allowtransparency', 'true');
    frame.style.cssText = 'width:100%; height:100%; border:0; background:transparent; display:none;';
    wrap.appendChild(frame);
    host.appendChild(wrap);

    const key = PORT_KEY(sb, team);
    let gcBaseUrl = null;     // e.g. http://localhost:8069, from controller status
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
     * The status endpoint is the only thing that knows: the port is a setting,
     * PRSH hunts for a free one near it when it is taken, and nothing is serving
     * at all until the producer starts the subprocess from the Connections
     * tab.
     */
    async function resolveGcBaseUrl() {
        try {
            const r = await fetch(`${OverlayBase.BASE_URL}/api/v1/controller/status`);
            if (!r.ok) return '';
            const s = await r.json();
            return s && s.running && s.url ? s.url : '';
        } catch { return ''; }
    }

    function currentPort(state) {
        if (portOverride != null && !Number.isNaN(portOverride)) return portOverride;
        const p = OverlayBase.deepGet(state, key);
        return (typeof p === 'number') ? p : null;
    }

    async function update(state) {
        if (disposed) return;
        const port = currentPort(state);

        // No port on this side: nothing to show. Blank rather than keep the last
        // player's controller on screen.
        if (port == null) {
            OverlayBase.setBlank('No controller port on this side yet — the HUD reports a port only once a game is loaded.');
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
        const display = displayParams(OverlayBase.settings);
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

    return { update, dispose, shouldRender: (k) => k === key };
}

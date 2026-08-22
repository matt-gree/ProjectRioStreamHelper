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
 * macOS only, because gc-overlay is (AF_UNIX MemoryWatcher sockets). The layouts
 * API omits the whole `controller/` group off-Darwin, so this is never reached
 * there. See the controller-overlay skill.
 */

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
    let lastPort;             // the port the iframe is currently loaded with
    let retry = null;
    let disposed = false;

    /*
     * Where the running gc-overlay is, or '' when it is not running.
     *
     * The status endpoint is the only thing that knows: the port is a setting,
     * PRSH hunts for a free one near it when it is taken, and nothing is serving
     * at all until the producer starts the subprocess from the Controller
     * element's stage panel.
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
            frame.style.display = 'none';
            frame.src = 'about:blank';
            lastPort = undefined;
            return;
        }

        if (!gcBaseUrl) {
            gcBaseUrl = await resolveGcBaseUrl();
            if (!gcBaseUrl) {
                // gc-overlay is not up yet — the producer may not have started it.
                // Keep asking, quietly, rather than deciding it never will be.
                frame.style.display = 'none';
                if (retry === null && !disposed) {
                    retry = setTimeout(() => { retry = null; update(OverlayBase.state); }, 2000);
                }
                return;
            }
        }

        if (port !== lastPort) {
            lastPort = port;
            frame.src = `${gcBaseUrl}/?port=${port}`;
        }
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

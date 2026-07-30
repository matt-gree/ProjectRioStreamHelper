/*
 * container-layers.js — the layer engine behind every shared container.
 *
 * A container is one OBS browser source that hosts whichever of its MEMBERS is
 * fed to it. This module owns the mechanics of that: one retained LAYER per
 * member the container has stood up, a native-size BOX centered inside each
 * layer, and an opacity cross-fade between them.
 *
 * It deliberately knows nothing about OverlayBase, the element mounts, or
 * three.js/GSAP. The registry of members — which mount to stand up, what its
 * update takes, what its native size is — is passed in by `fed-container.js`,
 * which is also where the imports live. That split is what makes this file
 * testable in jsdom against a fake registry (`container-layers.test.js`);
 * everything below used to be an if-chain inside the wiring, where none of it
 * could be reached by a test.
 *
 *   import { createLayers, memberBox, resolveFeed } from '/layout/lib/container-layers.js';
 *
 * REGISTRY CONTRACT — one entry per member id:
 *
 *   size      [w, h] native pixel size. Omit for a member that has no native
 *             size of its own and simply fills whatever it is given.
 *   mount     (box, ctx) => { update, dispose, replay? }. `box` is the sized,
 *             centered element to render into; `ctx` is whatever the caller
 *             passed to `show` (state, perf, …).
 *   payload   (sel) => second argument for `mount.update`. Defaults to the
 *             selection itself; the hit visualizer takes a bare board number.
 *   identity  (sel) => layer key, when one member needs more than one layer.
 *             Defaults to the member id. The hit caches stadium and playback
 *             per board, so a board change has to be a separate mount rather
 *             than an update.
 */

const DEFAULT_FADE_MS = 200;

/*
 * What this container is actually being asked to draw, from three sources of
 * intent in precedence order.
 *
 *   live          the feed key — what is ON AIR in this container.
 *   forceElement  ?feed= — draw THIS occupant whatever the container carries.
 *                 Several members share one container URL, so a gallery preview
 *                 of one of them resolves to the same page as a preview of its
 *                 siblings; without naming the occupant every one of them
 *                 previews as whatever is currently fed. Overrides the element
 *                 only, so the rest of the live selection still applies.
 *   previewSel    ?feedsel= — draw THIS content, whatever (if anything) is fed.
 *                 A pickable member has no live selection until the producer
 *                 picks one, and picking writes the live feed key — i.e. goes ON
 *                 AIR — which made an off-air preview impossible. The console
 *                 hands the STANDING INTENT here instead. Layers over
 *                 forceElement's base: element type comes from ?feed=, content
 *                 fields (board, side, character, role) from here.
 *
 * Both preview inputs are gated on PREVIEW_MODE by the caller, so a source on
 * air always follows the real feed.
 *
 * SCOPE IS APPLIED LAST, and that ordering is the whole point of it. A scoped
 * container source carries its own frame of reference on its URL
 * (`?scoreboard=N&team=T`) and every source of one definition shares ONE feed
 * key — so the feed says WHAT to show and the URL says WHOSE. If a payload
 * field could win, two team-scoped sources of one container would render
 * identically and the mirrored pair that makes one flash the batter and the
 * other the pitcher would collapse into two copies of the same thing.
 */
export function resolveFeed({ live = null, forceElement = null, previewSel = null, scope = null } = {}) {
    const base = forceElement ? { ...(live || {}), element: forceElement } : live;
    const withContent = previewSel ? { ...(base || {}), ...previewSel } : base;
    if (!withContent || !withContent.element) return null;
    return scope ? { ...withContent, ...scope } : withContent;
}

/*
 * The box a member gets inside this container: its own native size, centered.
 *
 * There is no scaling system — OBS does placement — so a member never grows or
 * shrinks to its container. It renders at native size and centers, which is
 * safe for exactly the reason scaling was not: no aspect math, no resampling,
 * no blur.
 *
 * FILL is the fallback for the two cases where a native box would be a lie:
 *
 *   - a member with no declared native size, which means "I am whatever I am
 *     given" (the fluid layouts), and
 *   - a member LARGER than its container, which the console makes
 *     unrepresentable (`fitsContainer`) but a pre-2.0 named shell or a
 *     hand-edited definition can still produce. Filling is what those did
 *     before containers became definitions, so an overflowing member degrades
 *     to its old behaviour instead of being clipped by a box it overflows.
 */
export function memberBox(native, container) {
    const [nw, nh] = Array.isArray(native) ? native : [];
    if (!nw || !nh) return { fill: true };
    const cw = Number(container?.width) || 0;
    const ch = Number(container?.height) || 0;
    // No container size known (a legacy shell whose definition is gone): trust
    // the member's own size rather than guessing from the viewport.
    if (!cw || !ch) return { fill: false, width: nw, height: nh };
    if (nw > cw || nh > ch) return { fill: true, overflow: true };
    return { fill: false, width: nw, height: nh };
}

const CSS = `
.fc-layer {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; pointer-events: none; opacity: 0;
  transition: opacity var(--fc-fade, ${DEFAULT_FADE_MS}ms) ease;
}
.fc-layer[data-active="1"] { opacity: 1; }
.fc-box { position: relative; }
.fc-box.fc-fill { position: absolute; inset: 0; }
`;
/*
 * No `will-change: opacity` on the layers, deliberately. It would pin every one
 * of them to its own composited layer for the life of the page, and a resident
 * composited layer is rastered once and GPU-scaled thereafter — the same thing
 * that made the scoreboard's meld blurry after its first animation. A plain
 * `transition: opacity` promotes only while the fade is running; a settled
 * active layer at opacity 1 is not composited at all.
 */

let _cssInjected = false;
function injectCss(doc) {
    if (_cssInjected) return;
    const style = doc.createElement('style');
    style.id = 'container-layers-css';
    style.textContent = CSS;
    doc.head.appendChild(style);
    _cssInjected = true;
}

// Test seam: the injected stylesheet is module-level, and a jsdom test gets a
// fresh document per file but not a fresh module.
export function _resetCssForTests() { _cssInjected = false; }

/*
 * The layer host for one container.
 *
 * MEMBERS STAY MOUNTED. Swapping used to tear the outgoing member down and
 * build the incoming one, which is a hard cut — and a hard cut is disqualifying
 * for the automation this exists to serve, where a container flips several times
 * an inning. Retaining the layers means the outgoing frame is still there to
 * fade THROUGH, which is what a cross-fade is; it is also what removes the
 * rebuild cost from the swap (the hit visualizer's GL context in particular).
 *
 * Layers are built LAZILY, on first use, rather than eagerly from the roster: a
 * mounted-but-never-shown member costs a GL context or a GSAP timeline for
 * nothing.
 *
 * Only the ACTIVE member is updated. The outgoing one is intentionally left
 * exactly as it was — a cross-fade wants a still frame to fade out of, not a
 * member re-rendering behind its own dissolve — and a hidden member re-reading
 * a HUD feed is pure cost. A member coming back from idle is updated first and
 * then replayed, so it re-enters with its own animation rather than popping in
 * mid-pose.
 */
export function createLayers({
    host, registry, container = null, fadeMs = DEFAULT_FADE_MS,
    doc = typeof document !== 'undefined' ? document : null,
    warn = (...a) => console.warn('[container-layers]', ...a),
    raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : fn()),
} = {}) {
    if (doc) injectCss(doc);
    if (host && fadeMs !== DEFAULT_FADE_MS) host.style.setProperty('--fc-fade', `${fadeMs}ms`);

    const layers = new Map();
    let activeKey = null;
    let disposed = false;
    let zTop = 1;

    const specOf = (element) => (element ? registry[element] : null) || null;

    function keyOf(element, sel) {
        const spec = specOf(element);
        if (!spec) return null;
        return spec.identity ? spec.identity(sel) : element;
    }

    function build(element, key, ctx) {
        const spec = specOf(element);
        const layer = doc.createElement('div');
        layer.className = 'fc-layer';
        layer.dataset.member = element;
        layer.dataset.active = '0';

        const box = doc.createElement('div');
        box.className = 'fc-box';
        const geom = memberBox(spec.size, container);
        if (geom.fill) {
            box.classList.add('fc-fill');
            if (geom.overflow) {
                warn(`"${element}" is ${spec.size[0]}×${spec.size[1]}, larger than this `
                    + `${container.width}×${container.height} container — filling it instead of `
                    + 'centering. Resize the container to its largest member.');
            }
        } else {
            box.style.width = `${geom.width}px`;
            box.style.height = `${geom.height}px`;
        }
        layer.appendChild(box);
        host.appendChild(layer);

        let mount;
        try {
            mount = spec.mount(box, ctx);
        } catch (e) {
            // A member that cannot stand up must not take the container with it:
            // the source stays alive and the next feed still draws.
            warn(`"${element}" failed to mount:`, e);
            layer.remove();
            return null;
        }
        const entry = { key, element, layer, box, mount, spec, everActive: false };
        layers.set(key, entry);
        return entry;
    }

    function activate(key) {
        for (const [k, entry] of layers) {
            const on = k === key;
            entry.layer.dataset.active = on ? '1' : '0';
            // The incoming layer paints over the outgoing one for the duration of
            // the fade. z-index rather than re-appending the node: moving a
            // subtree that owns a WebGL canvas can cost its context.
            if (on) { zTop += 1; entry.layer.style.zIndex = String(zTop); }
        }
        activeKey = key;
    }

    /*
     * Draw `element` with `sel`, cross-fading from whatever was up.
     *
     * The incoming member is updated BEFORE it is revealed, so the fade brings
     * up finished content rather than dissolving into a stale frame and popping.
     * Returns false when the registry has no such member — the caller decides
     * what to say about that.
     */
    async function show(element, sel, ctx = {}) {
        if (disposed) return false;
        const key = keyOf(element, sel);
        if (!key) return false;

        const entry = layers.get(key) || build(element, key, ctx);
        if (!entry) return false;

        const payload = entry.spec.payload ? entry.spec.payload(sel) : sel;
        try {
            await entry.mount.update(ctx.state, payload);
        } catch (e) {
            warn(`"${element}" failed to update:`, e);
        }
        if (disposed) return false;

        if (activeKey !== key) {
            const returning = entry.everActive;
            activate(key);
            entry.everActive = true;
            // A member returning from idle re-enters with its own animation. A
            // freshly built one already played it on mount.
            if (returning && typeof entry.mount.replay === 'function') {
                raf(() => { if (!disposed && activeKey === key) entry.mount.replay(); });
            }
        }
        return true;
    }

    // Nothing fed: fade everything out, keep it all mounted. The container is
    // transparent, which is the honest rendering of an empty container.
    function clear() {
        if (activeKey === null) return;
        for (const entry of layers.values()) entry.layer.dataset.active = '0';
        activeKey = null;
    }

    function dispose() {
        disposed = true;
        for (const entry of layers.values()) {
            try { entry.mount.dispose(); } catch (e) { warn('dispose', e); }
        }
        layers.clear();
        activeKey = null;
        host.replaceChildren();
    }

    // The member on screen, or null. Read by the caller's blank reporting and
    // by the OBS re-show replay, which must replay the ACTIVE member only.
    function active() {
        const entry = activeKey ? layers.get(activeKey) : null;
        return entry ? { element: entry.element, mount: entry.mount } : null;
    }

    return { show, clear, dispose, active, get size() { return layers.size; } };
}

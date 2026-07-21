import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/*
 * A Layout preview: the overlay rendered as a SMALLER BROWSER SOURCE.
 *
 * Shared by Setup (the layout catalog) and the Production stage's preview
 * column.
 *
 * ── The method ──
 *
 * PRSH overlays are resolution-independent by contract: every one of them lays
 * itself out against its viewport and scales to fill it. The bracket runs
 * `autoScale()` off `window.innerWidth/innerHeight`; matchup and the other SVG
 * mounts use a `viewBox` with `preserveAspectRatio`; stats-mount and the
 * postgame mounts compute `min(innerWidth / REF_W, innerHeight / REF_H)`. The
 * bracket's own source comment says it outright: "the body fills whatever OBS
 * browser source size the user picks".
 *
 * So the honest preview is not a scaled picture of a 1920×1080 render — it is
 * an iframe sized to the largest box of the right ASPECT that fits the
 * container, handed to the overlay as its viewport. The overlay then does what
 * it already does for OBS. Nothing is zoomed, transformed, or rasterised at the
 * wrong resolution; text renders at its true size and stays crisp.
 *
 * ── Why not scale a native-size render ──
 *
 * Two earlier attempts failed here, both worth not repeating:
 *
 *   1. `transform: scale()` rasters the iframe layer once at its pre-scale size
 *      and reuses that texture — blurry until something forces a re-raster.
 *   2. `zoom` avoids the blur but does not cleanly give the inner document a
 *      1920-px viewport: the overlay ends up laying out against a viewport that
 *      is neither the native size nor the box size, and draws at the wrong
 *      scale (the matchup band rendering at ~40% of its authored width).
 *
 * Sizing the iframe itself sidesteps both: there is only ever one coordinate
 * system, and it is the one the overlay was built to adapt to.
 *
 * ── The iframe is never created at the wrong size ──
 *
 * Several mounts lay themselves out ONCE at init, so an iframe that starts at
 * one size and is corrected later has already handed them the wrong canvas
 * (previews clipped, gigantic, or blank while the real source is fine). The
 * container is therefore measured in a layout effect BEFORE the iframe is
 * rendered at all — one extra layout pass, no flash, and the document loads
 * into its final viewport.
 *
 * `nativeWidth`/`nativeHeight` supply the aspect. Production always passes the
 * element registry's values — the same numbers `addBrowserSource` gives OBS.
 * Callers that don't know it fall back to measuring the loaded document, which
 * cannot be made reliable on its own: a Layout whose body is `width: 100%` (the
 * bracket) just reports the iframe's current width back at you.
 *
 * ── One sizing authority, and why height is derived from width alone ──
 *
 * This component owns its own box height (`minHeight`/`maxHeight`), rather than
 * sitting inside a wrapper that shapes itself with CSS `aspect-ratio`. Two
 * systems computing the same height is a feedback loop with a ResizeObserver in
 * the middle: the wrapper's `aspect-ratio` wants `width / ratio`, a `max-height`
 * clamps it, the observer re-measures, the iframe resizes, the box re-measures.
 * They agreed until the clamp bit, and then they oscillated — previews clipped
 * at the bottom and right, and the renderer could hang outright.
 *
 * So height is derived from the measured WIDTH only, and the observer ignores
 * height-only changes. Width never depends on height here (the container is a
 * plain block), so the derivation is acyclic by construction and settles in one
 * pass. A caller passing a fixed numeric `height` skips the derivation.
 */

// Setup's preview pane height. Exported because the empty state that stands in
// for the iframe has to reserve exactly the same box, or the panel jumps.
export const DEFAULT_PREVIEW_HEIGHT = 500;

// Overlays paint on transparency over video; a preview pane is opaque, so force
// the document transparent and pin color-scheme (a dark-mode UA sheet would
// otherwise paint a black backdrop behind a light overlay).
function makeTransparent(doc) {
    try {
        doc.documentElement.style.background = 'transparent';
        doc.documentElement.style.colorScheme = 'normal';
        doc.body.style.background = 'transparent';
        let injected = doc.getElementById('__prsh_preview_bg');
        if (!injected) {
            injected = doc.createElement('style');
            injected.id = '__prsh_preview_bg';
            injected.textContent =
                'html,body{background:transparent !important;color-scheme:normal !important;}';
            doc.head.appendChild(injected);
        }
    } catch { /* cross-origin or torn down — the preview still renders */ }
}

// The largest box of `native` aspect that fits inside the container.
export function fitBox(container, native) {
    if (!container || !native) return null;
    const { width: cw, height: ch } = container;
    const { w: nw, h: nh } = native;
    if (!(cw > 0 && ch > 0 && nw > 0 && nh > 0)) return null;
    const scale = Math.min(cw / nw, ch / nh);
    return { w: Math.round(nw * scale), h: Math.round(nh * scale) };
}

/*
 * How much the available width must move before the box is re-shaped.
 *
 * A derived height closes a loop through the document: a taller box makes the
 * page taller, which summons the scrollbar, which narrows the viewport by
 * ~15px, which shortens the box, which dismisses the scrollbar. `index.css`
 * reserves the scrollbar gutter so that cycle cannot start; this threshold is
 * the backstop for any other scroll container (and browsers without
 * `scrollbar-gutter`). It sits above every common scrollbar width and far below
 * any resize a person means. Drift accumulates against the width the height was
 * last computed at, so a slow drag still tracks — it just arrives in steps.
 */
const RESHAPE_THRESHOLD = 24;

// The box height for a given available width: the element's own shape, but
// never so tall it pushes the controls above it off-screen, and never so short
// a wide, flat overlay (a ticker) collapses to a sliver.
export function boxHeight(width, native, minHeight, maxHeight) {
    if (!(width > 0) || !native) return null;
    const ideal = width * (native.h / native.w);
    const lo = minHeight > 0 ? minHeight : 0;
    const hi = maxHeight > 0 ? maxHeight : Infinity;
    return Math.round(Math.min(Math.max(ideal, lo), hi));
}

const ScaledIframe = memo(function ScaledIframe({
    src, nativeWidth, nativeHeight, fallbackWidth, fallbackHeight,
    height, minHeight, maxHeight, title = 'Layout preview',
    className = '', onLoad, onFit,
}) {
    const containerRef = useRef(null);
    const iframeRef = useRef(null);
    const [measured, setMeasured] = useState(null);
    const [box, setBox] = useState(null);
    // Derived height, when the caller lets this component shape its own box.
    // Mirrored in a ref so `recalc` can read the current height without taking
    // it as a dependency — that would rebuild the ResizeObserver on every
    // reshape, and an observer that re-observes as a result of its own callback
    // is the loop wearing a different hat.
    const [derived, setDerived] = useState(null);
    const derivedRef = useRef(null);

    // Memoized: `native` feeds effects that set state, so a fresh object each
    // render would loop.
    const declared = useMemo(
        () => (nativeWidth > 0 && nativeHeight > 0 ? { w: nativeWidth, h: nativeHeight } : null),
        [nativeWidth, nativeHeight],
    );
    const native = declared || measured;

    // A caller-supplied number is the whole story; anything else (including
    // '100%') means the height comes from the container's own CSS.
    // Opting in means naming a bound. Without one there is nothing to clamp
    // against, and a 16:9 overlay at panel width would grow an arbitrarily tall
    // box — so callers that pass neither keep the fixed default pane.
    const shapesOwnBox = height === undefined && (minHeight > 0 || maxHeight > 0);

    // The width the box height was last shaped at, for the drift threshold.
    const shapedAtRef = useRef(null);

    const recalc = useCallback((n) => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        // Height first, and from the WIDTH alone — see the header note. The
        // container's own height is whatever we set last pass, so feeding it
        // back in is exactly the loop this avoids.
        let h = null;
        if (shapesOwnBox && rect.width > 0) {
            const shapedAt = shapedAtRef.current;
            const settled = shapedAt !== null && Math.abs(rect.width - shapedAt) < RESHAPE_THRESHOLD;
            // Below the threshold the box keeps its height; the iframe still
            // re-fits inside it, so the overlay tracks the width either way.
            h = settled ? derivedRef.current : boxHeight(rect.width, n, minHeight, maxHeight);
            if (!settled) shapedAtRef.current = rect.width;
        }
        if (h !== null) {
            derivedRef.current = h;
            setDerived(prev => (prev === h ? prev : h));
        }
        const next = fitBox({ width: rect.width, height: h ?? rect.height }, n);
        // A zero-size container (collapsed panel, hidden tab) would size the
        // iframe to nothing and it would never recover — keep the last good box.
        if (!next) return;
        setBox(prev => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    }, [shapesOwnBox, minHeight, maxHeight]);

    // Layout effect, not a passive one: the box must be known before the
    // browser paints, so the iframe is created exactly once at its final size.
    useLayoutEffect(() => {
        if (native) recalc(native);
    }, [native, recalc]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !native) return undefined;
        // Width-only: a height change is either our own doing or irrelevant,
        // and reacting to it is what let the old two-authority layout oscillate.
        let lastWidth = el.getBoundingClientRect().width;
        const observer = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect?.width ?? el.getBoundingClientRect().width;
            if (Math.abs(w - lastWidth) < 0.5) return;
            lastWidth = w;
            recalc(native);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [native, recalc]);

    const handleLoad = useCallback(() => {
        const readSize = () => {
            const fallback = () => {
                if (fallbackWidth && fallbackHeight) {
                    setMeasured({ w: fallbackWidth, h: fallbackHeight });
                }
            };
            try {
                const doc = iframeRef.current?.contentDocument;
                if (!doc) return fallback();
                makeTransparent(doc);
                // Aspect was declared — never ask the document, and never
                // resize the box out from under a mount that has already laid
                // itself out against this viewport.
                if (declared) return undefined;

                const refW = parseFloat(doc.body.dataset.refW);
                const refH = parseFloat(doc.body.dataset.refH);
                if (refW > 0 && refH > 0) return setMeasured({ w: refW, h: refH });

                const style = doc.defaultView.getComputedStyle(doc.body);
                const cssW = parseFloat(style.width);
                const cssH = parseFloat(style.height);
                const w = cssW > 0 ? cssW : doc.body.scrollWidth;
                const h = cssH > 0 ? cssH : doc.body.scrollHeight;
                if (w > 0 && h > 0) return setMeasured({ w, h });
                return fallback();
            } catch {
                return fallback();
            }
        };
        requestAnimationFrame(readSize);
        onLoad?.();
    }, [declared, fallbackWidth, fallbackHeight, onLoad]);

    // Without a declared aspect the document has to load before it can be
    // measured, so a probe iframe renders at 1px and is swapped for the real
    // one. With a declared aspect (Production, and Setup's catalog) that phase
    // never happens.
    const probing = !native;
    const size = box || native;

    // Report the fit so a caller can state the scale ("1920 × 1080 · 52%").
    // Effect, not render-time, so a parent that stores it can't re-enter the
    // measurement it came from. `onFit` must be stable (useCallback).
    useEffect(() => {
        if (!onFit || !size || !native) return;
        onFit({ w: size.w, h: size.h, nativeW: native.w, nativeH: native.h, scale: size.w / native.w });
    }, [onFit, size, native]);
    // `minHeight` stands in until the first measurement so the box never starts
    // at zero height and shove the layout around on the first paint.
    const boxStyleHeight = shapesOwnBox
        ? (derived ?? minHeight ?? DEFAULT_PREVIEW_HEIGHT)
        : (height ?? DEFAULT_PREVIEW_HEIGHT);

    return (
        <div
            ref={containerRef}
            className={`relative flex w-full items-center justify-center overflow-hidden ${className}`}
            style={{ height: boxStyleHeight }}
        >
            {(size || probing) && (
                <iframe
                    ref={iframeRef}
                    src={src}
                    onLoad={handleLoad}
                    style={{
                        width: size ? `${size.w}px` : '1px',
                        height: size ? `${size.h}px` : '1px',
                        border: 'none',
                        display: 'block',
                        backgroundColor: 'transparent',
                        colorScheme: 'normal',
                        opacity: size ? 1 : 0,
                    }}
                    title={title}
                />
            )}
        </div>
    );
});

export default ScaledIframe;

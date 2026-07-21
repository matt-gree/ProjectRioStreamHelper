import { memo, useCallback, useState } from 'react';
import { RotateCw, Eye, EyeOff } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import ScaledIframe from '../../../components/ScaledIframe';
import { usePersistentState } from '../../../hooks/usePersistentState';
import { instanceUrl } from '../bindings';

/*
 * The stage's preview column — what the selected element actually looks like
 * right now, beside the controls that change it.
 *
 * Before this, the console could tell a producer an overlay was bound, on air
 * and correctly configured, and still not tell them it was drawing nothing. The
 * only way to see an overlay was to look at OBS, which is the surface the
 * console exists to keep you out of mid-broadcast.
 *
 * It renders the LIVE overlay in an iframe against real state — not a mockup —
 * so anything true of the browser source is true here, including the blank
 * notes `OverlayBase.setBlank` renders in PREVIEW_MODE (overlay-authoring
 * skill). That pairing is the point: the panel says why it's empty.
 */

// Which URL to show. When the element is BOUND, preview the producer's actual
// source URL, not the element's canonical one — their source may carry a size
// or team variant, or `?intro=0`, and previewing a URL nobody is broadcasting
// would be a confident lie. Unbound, fall back to what Bind would create.
export function previewUrl(element, board, binding) {
    const base = binding?.item?.url || instanceUrl(element, board);
    if (!base) return null;
    try {
        // Resolved against this origin so a dual-machine rig's source URL
        // (pointing at the PRSH host by IP) still loads in the producer's
        // browser, and so a junk URL throws here rather than in the iframe.
        const u = new URL(base, window.location.origin);
        u.searchParams.set('preview', '1');
        return `${u.pathname}${u.search}`;
    } catch {
        return null;
    }
}

/*
 * The box takes the panel's full width and derives its HEIGHT from the
 * element's own aspect ratio, so a 1920×1080 scene gets a 16:9 frame and an
 * 800×460 band gets a letterbox — each overlay shown in its own shape rather
 * than every overlay squeezed into one arbitrary rectangle.
 *
 * Capped, because the ratio alone would give a 16:9 overlay a ~620px frame at
 * stage width and push the controls above it off-screen. Floored, because a
 * very wide, very short overlay (a ticker) would otherwise collapse to a
 * sliver. The cap is the reason ScaledIframe still letterboxes: it fits to
 * min(width, height), so a capped box just means unused width at the sides.
 *
 * These are handed to ScaledIframe rather than applied here as CSS
 * `aspect-ratio` + `max-height`. That earlier arrangement had the wrapper and
 * the iframe each computing the box height, which agreed right up until the cap
 * engaged (a stage wider than ~995px) and then oscillated — the preview clipped
 * at the bottom and right, and the renderer could hang. One authority only.
 */
const MAX_PREVIEW_HEIGHT = 560;
const MIN_PREVIEW_HEIGHT = 140;

const StagePreview = memo(function StagePreview({ element, board, binding }) {
    const [open, setOpen] = usePersistentState('prsh.ui.production.preview', true);
    // Bumped to force a remount — overlays are static files behind a browser
    // cache, and a producer who just edited a theme wants to see it.
    const [nonce, setNonce] = useState(0);
    const reload = useCallback(() => setNonce(n => n + 1), []);

    // What the producer is actually looking at, in the source's own terms. A
    // preview that fills the panel gives no sense of scale on a wide display —
    // a 1920×1080 scene and an 800×460 band both just look "big" — and the
    // source size is the number they have to type into OBS.
    const [fit, setFit] = useState(null);
    const onFit = useCallback((f) => {
        setFit(prev => (prev && prev.w === f.w && prev.scale === f.scale ? prev : f));
    }, []);

    const src = previewUrl(element, board, binding);
    if (!src) return null;

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <Text size="xs" dimmed className="label-display uppercase tracking-wide">
                    Preview
                </Text>
                {open && fit && (
                    <SimpleTooltip label="Source size in OBS, and how far down the preview is scaled">
                        <Text size="xs" dimmed className="tabular-nums">
                            {fit.nativeW} × {fit.nativeH}
                            <span className="opacity-60"> · {Math.round(fit.scale * 100)}%</span>
                        </Text>
                    </SimpleTooltip>
                )}
                <div className="flex-1" />
                {open && (
                    <SimpleTooltip label="Reload the preview">
                        <button
                            type="button" onClick={reload} aria-label="Reload preview"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <RotateCw size={12} />
                        </button>
                    </SimpleTooltip>
                )}
                <SimpleTooltip label={open ? 'Hide the preview' : 'Show the preview'}>
                    <button
                        type="button" onClick={() => setOpen(!open)}
                        aria-pressed={open} aria-label={open ? 'Hide preview' : 'Show preview'}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                        {open ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                </SimpleTooltip>
            </div>

            {open && (
                <>
                    {/* Checkerboard: overlays are authored on transparency, and
                        a flat backdrop makes a fully-transparent overlay
                        indistinguishable from one that failed to load. */}
                    <div
                        className="w-full overflow-hidden rounded-md border border-border/60"
                        style={{
                            backgroundColor: '#15151c',
                            backgroundImage:
                                'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%),'
                                + 'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%)',
                            backgroundSize: '16px 16px',
                            backgroundPosition: '0 0, 8px 8px',
                        }}
                    >
                        <ScaledIframe
                            key={`${src}#${nonce}`}
                            src={src}
                            // The registry's dimensions are the SAME numbers
                            // addBrowserSource gives OBS, so the preview's
                            // viewport is the source's viewport — which is what
                            // makes it a scale model rather than a guess.
                            nativeWidth={element.width}
                            nativeHeight={element.height}
                            minHeight={MIN_PREVIEW_HEIGHT}
                            maxHeight={MAX_PREVIEW_HEIGHT}
                            onFit={onFit}
                            title={`${element.name} preview`}
                        />
                    </div>
                    <Text size="xs" dimmed>
                        {binding
                            ? `Live — ${binding.item.sourceName} as OBS renders it.`
                            : 'Live — not yet in a scene, so this is what Bind would add.'}
                    </Text>
                </>
            )}
        </div>
    );
});

export default StagePreview;

import { memo, useCallback, useState } from 'react';
import { RotateCw, Eye, EyeOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import ScaledIframe from '../../../components/ScaledIframe';
import { usePersistentState } from '../../../hooks/usePersistentState';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { instanceUrl } from '../bindings';
import { resolveIntent } from '../suggest';
import { introTypeFor } from './intro';

// Stable empty intent — a fresh {} each render would defeat useShallow.
const NO_SEL = Object.freeze({});

/*
 * The content a fed element's preview should draw — the standing intent, as a
 * flat feedsel payload for the container. Only fed elements have one; a direct
 * element or a container row previews live and needs no override. Kept to
 * primitives inside useShallow so it settles instead of firing every tick.
 */
function useFeedSel(element, board, placement) {
    return useStateStore(useShallow((s) => {
        // Only a MEMBER'S SLOT needs the override: the element's own source
        // reads the standing intent itself (the spotlight layout renders
        // `production.feed.last.{id}`), so handing it one would be the preview
        // telling the overlay something it already knows.
        if (!placement?.slot) return NO_SEL;
        const i = resolveIntent(s, element, board || 1);
        if (!i) return NO_SEL;
        return { scoreboard: i.scoreboard ?? 1, team: i.team, charIndex: i.charIndex, role: i.role };
    }));
}

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

/*
 * Which URL to show. When the element is BOUND, preview the producer's actual
 * source URL, not the element's canonical one — their source may carry a size
 * or team variant, or `?intro=0`, and previewing a URL nobody is broadcasting
 * would be a confident lie. Unbound, fall back to what Bind would create.
 *
 * A FED element has no source of its own. It shares a container, and the
 * container draws whichever occupant is fed to it — so every fed element aimed
 * at one resolves to the SAME url, and previewing it plainly shows them all as
 * whatever that container happens to be rendering. Worse, a container in
 * PREVIEW_MODE hardcodes an occupant, so the answer wasn't even the live feed:
 * every Callout Stage preview drew Character Spotlight.
 *
 * `?feed=` is the fix — the preview NAMES the occupant it wants, and the
 * container obliges (see callout-stage.html). A fed element asks for itself; a
 * container row asks for whatever it is currently carrying.
 *
 * `?feedsel=` carries the CONTENT: a pickable element (Character Spotlight) has
 * no live selection until the producer picks one, and picking writes the live
 * container key — i.e. goes on air. So the preview can't lean on the live feed
 * or it stays blank until, and only until, it's too late. Instead it sends the
 * standing intent (suggest.js) — the character Push would show — and the
 * container draws it without touching live state. `feedSel` is that intent.
 *
 * `introDisabled` is the Intro-animation PREFERENCE, and it beats whatever the
 * bound source's url says. The toggle writes the preference and then asks OBS
 * to rewrite its sources; the preference is the part that always lands, so
 * reading the url instead meant the preview didn't budge when OBS was closed —
 * i.e. exactly when the preview is the only way to see the change. Because the
 * param is part of the src, changing it remounts the iframe, which is what
 * makes the difference visible: intro on plays the reveal, intro off doesn't.
 * `null`/undefined means "this element has no intro" — leave the url alone.
 */
/*
 * Takes the PLACEMENT, not the narrowed "binding". The component nulls its
 * binding when there is no scene item (see the note below), which is right for
 * anything read off the item — but the VARIANT belongs to the row whether a
 * source exists or not, and nulling it made the catalog tier's "Scoreboard —
 * Small" preview the Large board. Everything here is already `?.`-guarded, so a
 * sourceless placement reads exactly as `null` used to.
 */
export function previewUrl(element, board, placement, nonce = 0, feedSel = null, introDisabled = null) {
    const binding = placement;
    // No source to read a URL off means the row is an OFFER — the catalog tier's
    // "Scoreboard — Small" — so the variant it is offering has to be written in,
    // or the preview shows the default canvas whatever row you picked.
    const base = binding?.item?.url || instanceUrl(element, board, binding?.variant ?? '');
    if (!base) return null;
    try {
        // Resolved against this origin so a dual-machine rig's source URL
        // (pointing at the PRSH host by IP) still loads in the producer's
        // browser, and so a junk URL throws here rather than in the iframe.
        const u = new URL(base, window.location.origin);
        u.searchParams.set('preview', '1');
        /*
         * WHICH occupant this container should draw. A member's slot asks for
         * itself; a container's own row asks for whatever it is carrying. An
         * element's own dedicated source names nobody — it is not a container,
         * and `?feed=` there would be a param its layout never reads.
         */
        const feed = binding?.slot
            ? element.id
            : (binding?.container ? binding.carrying : null);
        if (feed) u.searchParams.set('feed', feed);
        if (feed && feedSel) u.searchParams.set('feedsel', encodeURIComponent(JSON.stringify(feedSel)));
        if (introDisabled === true) u.searchParams.set('intro', '0');
        else if (introDisabled === false) u.searchParams.delete('intro');
        // Reload has to change the URL, not just remount. Layouts are static
        // files with no build step, so the browser holds them on an etag with no
        // Cache-Control; remounting an iframe at the SAME src can be answered
        // from cache, which is why Reload could leave a just-edited layout
        // looking unchanged. Absent at nonce 0 so the steady-state URL is stable.
        if (nonce) u.searchParams.set('_', String(nonce));
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
// The cap only bites once the stage is wide enough that a 16:9 source would be
// taller than this (~995px of column). Below that the preview is width-limited
// and the cap is irrelevant; above it, 560 was leaving most of a tall window
// empty under the panel for no reason.
const MAX_PREVIEW_HEIGHT = 720;
const MIN_PREVIEW_HEIGHT = 140;

const StagePreview = memo(function StagePreview({ element, board, binding: maybe, width, height }) {
    // Same rule as BindingNote: no item, no binding.
    const binding = maybe?.item ? maybe : null;
    const [open, setOpen] = usePersistentState('prsh.ui.production.preview', true);
    // Bumped to change the url — overlays are static files behind a browser
    // cache, and a producer who just edited a theme wants to see it. A NEW url
    // is what forces the fetch; the iframe itself is deliberately NOT remounted
    // (see the note on the ScaledIframe below).
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

    // A fed element previews the character Push would show, not the live feed
    // (which is empty until a pick, and a pick is on-air). `team == null` means
    // no intent — nothing captured/rostered yet — so send no override and let
    // the container render its own empty state.
    const feedSel = useFeedSel(element, board, maybe);
    // The Intro toggle's preference, not the source url's — see previewUrl.
    // `null` for an element with no intro, so the url is left untouched.
    const introDisabled = useSettingsStore(s => (introTypeFor(element)
        ? !!s?.overlays?.[introTypeFor(element)]?.disableIntro
        : null));
    // The full placement, not `binding` — see previewUrl: the variant is the
    // row's own, and survives having no source.
    const src = previewUrl(
        element, board, maybe, nonce,
        feedSel.team != null ? feedSel : null,
        introDisabled,
    );
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
                        {/* No `key` on the nonce. Keying this remounted the
                            whole ScaledIframe, and a fresh one starts with no
                            derived height — so the box collapsed from up to
                            560px to `minHeight` for exactly as long as it took
                            the layout effect to measure. No paint happens at
                            that height, but LAYOUT does, and the browser clamps
                            scrollTop against the shorter page the instant it
                            does: hitting Reload threw the console back to the
                            top. Assigning a new `src` to a mounted iframe
                            navigates it just as thoroughly, and the box never
                            changes size. */}
                        <ScaledIframe
                            src={src}
                            // Reload also re-measures. Remounting used to do
                            // that as a side effect; now that it doesn't, a box
                            // left small by a measurement taken while the panel
                            // was mid-layout would have no way back — and the
                            // reshape threshold means a later resize under 24px
                            // won't fix it either.
                            measureKey={nonce}
                            // The registry's dimensions are the SAME numbers
                            // addBrowserSource gives OBS, so the preview's
                            // viewport is the source's viewport — which is what
                            // makes it a scale model rather than a guess.
                            // Overridable because a CONTAINER row's element is
                            // synthesised from its URL and carries no dimensions
                            // — the layout catalog holds a container's native
                            // size, and the stage passes it in.
                            nativeWidth={width ?? element.width}
                            nativeHeight={height ?? element.height}
                            minHeight={MIN_PREVIEW_HEIGHT}
                            maxHeight={MAX_PREVIEW_HEIGHT}
                            onFit={onFit}
                            title={`${element.name} preview`}
                        />
                    </div>
                    <Text size="xs" dimmed>
                        {!binding
                            ? 'Live — not yet in a scene, so this is what Bind would add.'
                            : binding.parent
                                ? `Live — ${binding.item.sourceName}, carrying this.`
                                : `Live — ${binding.item.sourceName} as OBS renders it.`}
                    </Text>
                </>
            )}
        </div>
    );
});

export default StagePreview;

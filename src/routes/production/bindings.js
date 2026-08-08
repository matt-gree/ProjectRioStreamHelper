import { useObsStore } from '../../context/obs';
import { stageOrRun, usePending } from '../../context/staging';
import { sizeOptionFor } from './elements';
import { variantParams } from './instances';

/*
 * What is left of the OBS binding layer: creating a source's URL, toggling one,
 * and displaying its staged state.
 *
 * SEARCHING for an element's source used to live here — `boundIn`,
 * `elementBindings`, `useElementBindings`, and a lone-candidate retry to cope
 * with a source the loose type regex couldn't pin to a board. All of it is gone.
 * The console derives rows from the scenes themselves now (./placements), so a
 * row already HAS its scene item and nothing has to go looking; the surfaces are
 * handed the placement they command instead of each resolving one of their own.
 * `useBindingScenes` (program + preview only) went with them — ./placements
 * enumerates every scene the console can see, and narrowing to two was the
 * assumption scene grouping replaced.
 */

/*
 * The element's canonical URL qualified to one board — what Bind creates, and
 * what the stage previews when there is no source to preview instead.
 *
 * Only `scope: 'board'` elements take the param. A Lower Third has no board, so
 * writing `?scoreboard=2` onto it would invent a distinction the overlay does
 * not have.
 */
export function instanceUrl(element, board, variant = '') {
    if (!element?.url) return element?.url;
    const parts = [];
    if (element.scope === 'board' && board != null) parts.push(`scoreboard=${board}`);
    // The variant the ROW is offering, written back into the URL. Online this
    // travels the other way — the variant is read off a source that exists —
    // but a catalog row is an offer, not a discovery, so "Scoreboard — Small"
    // has to be able to produce ?size=s or Copy hands over the Large board.
    for (const [param, value] of variantParams(variant)) parts.push(`${param}=${value}`);
    if (!parts.length) return element.url;
    const sep = element.url.includes('?') ? '&' : '?';
    return `${element.url}${sep}${parts.join('&')}`;
}

/*
 * The native size of one placement — the element's, unless the row is a VARIANT
 * that has its own canvas. The scoreboard's three sizes are three different
 * browser sources (388×156 / 600×200 / 800×460), so a strip offering to copy
 * "Scoreboard — Small" has to quote Small's dimensions, not the element's
 * default. Every other element answers with exactly what it did before.
 */
export function placementDims(placement) {
    const el = placement?.element;
    const opt = sizeOptionFor(el, placement?.variant);
    return { width: opt?.width ?? el?.width, height: opt?.height ?? el?.height };
}

/*
 * The same URL, host-qualified for pasting into a browser source by hand.
 *
 * This is the OBS-INDEPENDENT path, and it is the only thing the strip can offer
 * when nothing is connected: the producer's OBS may be on another machine, be a
 * different app entirely, or just not be running yet. It resolves against the
 * origin the console is already served from, which is by definition a host that
 * can reach PRSH.
 */
export function absoluteOverlayUrl(url) {
    if (!url) return '';
    try { return new URL(url, window.location.origin).toString(); } catch { return url; }
}

// Toggle an OBS source's visibility through the confirm-to-live buffer. The
// pending key is the (scene, item) pair, so flipping the same switch twice
// cancels out (liveValue match drops the entry).
export function setSourceVisibility(sceneName, item, enabled) {
    stageOrRun({
        key: `obs:${sceneName}:${item.id}`,
        label: `${enabled ? 'Show' : 'Hide'} ${item.sourceName}`,
        value: enabled,
        liveValue: item.enabled,
        run: () => useObsStore.getState().setSceneItemEnabled(sceneName, item.id, enabled),
    });
}

// What a visibility control should DISPLAY for a source: the staged value if
// one is pending, else OBS truth — plus the staged flag for amber styling.
export function useDisplayedEnabled(sceneName, item) {
    const pending = usePending(item ? `obs:${sceneName}:${item.id}` : '∅');
    if (!item) return { enabled: false, staged: false };
    return { enabled: pending ? pending.value : item.enabled, staged: !!pending };
}

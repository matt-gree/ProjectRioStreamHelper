import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
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

/*
 * Take a source out of one scene, through the same confirm-to-live buffer.
 *
 * It stages like visibility does, and for the same reason: confirm mode's whole
 * promise is that nothing done on this page reaches the broadcast until the
 * producer says so, and removing a source that is on air reaches it hard. The
 * row's popover and the pending bar answer different questions — the popover
 * says what you lose, the commit says when it lands.
 *
 * Keyed by (scene, item) like every other control on that source, so a staged
 * removal and a staged visibility flip on the same item can't both sit in the
 * queue describing different futures — the later one replaces the earlier.
 */
const removalKey = (sceneName, item) => `obs:remove:${sceneName}:${item.id}`;

export function removeSourceFromScene(sceneName, item) {
    stageOrRun({
        key: removalKey(sceneName, item),
        label: `Remove ${item.sourceName} from ${sceneName}`,
        value: true,
        // NO liveValue, and its own key namespace — both for the same reason.
        // A removal is not a two-state control that can be staged back to where
        // it started: there is no "un-remove" click, so there is nothing for the
        // toggled-twice collapse to catch. Sharing visibility's key gave a
        // HIDDEN source `value === liveValue === false` and the buffer threw the
        // removal away as a no-op — a producer confirming the popover, pressing
        // Go Live, and watching nothing happen.
        run: () => useObsStore.getState().removeSceneItem(sceneName, item.id),
    });
}

// Whether a removal is sitting in the confirm buffer for this source — the row
// keeps its trash amber until the commit, like every other staged control.
export function useRemovalStaged(sceneName, item) {
    return !!usePending(item ? removalKey(sceneName, item) : '∅');
}

/*
 * The other scenes holding this same source — what the remove confirm needs to
 * state its consequence, since removing one placement of a source that lives in
 * three scenes costs nothing at all.
 *
 * `complete` is the honest half. The mirror is LAZY (obs.jsx mirrorScene): a
 * scene the producer has never expanded has no items here, so an empty `scenes`
 * means "none that we can see", not "none". Only when every scene OBS lists has
 * been mirrored can the confirm promise that this is the last copy — otherwise
 * it hedges, because the difference is whether the producer loses the source's
 * hand-set transform.
 */
export function useOtherScenesWith(sourceName, exceptScene) {
    // The selector hands back the store's OWN references and the census is
    // derived here. Building the array inside the selector returns a fresh
    // object every call, which useShallow compares by reference one level down
    // — so it never settles and the row re-renders until React gives up.
    const { sceneItems, scenes, mirroredScenes } = useObsStore(useShallow(s => ({
        sceneItems: s.sceneItems, scenes: s.scenes, mirroredScenes: s.mirroredScenes,
    })));
    return useMemo(() => {
        const others = [];
        for (const [scene, items] of Object.entries(sceneItems)) {
            if (scene === exceptScene) continue;
            if (items.some(it => it.sourceName === sourceName)) others.push(scene);
        }
        return {
            scenes: others,
            complete: scenes.every(n => mirroredScenes.includes(n)),
        };
    }, [sceneItems, scenes, mirroredScenes, sourceName, exceptScene]);
}

// What a visibility control should DISPLAY for a source: the staged value if
// one is pending, else OBS truth — plus the staged flag for amber styling.
export function useDisplayedEnabled(sceneName, item) {
    const pending = usePending(item ? `obs:${sceneName}:${item.id}` : '∅');
    if (!item) return { enabled: false, staged: false };
    return { enabled: pending ? pending.value : item.enabled, staged: !!pending };
}

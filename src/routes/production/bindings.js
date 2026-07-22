import { useObsStore } from '../../context/obs';
import { stageOrRun, usePending } from '../../context/staging';

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
export function instanceUrl(element, board) {
    if (element.scope !== 'board' || board == null) return element.url;
    return `${element.url}?scoreboard=${board}`;
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

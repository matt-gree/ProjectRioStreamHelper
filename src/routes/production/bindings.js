import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useObsStore } from '../../context/obs';
import { useSettingsStore } from '../../context/store';
import { stageOrRun, usePending } from '../../context/staging';
import { paramsMatch } from '../../lib/obs-binding';

/*
 * OBS binding layer shared by the Production page's surfaces (rack, stage,
 * rail, and the legacy card grid). Elements bind to OBS sources by URL match
 * in the PROGRAM scene first, then the STUDIO PREVIEW scene — so an element
 * staged in preview is still visible and controllable before it is ever
 * taken to air. Moved verbatim out of production.jsx (console slice 3).
 */

// The scenes an element may bind into, in priority order: program first, then
// the studio-preview scene (when Studio Mode is on). Items are pre-filtered to
// PRSH overlays.
export function useBindingScenes() {
    const { studioMode, programScene, previewScene, sceneItems } = useObsStore(useShallow(s => ({
        studioMode: s.studioMode,
        programScene: s.programScene,
        previewScene: s.previewScene,
        sceneItems: s.sceneItems,
    })));
    return useMemo(() => {
        const out = [];
        if (programScene) {
            out.push({
                scene: programScene, where: 'program',
                items: (sceneItems[programScene] || []).filter(i => i.isPrsh),
            });
        }
        if (studioMode && previewScene && previewScene !== programScene) {
            out.push({
                scene: previewScene, where: 'preview',
                items: (sceneItems[previewScene] || []).filter(i => i.isPrsh),
            });
        }
        return out;
    }, [studioMode, programScene, previewScene, sceneItems]);
}

/*
 * The OBS source an element drives within one scene's items, or null.
 *
 * TYPE then INSTANCE. `element.match()` is a loose regex — it tolerates a
 * different host, `?intro=0`, `/scoreboard2/` — which is what makes binding
 * work without manual wiring, but it cannot tell board 1's scoreboard from
 * board 2's. Two of those in one scene and a bare `.find()` drives whichever
 * OBS happens to list first. So: filter to the type, then discriminate on the
 * instance params (`src/lib/obs-binding.js`), which is the same comparison the
 * Setup tab has always made.
 *
 * `lenient` skips the instance check — the lone-candidate retry that
 * elementBindings owns (it is the only caller that can see every scene, and the
 * count only means anything across all of them).
 *
 * Fed elements are exempt: they bind to a SHARED CONTAINER, which is
 * board-agnostic by design (the board rides in the feed payload, not the URL).
 */
export function boundIn(element, items, overrideName, board, lenient = false) {
    const typed = items.filter(it => element.match(it.url || ''));
    if (element.flavor === 'direct') {
        if (lenient) return typed[0] || null;
        const want = instanceUrl(element, board);
        return typed.find(it => paramsMatch(want, it.url || '')) || null;
    }
    const targetName = overrideName || typed[0]?.sourceName || '';
    return items.find(it => it.sourceName === targetName) || null;
}

// Every source of this element's type across the tracked scenes — the count
// that decides whether there is an ambiguity worth being strict about.
const candidates = (element, scenes) =>
    scenes.flatMap(sc => sc.items.filter(it => element.match(it.url || '')));

/*
 * The element's canonical URL qualified to one board — what we compare a
 * producer's source against, and what Bind creates.
 *
 * Only `scope: 'board'` elements take the param. A Lower Third has no board, so
 * writing `?scoreboard=2` onto it would invent a distinction the overlay does
 * not have and unbind the producer's perfectly good source.
 */
export function instanceUrl(element, board) {
    if (element.scope !== 'board' || board == null) return element.url;
    return `${element.url}?scoreboard=${board}`;
}

// Pure form of useElementBindings for a pre-read scene list — lets a parent
// (the rack) derive every element's bindings in one pass without a hook per
// element. Same shape: { program, preview, primary }.
export function elementBindings(element, scenes, overrideName, board, lenient = false) {
    let program = null, preview = null;
    for (const sc of scenes) {
        const item = boundIn(element, sc.items, overrideName, board, lenient);
        if (!item) continue;
        const b = { item, scene: sc.scene, where: sc.where };
        if (sc.where === 'program') program = b; else preview = b;
    }
    if (!program && !preview && !lenient && element.flavor === 'direct'
        && candidates(element, scenes).length === 1) {
        // Nothing answered to the board we asked for, and there is exactly one
        // source of this type anywhere — so there is no ambiguity to protect
        // against, and refusing to bind would just break a rig whose single
        // scoreboard source happens to carry a board we didn't ask for. Retry
        // loosely. Judged across ALL scenes, not per scene: a board-1 source in
        // program must not win while the board 2 we asked for sits in preview.
        return elementBindings(element, scenes, overrideName, board, true);
    }
    return { program, preview, primary: program || preview };
}

// Where an element's source lives across program + preview. `primary` is the
// binding its controls act on (program wins); program/preview expose per-scene
// presence for the status dot.
export function useElementBindings(element, board) {
    const overrideName = useSettingsStore(s => s?.production?.overrides?.[element.id]);
    const scenes = useBindingScenes();
    return useMemo(
        () => elementBindings(element, scenes, overrideName, board),
        [scenes, element, overrideName, board],
    );
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

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useObsStore } from '../../context/obs';
import { useSettingsStore } from '../../context/store';
import { stageOrRun, usePending } from '../../context/staging';

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

// The OBS source an element drives within one scene's items, or null.
// Direct: the URL match. Fed: the override target, else the default URL match.
export function boundIn(element, items, overrideName) {
    if (element.flavor === 'direct') return items.find(it => element.match(it.url || '')) || null;
    const defaultName = items.find(it => element.match(it.url || ''))?.sourceName;
    const targetName = overrideName || defaultName || '';
    return items.find(it => it.sourceName === targetName) || null;
}

// Pure form of useElementBindings for a pre-read scene list — lets a parent
// (the rack) derive every element's bindings in one pass without a hook per
// element. Same shape: { program, preview, primary }.
export function elementBindings(element, scenes, overrideName) {
    let program = null, preview = null;
    for (const sc of scenes) {
        const item = boundIn(element, sc.items, overrideName);
        if (!item) continue;
        const b = { item, scene: sc.scene, where: sc.where };
        if (sc.where === 'program') program = b; else preview = b;
    }
    return { program, preview, primary: program || preview };
}

// Where an element's source lives across program + preview. `primary` is the
// binding its controls act on (program wins); program/preview expose per-scene
// presence for the status dot.
export function useElementBindings(element) {
    const overrideName = useSettingsStore(s => s?.production?.overrides?.[element.id]);
    const scenes = useBindingScenes();
    return useMemo(
        () => elementBindings(element, scenes, overrideName),
        [scenes, element, overrideName],
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

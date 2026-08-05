// Design-package tier — which elements the active package paints ITSELF.
//
// A theme SVG declares `data-design-vars="app"` on its root to be painted by the
// user's Design-tab knobs (a TOKEN SKIN, e.g. `classic`). Without it, it brings
// a fixed palette and the mount CLEARS those vars instead — the `usesAppVars`
// branch every SVG mount runs. So under a FULL-ART element the app-palette
// settings are not merely overridden, they are unreachable, and a control that
// cannot change anything does not belong on the panel.
//
// THE TIER IS PER ELEMENT, NEVER PER PACKAGE. `classic` is the token skin and
// still ships a full-art `callout.svg`, and ships no `statscard` at all — an
// element a package omits falls back element-by-element to `default`, which is
// full-art throughout. "Is this package customisable" would therefore be wrong
// in both directions, which is why nothing here asks it.
//
// The list is fetched once and cached for the session: packages are folders on
// disk, so it only changes on an install or uninstall, and the Design tab calls
// invalidateDesignPackages() there.

import { useEffect, useReducer } from 'react';
import { useSettingsStore } from '../../context/store';

const FALLBACK_PACKAGE = 'default';

let cache = null;        // resolved list, or null = not known yet
let inflight = null;
const listeners = new Set();

function load() {
    if (cache || inflight) return inflight;
    inflight = fetch('/api/v1/design/packages')
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])
        .then((list) => {
            cache = Array.isArray(list) ? list : [];
            inflight = null;
            for (const fn of listeners) fn();
            return cache;
        });
    return inflight;
}

export function invalidateDesignPackages() {
    cache = null;
    inflight = null;
    for (const fn of listeners) fn();
    if (listeners.size) load();
}

/** The installed packages, or null until the first fetch lands. */
export function useDesignPackages() {
    const [, bump] = useReducer(x => x + 1, 0);
    useEffect(() => {
        listeners.add(bump);
        load();
        return () => { listeners.delete(bump); };
    }, []);
    return cache;
}

/**
 * Is `themeElement` painted by the app's palette under `activeId`?
 *
 * Mirrors the engine's resolution: the active package if it themes the element,
 * else `default`. Anything unknown — the list hasn't loaded, the package is
 * missing from disk, no package themes this element — answers TRUE. Showing a
 * setting that turns out to be inert costs a producer a confusing knob; hiding
 * one that was live costs them a control they can no longer reach, and there is
 * no affordance to tell them where it went.
 *
 * @param packages     from useDesignPackages(), or null
 * @param activeId     overlays.global.designPackage
 * @param themeElement the package's file stem for this element ('statscard', …)
 */
export function paintedByApp(packages, activeId, themeElement) {
    if (!packages || !themeElement) return true;
    const byId = id => packages.find(p => p.id === id);
    const owner = [byId(activeId), byId(FALLBACK_PACKAGE)]
        .find(p => p?.elements?.includes(themeElement));
    if (!owner) return true;
    return (owner.appVarElements ?? []).includes(themeElement);
}

/** paintedByApp() against the live settings store, for a component. */
export function usePaintedByApp(themeElement) {
    const active = useSettingsStore(s => s?.overlays?.global?.designPackage) ?? FALLBACK_PACKAGE;
    return paintedByApp(useDesignPackages(), active, themeElement);
}

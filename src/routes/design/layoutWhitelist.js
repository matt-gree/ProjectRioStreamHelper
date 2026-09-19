// Which global design keys each layout DECLARES it honours.
//
// The declaration is the layout's own `<meta name="overlay-settings">` — the
// mount's statement about itself, parsed server-side into `supportedSettings`
// on every catalog entry (server/api/v1/layouts.py). Read back rather than
// duplicated here: a second copy of a whitelist is how a mount ends up
// honouring a key the console never offers, or offering one it ignores.
//
// THE WHITELIST IS NECESSARY BUT NOT SUFFICIENT, because it answers a different
// question than an override needs. It says which GLOBAL keys a layout honours;
// an override asks whether a pin on ONE element can reach it. Both post-game
// callouts declare `accentColor, bodyFont, monoFont` and honour them for real — reading
// `overlays.global.*` straight out of settings — but neither calls
// `applyDesignSettings`, which is the only code that ever consults
// `overlays.{type}.{key}`. So a key is offered as an override only where the
// whitelist AND `OVERRIDE_CAPABLE_TYPES` (designConstants.js) agree.
//
// Cached for the session with the same shape as ./designPackage.js: one fetch,
// listeners for the components that asked, and null until it lands. The
// catalog changes only when a layout file is added or removed, which does not
// happen while the app is up.

import { useEffect, useReducer } from 'react';

let cache = null;        // { [layoutType]: string[] }, or null = not known yet
let inflight = null;
const listeners = new Set();

function index(list) {
    const out = {};
    for (const entry of Array.isArray(list) ? list : []) {
        // Size and side variants are separate entries off ONE file, so they all
        // report the same whitelist — first one wins and the rest agree.
        if (!entry?.type || out[entry.type] || !entry.supportedSettings) continue;
        out[entry.type] = entry.supportedSettings;
    }
    return out;
}

function load() {
    if (cache || inflight) return inflight;
    inflight = fetch('/api/v1/layouts')
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])
        .then((list) => {
            cache = index(list);
            inflight = null;
            for (const fn of listeners) fn();
            return cache;
        });
    return inflight;
}

export function invalidateLayoutWhitelist() {
    cache = null;
    inflight = null;
    for (const fn of listeners) fn();
    if (listeners.size) load();
}

/** `{ [layoutType]: string[] }`, or null until the first fetch lands. */
export function useLayoutWhitelists() {
    const [, bump] = useReducer(x => x + 1, 0);
    useEffect(() => {
        listeners.add(bump);
        load();
        return () => { listeners.delete(bump); };
    }, []);
    return cache;
}

/**
 * Does `layoutType` declare any of `metaNames`?
 *
 * Unknown answers FALSE — the opposite of ./designPackage.js's rule, and for
 * the opposite reason. There, an unknown would hide a control the producer
 * already had; here it would CONJURE one, and an override row that writes a key
 * its mount never reads is a setting that silently does nothing. A layout with
 * no `<meta>` at all is making no claim, so it gets no override rows.
 */
export function declaresAny(whitelists, layoutType, metaNames) {
    const declared = whitelists?.[layoutType];
    if (!declared) return false;
    return metaNames.some(name => declared.includes(name));
}

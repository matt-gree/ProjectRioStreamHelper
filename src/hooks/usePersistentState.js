import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Every mounted hook on the same key, so a write from one reaches the others.
 *
 * Two components reading one key is normal here — the console's board pick is
 * read by the stage panel, its header strip and the rail card at once — and
 * without this they would each hold a private copy: the producer changes the
 * board on the stage, and the header strip goes on commanding the old one until
 * something happens to remount it. Same key, same value, always.
 */
const subscribers = new Map();

function broadcast(key, value, self) {
    for (const fn of subscribers.get(key) || []) if (fn !== self) fn(value);
}

/**
 * Drop-in replacement for useState that remembers the value across unmounts
 * and app restarts via localStorage. Intended for local UI preferences — e.g.
 * which sub-tab of a page the user last had open — NOT for anything that
 * belongs in shared server state (which every client and OBS source sees).
 *
 * @param {string} key         Stable localStorage key (namespace it, e.g. "prsh.ui.…").
 * @param {*}      defaultValue Fallback when nothing is stored / storage fails.
 * @param {(v:any)=>boolean} [isValid] Optional guard. A stored value that fails
 *        it is discarded in favor of defaultValue — guards against stale enums
 *        (a tab that no longer exists, a mode not available in this build).
 * @returns {[any, (next:any)=>void]} Same shape as useState.
 */
export function usePersistentState(key, defaultValue, isValid) {
    const [value, setValue] = useState(() => {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) return defaultValue;
            const parsed = JSON.parse(raw);
            if (isValid && !isValid(parsed)) return defaultValue;
            return parsed;
        } catch {
            return defaultValue;
        }
    });

    useEffect(() => {
        if (!subscribers.has(key)) subscribers.set(key, new Set());
        const subs = subscribers.get(key);
        subs.add(setValue);
        return () => {
            subs.delete(setValue);
            if (!subs.size) subscribers.delete(key);
        };
    }, [key]);

    // The updater form needs the current value, and broadcasting must not happen
    // inside a setState reducer (React may run it twice) — so hold the latest in
    // a ref and do both from the event handler.
    const latest = useRef(value);
    latest.current = value;

    const set = useCallback((next) => {
        const resolved = typeof next === 'function' ? next(latest.current) : next;
        try {
            localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
            // Ignore quota / private-mode failures — persistence is best-effort.
        }
        latest.current = resolved;
        setValue(resolved);
        broadcast(key, resolved, setValue);
    }, [key]);

    return [value, set];
}

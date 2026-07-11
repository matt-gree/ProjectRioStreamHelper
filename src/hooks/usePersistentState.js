import { useCallback, useState } from 'react';

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

    const set = useCallback((next) => {
        setValue(prev => {
            const resolved = typeof next === 'function' ? next(prev) : next;
            try {
                localStorage.setItem(key, JSON.stringify(resolved));
            } catch {
                // Ignore quota / private-mode failures — persistence is best-effort.
            }
            return resolved;
        });
    }, [key]);

    return [value, set];
}

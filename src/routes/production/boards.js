import { useSettingsStore } from '../../context/store';

/*
 * Board (scoreboard) helpers for the console surfaces.
 *
 * The fallback array is module-level on purpose: a selector that writes
 * `?? [1]` inline returns a NEW array identity on every store read, so
 * zustand's Object.is comparison never matches and the component re-renders
 * forever — fatal when it feeds a setState effect (the Capture desk's
 * "selected board still active?" check). Keep the constant.
 */
const DEFAULT_ACTIVE = [1];

export function useActiveBoards() {
    const active = useSettingsStore(s => s?.scoreboards?.active);
    return Array.isArray(active) && active.length ? active : DEFAULT_ACTIVE;
}

// Producer-facing board name: the alias when one is set, else "Scoreboard N".
export function useBoardLabel() {
    const aliases = useSettingsStore(s => s?.scoreboards?.aliases);
    return (n) => aliases?.[n] || aliases?.[String(n)] || `Scoreboard ${n}`;
}

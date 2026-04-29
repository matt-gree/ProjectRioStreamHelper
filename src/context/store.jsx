import { create } from "zustand";
import { assocPath, dissocPath, path as rPath } from "ramda";

// Module-level socket reference, set by SocketProvider on mount.
// This avoids calling useSocket() (a React hook) inside Zustand actions.
let _socketRef = null;
export const setSocketRef = (ref) => { _socketRef = ref; };

export const useStateStore = create((set, get) => ({
    loaded: false,
    setLoaded: (loaded=true) => set({ loaded }),
    setItem: (key, value, emit=true) => {
        set(state => assocPath(key.split("."), value, state));
        if(emit && _socketRef) {
            _socketRef.emit('v1.state.set', { key, value });
        }
    },
    setItems: (entries, emit=true) => {
        set(state => {
            let s = state;
            for (const { key, value } of entries) {
                s = assocPath(key.split("."), value, s);
            }
            return s;
        });
        if(emit && _socketRef) {
            for (const { key, value } of entries) {
                _socketRef.emit('v1.state.set', { key, value });
            }
        }
    },
    getItem: (key, defaultValue=undefined) => {
        const val = rPath(key.split("."), get());
        return val !== undefined ? val : defaultValue;
    },
    deleteItem: (key, emit=true) => {
        set(state => dissocPath(key.split("."), state));
        if(emit && _socketRef) {
            _socketRef.emit('v1.state.unset', { key });
        }
    },
    deleteItems: (keys, emit=true) => {
        set(state => {
            let s = state;
            for (const key of keys) {
                s = dissocPath(key.split("."), s);
            }
            return s;
        });
        if(emit && _socketRef) {
            for (const key of keys) {
                _socketRef.emit('v1.state.unset', { key });
            }
        }
    },
    mergeItems: (items) => set(items)
}));

export const useSettingsStore = create((set, get) => ({
    loaded: false,
    setLoaded: (loaded=true) => set({ loaded }),
    setItem: (key, value, emit=true) => {
        set(state => assocPath(key.split("."), value, state));
        if(emit && _socketRef) {
            _socketRef.emit('v1.settings.set', { key, value });
        }
    },
    getItem: (key, defaultValue=undefined) => {
        const val = rPath(key.split("."), get());
        return val !== undefined ? val : defaultValue;
    },
    deleteItem: (key, emit=true) => {
        set(state => dissocPath(key.split("."), state));
        if(emit && _socketRef) {
            _socketRef.emit('v1.settings.unset', { key });
        }
    },
    mergeItems: (items) => set(items)
}));

export const useConfigStore = create((set) => ({
    loaded: false,
    setLoaded: (loaded=true) => set({ loaded }),
    setItem: (key, value) => set(
        state => assocPath(key.split("."), value, state)
    ),
    mergeItems: (items) => set(items)
}));

// Bracket tab UI state — persists across tab switches (not synced to server)
export const useBracketStore = create((set) => ({
    tournament: null,
    phases: [],
    selectedPhase: null,
    selectedPool: null,
    sets: [],
    setsPage: 1,
    setsTotalPages: 0,
    includeFinished: false,
    loadedSets: {},
    entrants: [],
    entrantsPage: 1,
    entrantsTotalPages: 0,
    showEntrants: false,
    // Per-phase sets cache. Keyed by `${phaseId}|${poolId}|${includeFinished}`.
    // Means revisiting a phase is genuinely instant — no server round-trip,
    // no empty-table flash while we wait, no spinner.
    setsByKey: {},
    update: (partial) => set(partial),
}));

export const useStoresLoaded = () => {
    const stateLoaded = useStateStore(state => state.loaded);
    const settingsLoaded = useSettingsStore(state => state.loaded);
    const configLoaded = useConfigStore(state => state.loaded);
    return stateLoaded && settingsLoaded && configLoaded;
};

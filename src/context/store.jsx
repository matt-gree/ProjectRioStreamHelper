import { create } from "zustand";
import { assocPath, dissocPath, path as rPath } from "ramda";

// Module-level socket reference, set by SocketProvider on mount.
// This avoids calling useSocket() (a React hook) inside Zustand actions.
let _socketRef = null;
export const setSocketRef = (ref) => { _socketRef = ref; };

/*
 * A server snapshot REPLACES the data, it does not merge into it. The snapshot
 * is re-taken on every reconnect, and anything the server removed while we were
 * away (an unbound board, a deleted match) is exactly what a merge would keep.
 * The store's own members — its actions and `loaded` — are not data and survive.
 */
const replaceData = (set) => (items) => set(state => {
    const own = {};
    for (const [k, v] of Object.entries(state)) {
        if (typeof v === 'function' || k === 'loaded') own[k] = v;
    }
    return { ...items, ...own };
}, true);

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
        if(emit && _socketRef && entries.length > 0) {
            // One frame, one disk commit on the server. Without this we'd
            // emit N individual `v1.state.set` events for a single UI batch
            // (e.g. swap teams = 9 frames + 9 atomic state.json writes).
            _socketRef.emit('v1.state.set_batch', {
                items: entries.map(({ key, value }) => ({ key, value })),
            });
        }
    },
    getItem: (key, defaultValue=undefined) => {
        const val = rPath(key.split("."), get());
        return val !== undefined ? val : defaultValue;
    },
    deleteItem: (key, emit=true) => {
        // Replace (2nd arg true), not merge: a merge can never remove a
        // top-level key, so a single-segment unset would silently no-op.
        set(state => dissocPath(key.split("."), state), true);
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
        }, true);
        if(emit && _socketRef && keys.length > 0) {
            _socketRef.emit('v1.state.unset_batch', {
                items: keys.map(key => ({ key })),
            });
        }
    },
    replaceItems: replaceData(set),
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
        set(state => dissocPath(key.split("."), state), true);
        if(emit && _socketRef) {
            _socketRef.emit('v1.settings.unset', { key });
        }
    },
    // Many settings as ONE server commit (Settings.ApplyBatch) — a design preset
    // is a hundred keys, and a hundred `v1.settings.set` frames were a hundred
    // settings.json rewrites with every overlay repainting between them.
    // Resolves once the server has written, so a caller can sequence after it.
    applyBatch: (sets, unsets = []) => {
        set(state => {
            let s = state;
            for (const key of unsets) s = dissocPath(key.split("."), s);
            for (const { key, value } of sets) s = assocPath(key.split("."), value, s);
            return s;
        }, true);
        if (!_socketRef || (!sets.length && !unsets.length)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            _socketRef.emit('v1.settings.apply_batch', { items: sets, unset: unsets }, (resp) => {
                if (resp?.error) reject(new Error(resp.error));
                else resolve();
            });
        });
    },
    replaceItems: replaceData(set),
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

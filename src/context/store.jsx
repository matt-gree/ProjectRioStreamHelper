import { create } from "zustand";
import { modifyPath } from "ramda";

export const useStateStore = create((set) => ({
    loaded: false,
    setLoaded: () => set({ loaded: true }),
    setItem: (key, val) => set(
        modifyPath(key.split("."), () => val)
    ),
    mergeItems: (items) => set(items)
}));

export const useSettingsStore = create((set) => ({
    loaded: false,
    setLoaded: () => set({ loaded: true }),
    setItem: (key, val) => set(
        modifyPath(key.split("."), () => val)
    ),
    mergeItems: (items) => set(items)
}));

export const useConfigStore = create((set) => ({
    loaded: false,
    setLoaded: () => set({ loaded: true }),
    setItem: (key, val) => set(
        modifyPath(key.split("."), () => val)
    ),
    mergeItems: (items) => set(items)
}));

export const useStoresLoaded = () => {
    const stateLoaded = useStateStore(state => state.loaded);
    const settingsLoaded = useSettingsStore(state => state.loaded);
    const configLoaded = useConfigStore(state => state.loaded);
    return stateLoaded && settingsLoaded && configLoaded;
}
import { create } from "zustand";
import { modifyPath } from "ramda";
import { useSocket } from "./socket";

export const useStateStore = create((set) => ({
    loaded: false,
    setLoaded: (loaded=true) => set({ loaded }),
    setItem: (key, value, emit=true) => {
        set(modifyPath(key.split("."), () => value));
        if(emit) {
            const socket = useSocket();
            if(socket) socket.emit('v1.state.set', { key, value });
        }
    },
    deleteItem: (key, emit=true) => {
        set(modifyPath(key.split("."), () => null));
        if(emit) {
            const socket = useSocket();
            if(socket) socket.emit('v1.state.unset', { key });
        }
    },
    mergeItems: (items) => set(items)
}));

export const useSettingsStore = create((set) => ({
    loaded: false,
    setLoaded: (loaded=true) => set({ loaded }),
    setItem: (key, value, emit=true) => {
        set(modifyPath(key.split("."), () => value));
        if(emit) {
            const socket = useSocket();
            if(socket) socket.emit('v1.settings.set', { key, value });
        }
    },
    deleteItem: (key, emit=true) => {
        set(modifyPath(key.split("."), () => null));
        if(emit) {
            const socket = useSocket();
            if(socket) socket.emit('v1.settings.unset', { key });
        }
    },
    mergeItems: (items) => set(items)
}));

export const useConfigStore = create((set) => ({
    loaded: false,
    setLoaded: (loaded=true) => set({ loaded }),
    setItem: (key, value) => set(
        modifyPath(key.split("."), () => value)
    ),
    mergeItems: (items) => set(items)
}));

export const useStoresLoaded = () => {
    const stateLoaded = useStateStore(state => state.loaded);
    const settingsLoaded = useSettingsStore(state => state.loaded);
    const configLoaded = useConfigStore(state => state.loaded);
    return stateLoaded && settingsLoaded && configLoaded;
}
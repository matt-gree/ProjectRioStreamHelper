import { useEffect } from 'react';
import { create } from 'zustand';
import { useSocket, useSocketSubscribe } from './socket';

/*
 * The in-app updater's client half (server/updater.py). The server owns the
 * state machine and broadcasts `v1.update.status`; this mirrors it and, once
 * an install is handed over, waits for the RESTARTED server to answer with a
 * new version and reloads the tab onto it — the old bundle's JS talking to a
 * new server is the one state nobody should be left in.
 */
export const useUpdateStore = create((set) => ({
    status: null,
    setStatus: (status) => set({ status }),
}));

// The version an install was handed over FROM. Module-level, not store state:
// the restarted server's first answer says `idle`, and whatever reads it must
// still know an install was in flight to recognise the new version as the end
// of it rather than just the latest status.
let installingFrom = null;

function accept(status) {
    if (!status?.state) return;
    if (installingFrom && status.current && status.current !== installingFrom) {
        window.location.reload();
        return;
    }
    if (status.state === 'installing') installingFrom ??= status.current;
    useUpdateStore.getState().setStatus(status);
}

async function post(path) {
    const resp = await fetch(`/api/v1/update/${path}`, { method: 'POST' });
    const data = await resp.json().catch(() => ({}));
    accept(data);
    if (!resp.ok) throw new Error(data?.detail || `HTTP ${resp.status}`);
    return data;
}

export const checkForUpdate = () => post('check');
export const downloadUpdate = () => post('download');
export const installUpdate = () => post('install');

// Opens Settings on its Updates section — the toast's button. AppHeader owns
// the modal, so this is an event rather than a prop threaded through the app.
export const OPEN_SETTINGS_EVENT = 'prsh:open-settings';
export const openUpdateSettings = () => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT));

export default function UpdateListener() {
    const socket = useSocket();
    const state = useUpdateStore(s => s.status?.state);

    useSocketSubscribe('v1.update.status', accept);

    useEffect(() => {
        const fetchInitial = () => {
            fetch('/api/v1/update', { cache: 'no-store' }).then(r => r.json()).then(accept).catch(() => {});
        };
        if (socket.connected) fetchInitial();
        socket.on('connect', fetchInitial);
        return () => socket.off('connect', fetchInitial);
    }, [socket]);

    // Belt to the reconnect's braces: poll while the server is away.
    useEffect(() => {
        if (state !== 'installing') return undefined;
        const timer = setInterval(() => {
            fetch('/api/v1/update', { cache: 'no-store' }).then(r => r.json()).then(accept)
                .catch(() => { /* down mid-restart — keep waiting */ });
        }, 2000);
        return () => clearInterval(timer);
    }, [state]);

    return null;
}

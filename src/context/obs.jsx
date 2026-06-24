import { useEffect } from 'react';
import { create } from 'zustand';
import OBSWebSocket from 'obs-websocket-js';
import { useSettingsStore } from './store';

/*
 * OBS WebSocket layer — the substrate of the Production page.
 *
 * Per the producer-page design (memory: production-page-v1-locked), the
 * connection is made from the BROWSER to localhost:4455, not from the PRSH
 * backend. In a dual-machine setup (OBS on the streaming PC, PRSH on the
 * gaming PC) the browser is the one machine guaranteed to reach the OBS the
 * producer is sitting at.
 *
 * v1 is read-only: we mirror OBS's scene/source reality (program + studio
 * preview) into the left rail. Control (toggling visibility, switching
 * scenes) and authoring come in later slices.
 */

// Single shared client + reconnect bookkeeping, kept at module scope so the
// store actions and the React manager share one OBS connection.
let obs = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
// Bumped on every connect()/disconnect(); async work and event handlers from a
// superseded generation no-op, so a settings change mid-flight can't race.
let generation = 0;

const mapItem = (it) => ({
    id: it.sceneItemId,
    sourceName: it.sourceName,
    enabled: it.sceneItemEnabled,
    inputKind: it.inputKind || null,
    isGroup: !!it.isGroup,
});

export const useObsStore = create((set) => ({
    // disconnected | connecting | connected | error
    status: 'disconnected',
    error: null,
    obsVersion: null,
    studioMode: false,
    programScene: null,
    previewScene: null,
    // sceneName -> [{ id, sourceName, enabled, inputKind, isGroup }]
    sceneItems: {},

    connect: async () => {
        const s = useSettingsStore.getState();
        const host = s?.obs?.host || '127.0.0.1';
        const port = s?.obs?.port || 4455;
        const password = s?.obs?.password || '';

        // Supersede any in-flight connection/reconnect.
        const myGen = ++generation;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (obs) { try { await obs.disconnect(); } catch { /* ignore */ } }

        const client = new OBSWebSocket();
        obs = client;
        wireEvents(client, myGen);
        set({ status: 'connecting', error: null });

        try {
            const { obsWebSocketVersion } = await client.connect(
                `ws://${host}:${port}`,
                password || undefined,
            );
            if (myGen !== generation) return; // superseded while connecting
            reconnectAttempts = 0;
            set({ status: 'connected', error: null, obsVersion: obsWebSocketVersion });
            await refreshAll(myGen);
        } catch (e) {
            if (myGen !== generation) return;
            set({ status: 'error', error: friendlyError(e) });
            scheduleReconnect();
        }
    },

    disconnect: async () => {
        generation++; // invalidate handlers/in-flight work
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        reconnectAttempts = 0;
        const client = obs;
        obs = null;
        set({
            status: 'disconnected', error: null, obsVersion: null,
            studioMode: false, programScene: null, previewScene: null, sceneItems: {},
        });
        if (client) { try { await client.disconnect(); } catch { /* ignore */ } }
    },
}));

function friendlyError(e) {
    const msg = e?.message || String(e);
    // obs-websocket auth failure code is 4009.
    if (e?.code === 4009) return 'Authentication failed — check the OBS WebSocket password.';
    return msg;
}

async function refreshAll(gen) {
    if (!obs || gen !== generation) return;
    try {
        const [{ studioModeEnabled }, sceneList] = await Promise.all([
            obs.call('GetStudioModeEnabled'),
            obs.call('GetSceneList'),
        ]);
        if (gen !== generation) return;
        const programScene = sceneList.currentProgramSceneName || null;
        const previewScene = sceneList.currentPreviewSceneName || null;
        useObsStore.setState({ studioMode: studioModeEnabled, programScene, previewScene });

        const wanted = [programScene];
        if (studioModeEnabled && previewScene) wanted.push(previewScene);
        await Promise.all([...new Set(wanted.filter(Boolean))].map(n => refreshScene(n, gen)));
    } catch (e) {
        if (gen === generation) console.debug('OBS refreshAll failed', e);
    }
}

async function refreshScene(sceneName, gen) {
    if (!obs || !sceneName || gen !== generation) return;
    try {
        const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
        if (gen !== generation) return;
        useObsStore.setState(state => ({
            sceneItems: { ...state.sceneItems, [sceneName]: sceneItems.map(mapItem) },
        }));
    } catch {
        // Scene may have been renamed/removed between the event and this call.
    }
}

function wireEvents(client, gen) {
    const alive = () => gen === generation;

    client.on('ConnectionClosed', () => {
        if (!alive()) return;
        useObsStore.setState({
            status: 'disconnected', studioMode: false,
            programScene: null, previewScene: null, sceneItems: {},
        });
        scheduleReconnect();
    });

    client.on('CurrentProgramSceneChanged', ({ sceneName }) => {
        if (!alive()) return;
        useObsStore.setState({ programScene: sceneName });
        refreshScene(sceneName, gen);
    });

    client.on('CurrentPreviewSceneChanged', ({ sceneName }) => {
        if (!alive()) return;
        useObsStore.setState({ previewScene: sceneName });
        refreshScene(sceneName, gen);
    });

    client.on('StudioModeStateChanged', ({ studioModeEnabled }) => {
        if (!alive()) return;
        useObsStore.setState({ studioMode: studioModeEnabled });
        refreshAll(gen);
    });

    client.on('SceneItemEnableStateChanged', ({ sceneName, sceneItemId, sceneItemEnabled }) => {
        if (!alive()) return;
        useObsStore.setState(state => {
            const items = state.sceneItems[sceneName];
            if (!items) return {};
            return {
                sceneItems: {
                    ...state.sceneItems,
                    [sceneName]: items.map(it =>
                        it.id === sceneItemId ? { ...it, enabled: sceneItemEnabled } : it),
                },
            };
        });
    });

    const reloadScene = ({ sceneName }) => { if (alive()) refreshScene(sceneName, gen); };
    client.on('SceneItemCreated', reloadScene);
    client.on('SceneItemRemoved', reloadScene);
    client.on('SceneItemListReindexed', reloadScene);
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    if (useSettingsStore.getState()?.obs?.auto_connect === false) return;
    reconnectAttempts += 1;
    // Exponential backoff, capped at 30s.
    const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts, 5), 30000);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        useObsStore.getState().connect();
    }, delay);
}

/**
 * Headless manager — owns the connect/disconnect lifecycle, driven by settings.
 * Reconnects whenever host/port/password change. Mount once near the app root.
 */
export function ObsConnectionManager() {
    const settingsLoaded = useSettingsStore(s => s.loaded);
    const host = useSettingsStore(s => s?.obs?.host);
    const port = useSettingsStore(s => s?.obs?.port);
    const password = useSettingsStore(s => s?.obs?.password);
    const autoConnect = useSettingsStore(s => s?.obs?.auto_connect);

    useEffect(() => {
        if (!settingsLoaded) return undefined;
        if (autoConnect === false) {
            useObsStore.getState().disconnect();
            return undefined;
        }
        useObsStore.getState().connect();
        return () => { useObsStore.getState().disconnect(); };
    }, [settingsLoaded, host, port, password, autoConnect]);

    return null;
}

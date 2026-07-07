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
 * We mirror OBS's scene/source reality (program + studio preview + scene list)
 * into the store, and expose control actions (toggle source visibility, switch
 * program scene, set studio preview, transition). Element authoring + content
 * firing come in later slices.
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
    // Filled in for browser sources via GetInputSettings.
    url: null,
    isPrsh: false,
});

// A browser source is "fed by PRSH" when it's one of the app's overlays:
//   1. served from the app's /layout/ mount (host/port can be anything, so
//      this holds in single- and dual-machine setups), OR
//   2. the gc-overlay controller display — a PRSH-managed subprocess on its own
//      port (controller_overlay.port). The Layouts → Controller tab hands out
//      its direct URL (http://localhost:8069/?port=N), which has no /layout/
//      path, so we match it by port instead.
// Everything else (cams, game capture, audio, third-party browser sources) is
// ignored — the rail should only show PRSH's own overlay elements.
function isPrshUrl(url, gcPort) {
    if (!url) return false;
    try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return false;
        if (u.pathname.startsWith('/layout/')) return true;
        if (gcPort && u.port === String(gcPort)) return true;
        return false;
    } catch {
        return false;
    }
}

export const useObsStore = create((set) => ({
    // disconnected | connecting | connected | error
    status: 'disconnected',
    error: null,
    obsVersion: null,
    studioMode: false,
    programScene: null,
    previewScene: null,
    // sceneName -> [{ id, sourceName, enabled, inputKind, isGroup, url, isPrsh }]
    sceneItems: {},
    // All scene names, in OBS list order (top first). Drives scene switching.
    scenes: [],

    // ---- Control (write) actions. Each throws on failure; callers toast. ----
    // We don't optimistically mutate state — OBS echoes every change back via
    // events (SceneItemEnableStateChanged, CurrentProgram/PreviewSceneChanged,
    // StudioModeStateChanged), so the rail stays the single source of truth.
    setSceneItemEnabled: async (sceneName, sceneItemId, enabled) => {
        if (!obs) throw new Error('Not connected to OBS');
        // Two-phase hide for PRSH overlays. OBS stops producing frames for a
        // browser source the instant its scene item is disabled, keeping the
        // last painted frame in the source's GPU texture — a full-alpha
        // overlay. Re-enabling composites that stale frame for a beat before
        // the page can react (the appear→vanish→replay stutter). Cueing the
        // overlay to conceal itself first, while it's still painting, parks a
        // transparent frame in that texture; the later re-enable then reveals
        // cleanly from nothing. (gc-overlay has no /layout/ path and no
        // overlay-base, so the cue correctly skips it.)
        if (!enabled) {
            const item = (useObsStore.getState().sceneItems[sceneName] || [])
                .find(it => it.id === sceneItemId);
            if (item?.isPrsh && (item.url || '').includes('/layout/')) {
                try {
                    await fetch('/api/v1/action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'overlay.conceal', payload: { url: item.url } }),
                    });
                    // Let the cue reach the overlay and get composited
                    // (socket hop + a couple of rendered frames).
                    await new Promise(r => setTimeout(r, 250));
                } catch { /* best-effort — worst case is the old stutter */ }
            }
        }
        await obs.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled });
    },
    setProgramScene: async (sceneName) => {
        if (!obs) throw new Error('Not connected to OBS');
        await obs.call('SetCurrentProgramScene', { sceneName });
    },
    setPreviewScene: async (sceneName) => {
        if (!obs) throw new Error('Not connected to OBS');
        await obs.call('SetCurrentPreviewScene', { sceneName });
    },
    triggerTransition: async () => {
        if (!obs) throw new Error('Not connected to OBS');
        await obs.call('TriggerStudioModeTransition');
    },
    setStudioMode: async (enabled) => {
        if (!obs) throw new Error('Not connected to OBS');
        await obs.call('SetStudioModeEnabled', { studioModeEnabled: enabled });
    },

    // Create a PRSH overlay as a browser source in OBS and drop it into a scene
    // (the program scene by default). Input names are globally unique in OBS, so
    // we suffix on collision rather than fail. The resulting SceneItemCreated
    // event refreshes the scene mirror, so binding badges update on their own.
    addBrowserSource: async ({ inputName, url, width, height, sceneName }) => {
        if (!obs) throw new Error('Not connected to OBS');
        const scene = sceneName || useObsStore.getState().programScene;
        if (!scene) throw new Error('No active program scene in OBS');

        const taken = new Set();
        try {
            const { inputs } = await obs.call('GetInputList');
            for (const i of inputs) taken.add(i.inputName);
        } catch { /* best-effort; CreateInput still guards uniqueness */ }

        const base = (inputName || 'PRSH Overlay').trim();
        let name = base;
        for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;

        await obs.call('CreateInput', {
            sceneName: scene,
            inputName: name,
            inputKind: 'browser_source',
            inputSettings: {
                url,
                width: Math.round(width) || 1920,
                height: Math.round(height) || 1080,
            },
            sceneItemEnabled: true,
        });
        return { inputName: name, sceneName: scene };
    },

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
            studioMode: false, programScene: null, previewScene: null, sceneItems: {}, scenes: [],
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
        const scenes = (sceneList.scenes || []).map(sc => sc.sceneName);
        useObsStore.setState({ studioMode: studioModeEnabled, programScene, previewScene, scenes });

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
        const gcPort = Number(useSettingsStore.getState()?.controller_overlay?.port) || null;
        // Enrich browser sources with their URL so we can tell which are
        // fed by PRSH. Scenes are small, so the per-source call is cheap.
        const enriched = await Promise.all(sceneItems.map(async (it) => {
            const base = mapItem(it);
            if (it.inputKind === 'browser_source' && !it.isGroup) {
                try {
                    const { inputSettings } = await obs.call('GetInputSettings', { inputName: it.sourceName });
                    base.url = inputSettings?.url || null;
                    base.isPrsh = isPrshUrl(base.url, gcPort);
                } catch {
                    // Input may have been removed between calls.
                }
            }
            return base;
        }));
        if (gen !== generation) return;
        useObsStore.setState(state => ({
            sceneItems: { ...state.sceneItems, [sceneName]: enriched },
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
            programScene: null, previewScene: null, sceneItems: {}, scenes: [],
        });
        scheduleReconnect();
    });

    client.on('SceneListChanged', ({ scenes }) => {
        if (!alive()) return;
        useObsStore.setState({ scenes: (scenes || []).map(sc => sc.sceneName) });
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

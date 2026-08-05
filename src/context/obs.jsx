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

/*
 * Which scenes we mirror. Program + preview are eager (refreshAll re-seeds them
 * on every connect and studio-mode change); every other scene joins on demand
 * via mirrorScene() and then stays for the life of the connection.
 *
 * This set is also the AUTHORITY for scene-item events. Before lazy mirroring
 * the handlers refreshed whatever scene an event named, which quietly pulled
 * scenes nobody had asked for into the store; now an event for an untracked
 * scene is dropped, and one for a lazily-mirrored scene is honoured — the whole
 * point, since a producer staging a Break scene needs it live, not a snapshot.
 */
let tracked = new Set();

/*
 * sourceName -> Promise<inputSettings | null>.
 *
 * GetInputSettings is one round trip per browser source, and refreshScene ran
 * it per source PER SCENE. At program+preview that was the "scenes are small,
 * so the per-source call is cheap" bargain; across N mirrored scenes sharing
 * sources it stops being cheap, and it is exactly what lazy mirroring would
 * otherwise multiply. Caching the PROMISE (not the value) also collapses the
 * two concurrent refreshes of scenes sharing a source into one call.
 *
 * Invalidated by InputSettingsChanged and InputRemoved — a name can be reused
 * by a different input, so a stale entry is not merely out of date.
 */
let inputCache = new Map();

const gcPort = () =>
    Number(useSettingsStore.getState()?.controller_overlay?.port) || null;

function resetMirror() {
    tracked = new Set();
    inputCache = new Map();
}

// Track a scene and pull it in. Tracking BEFORE the fetch matters twice: the
// refreshScene write guards on membership, and a second concurrent request for
// the same scene short-circuits in mirrorScene.
function track(sceneName, gen) {
    if (!sceneName) return undefined;
    tracked.add(sceneName);
    useObsStore.setState({ mirroredScenes: [...tracked] });
    return refreshScene(sceneName, gen);
}

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
//      port (controller_overlay.port). The Production controller stage hands out
//      its direct URL (http://<host>:8069/?port=N), which has no /layout/
//      path, so we match it by port instead.
// Everything else (cams, game capture, audio, third-party browser sources) is
// ignored — the rail should only show PRSH's own overlay elements.
// A PRSH overlay's intro animation is disabled per-source via `?intro=0` on its
// URL (see reveal-gate.js). That single flag also decides the OBS browser
// source's "Shutdown source when not visible" property:
//   • intro ON  (default) → shutdown TRUE: the source fully unloads on hide and
//     gets a fresh, clean load on every show, so its reveal animation always
//     plays from a blank frame — no retained full-alpha texture to flash (the
//     eye-toggle stutter). This is the only page-independent cure for the
//     OBS-native eye, which can't be intercepted the way the app's hide is.
//   • intro OFF → shutdown FALSE: nothing animates, so a retained texture is
//     harmless; keep the source resident (no reload flash) — what a persistent
//     always-on overlay wants.
function urlIntroDisabled(url) {
    try { return new URL(url).searchParams.get('intro') === '0'; } catch { return false; }
}
// Only overlays that play a reveal on show are affected — static overlays
// (stats, roster, team logo, bracket, ticker, scenes) have nothing to stutter,
// so we leave their source resident (OBS default shutdown=false) and never
// touch them. Matches the scoreboard BAND specifically (scoreboardN/scoreboard),
// not the sibling stats/roster/teamlogo files in the same folder.
const ANIMATED_LAYOUT = /\/layout\/(?:scoreboard\d*\/scoreboard|scorecard\/|lowerthird\/|matchup\/|commentary\/|playerplates\/|hitvisualizer\/)/i;
function layoutAnimates(url) {
    try { return ANIMATED_LAYOUT.test(new URL(url).pathname); } catch { return false; }
}
function desiredShutdown(url) {
    return layoutAnimates(url) && !urlIntroDisabled(url);
}

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
    // Only mirrored scenes appear here; see `tracked`.
    sceneItems: {},
    // All scene names, in OBS list order (top first). Drives scene switching.
    scenes: [],
    // The subset of `scenes` whose items are mirrored. A scene in here with no
    // sceneItems entry yet is loading; one absent from here was never asked
    // for — the distinction a "no sources" message needs to not lie.
    mirroredScenes: [],

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
    // Pull a scene's items into the mirror and keep them live from then on.
    // Idempotent and safe to call from render effects — a scene already tracked
    // returns immediately rather than re-fetching, which is what makes "expand
    // a scene section" cheap on the second expand.
    mirrorScene: async (sceneName) => {
        if (!obs || !sceneName || tracked.has(sceneName)) return;
        await track(sceneName, generation);
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
    //
    // Every console add path passes `enabled: false` — adding a source
    // mid-broadcast must never put it on air, so the panel's Air switch stays
    // the single deliberate act that does (production-console-contract skill).
    // The `true` default is a legacy of the deleted Setup layout browser, which
    // added visible; no live caller relies on it.
    addBrowserSource: async ({ inputName, url, width, height, sceneName, enabled = true }) => {
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
                // Clean reveals: unload on hide, fresh load on show (see desiredShutdown).
                shutdown: desiredShutdown(url),
            },
            sceneItemEnabled: enabled,
        });
        return { inputName: name, sceneName: scene, enabled };
    },

    // Flip the intro animation on every live PRSH browser source that serves a
    // given layout (matched by URL path, so all size/team/scoreboard variants of
    // it are covered). Rewrites each source's `?intro=` param AND its shutdown
    // property in lockstep, so an already-added source updates without the user
    // re-copying its URL. `pathname` is the layout's URL path (no query).
    setLayoutIntroDisabled: async (pathname, disabled) => {
        if (!obs || !pathname) return 0;
        const scenes = useObsStore.getState().sceneItems;
        const seen = new Set();
        let changed = 0;
        for (const items of Object.values(scenes)) {
            for (const it of items) {
                if (!it.isPrsh || !it.url || seen.has(it.sourceName)) continue;
                let u;
                try { u = new URL(it.url); } catch { continue; }
                if (u.pathname !== pathname) continue;
                seen.add(it.sourceName);
                if (disabled) u.searchParams.set('intro', '0');
                else u.searchParams.delete('intro');
                try {
                    await obs.call('SetInputSettings', {
                        inputName: it.sourceName,
                        inputSettings: { url: u.toString(), shutdown: !disabled },
                        overlay: true,
                    });
                    changed++;
                } catch { /* input may be gone */ }
            }
        }
        return changed;
    },

    /*
     * `background: true` marks an attempt nobody asked for — the reconnect
     * timer's. Those must be SILENT: they don't publish 'connecting' and they
     * don't rewrite an unchanged error.
     *
     * The status is not cosmetic. 'connecting' is not offline (see
     * useConsoleOffline), so publishing it tears the rack's catalog tier down
     * and rebuilds it when the attempt fails — and a refused ws:// handshake
     * takes about a second, so with OBS closed the whole console blanked for a
     * beat every 30s (the backoff cap). A retry the producer didn't ask for
     * should be invisible until it changes something.
     *
     * A connect the producer DID ask for (Connect/Retry, a settings change)
     * still shows 'connecting' — there the flicker is the feedback.
     */
    connect: async ({ background = false } = {}) => {
        const s = useSettingsStore.getState();
        const host = s?.obs?.host || '127.0.0.1';
        const port = s?.obs?.port || 4455;
        const password = s?.obs?.password || '';

        // Supersede any in-flight connection/reconnect.
        const myGen = ++generation;
        resetMirror();
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (obs) { try { await obs.disconnect(); } catch { /* ignore */ } }

        const client = new OBSWebSocket();
        obs = client;
        wireEvents(client, myGen);
        if (!background) set({ status: 'connecting', error: null });

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
            const error = friendlyError(e);
            // Same failure as last time on a background retry — writing it
            // again would only churn subscribers.
            const prev = useObsStore.getState();
            if (!background || prev.status !== 'error' || prev.error !== error) {
                set({ status: 'error', error });
            }
            scheduleReconnect();
        }
    },

    disconnect: async () => {
        generation++; // invalidate handlers/in-flight work
        resetMirror();
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        reconnectAttempts = 0;
        const client = obs;
        obs = null;
        set({
            status: 'disconnected', error: null, obsVersion: null,
            studioMode: false, programScene: null, previewScene: null,
            sceneItems: {}, scenes: [], mirroredScenes: [],
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

        // Program + preview are always mirrored; scenes a surface asked for
        // stay mirrored, minus any that OBS no longer has (renamed/deleted).
        // Everything else drops out of sceneItems so the store never serves
        // items for a scene it has stopped following.
        const eager = [programScene, studioModeEnabled ? previewScene : null];
        const keep = [...tracked].filter(n => scenes.includes(n));
        tracked = new Set([...eager, ...keep].filter(Boolean));
        useObsStore.setState(state => ({
            mirroredScenes: [...tracked],
            sceneItems: Object.fromEntries(
                Object.entries(state.sceneItems).filter(([n]) => tracked.has(n))),
        }));

        await Promise.all([...tracked].map(n => refreshScene(n, gen)));
    } catch (e) {
        if (gen === generation) console.debug('OBS refreshAll failed', e);
    }
}

/*
 * Auto-correct the "Shutdown source when not visible" property for PRSH
 * overlays so their reveals never flash a stale OBS texture (see
 * desiredShutdown). Idempotent: only writes when the current value differs, so
 * it settles after one pass and can't loop on the InputSettingsChanged echo.
 *
 * Runs once per source rather than once per (source × scene) — it hangs off
 * the cache miss, which is the one place a source's settings are freshly seen.
 */
function reconcileShutdown(sourceName, settings) {
    const url = settings?.url || '';
    if (!isPrshUrl(url, gcPort()) || !url.includes('/layout/')) return;
    const want = desiredShutdown(url);
    if ((settings.shutdown === true) === want) return;
    obs?.call('SetInputSettings', {
        inputName: sourceName,
        inputSettings: { shutdown: want },
        overlay: true,
    }).catch(() => { /* best-effort */ });
}

function inputSettingsFor(sourceName, gen) {
    const hit = inputCache.get(sourceName);
    if (hit) return hit;
    const pending = (async () => {
        try {
            const { inputSettings } = await obs.call('GetInputSettings', { inputName: sourceName });
            const settings = inputSettings || {};
            if (gen === generation) reconcileShutdown(sourceName, settings);
            return settings;
        } catch {
            // Input may have been removed between calls — don't cache the miss,
            // or a source recreated under the same name stays invisible.
            inputCache.delete(sourceName);
            return null;
        }
    })();
    inputCache.set(sourceName, pending);
    return pending;
}

async function refreshScene(sceneName, gen) {
    if (!obs || !sceneName || gen !== generation) return;
    try {
        const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
        // Enrich browser sources with their URL so we can tell which are fed by
        // PRSH. Cached per source name, so mirroring a fifth scene costs one
        // GetSceneItemList plus a call only for sources not seen before.
        const enriched = await Promise.all(sceneItems.map(async (it) => {
            const base = mapItem(it);
            if (it.inputKind === 'browser_source' && !it.isGroup) {
                const settings = await inputSettingsFor(it.sourceName, gen);
                base.url = settings?.url || null;
                base.isPrsh = isPrshUrl(base.url, gcPort());
            }
            return base;
        }));
        if (gen !== generation || !tracked.has(sceneName)) return;
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
        const names = (scenes || []).map(sc => sc.sceneName);
        // A deleted or renamed scene stops being tracked here rather than
        // lingering in the mirror until the next refreshAll.
        const gone = [...tracked].filter(n => !names.includes(n));
        if (gone.length) {
            for (const n of gone) tracked.delete(n);
            useObsStore.setState(state => ({
                mirroredScenes: [...tracked],
                sceneItems: Object.fromEntries(
                    Object.entries(state.sceneItems).filter(([n]) => tracked.has(n))),
            }));
        }
        useObsStore.setState({ scenes: names });
    });

    client.on('CurrentProgramSceneChanged', ({ sceneName }) => {
        if (!alive()) return;
        useObsStore.setState({ programScene: sceneName });
        track(sceneName, gen);   // program is eager — track, don't just refresh
    });

    client.on('CurrentPreviewSceneChanged', ({ sceneName }) => {
        if (!alive()) return;
        useObsStore.setState({ previewScene: sceneName });
        track(sceneName, gen);
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

    // Only scenes we mirror. Lazily-mirrored ones are in `tracked`, so a Break
    // scene a producer expanded stays live; a scene nobody opened is dropped
    // rather than pulled in by the event.
    const reloadScene = ({ sceneName }) => {
        if (alive() && tracked.has(sceneName)) refreshScene(sceneName, gen);
    };
    client.on('SceneItemCreated', reloadScene);
    client.on('SceneItemRemoved', reloadScene);
    client.on('SceneItemListReindexed', reloadScene);

    // The settings cache's invalidation half. OBS hands us the new settings, so
    // this patches every mirrored copy in place — no refetch, and no refreshScene
    // fan-out that our own shutdown write could bounce off.
    client.on('InputSettingsChanged', ({ inputName, inputSettings }) => {
        if (!alive()) return;
        const settings = inputSettings || {};
        inputCache.set(inputName, Promise.resolve(settings));
        reconcileShutdown(inputName, settings);
        const url = settings.url || null;
        const isPrsh = isPrshUrl(url, gcPort());
        useObsStore.setState(state => ({
            sceneItems: Object.fromEntries(Object.entries(state.sceneItems).map(([scene, items]) => [
                scene,
                items.map(it => (it.sourceName === inputName ? { ...it, url, isPrsh } : it)),
            ])),
        }));
    });

    // A name freed by one input can be taken by another, so a stale cache entry
    // would describe the wrong source rather than merely be out of date.
    client.on('InputRemoved', ({ inputName }) => {
        if (alive()) inputCache.delete(inputName);
    });
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    if (useSettingsStore.getState()?.obs?.auto_connect === false) return;
    reconnectAttempts += 1;
    // Exponential backoff, capped at 30s.
    const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts, 5), 30000);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        useObsStore.getState().connect({ background: true });
    }, delay);
}

/**
 * Ask for a scene to be mirrored for as long as this component wants it, and
 * read back its items. The store keeps the scene mirrored after unmount — a
 * producer collapsing a scene section shouldn't pay the fetch again on the next
 * expand, and the mirror is small.
 *
 * Re-runs on reconnect (`status`): a fresh connection starts with only program
 * and preview tracked, so anything a surface had opened has to re-ask.
 */
export function useMirrorScene(sceneName) {
    const status = useObsStore(s => s.status);
    const items = useObsStore(s => (sceneName ? s.sceneItems[sceneName] : undefined));
    const mirrored = useObsStore(s => !sceneName || s.mirroredScenes.includes(sceneName));

    useEffect(() => {
        if (status !== 'connected' || !sceneName) return;
        useObsStore.getState().mirrorScene(sceneName);
    }, [status, sceneName]);

    // `loading` is the gap between asking and the items landing — the state a
    // "no sources in this scene" message must not be shown during.
    return { items: items || [], loading: !items, mirrored };
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

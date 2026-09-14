import { useEffect } from 'react';
import { create } from 'zustand';
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import { useSettingsStore } from './store';
import {
    renderedSize, sizeMatchTransform, redrawPlan, rescaleForSource, isCropped, stretchOf,
    inputSize, sameInputSize,
} from '../lib/obs-transform';

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
    /*
     * IS OBS SCALING THIS SOURCE — the factor, or null. Either direction.
     *
     * The one thing this mirror keeps out of a transform, and it is kept because
     * the console can see a fault OBS never mentions: an item drawn at anything
     * but the resolution it rendered at is a resampled picture of an overlay
     * rather than the overlay, and dragging a handle — the producer's natural
     * gesture for bigger OR smaller — is exactly what causes it. A rack that
     * shows such a source as healthy is the monitor failing at its job.
     *
     * BOTH DIRECTIONS, because this is not only about sharpness: an element
     * that draws type at an absolute size (the Player Name) is drawing a 48px
     * name at 24px on a half-scale item, so the setting and the broadcast
     * disagree with nothing anywhere to say why.
     *
     * The TRANSFORM itself still isn't mirrored, deliberately (see
     * matchSceneItemSize): a size read has to be taken at the moment it is
     * acted on. This is a verdict derived from one — two numbers, not a
     * geometry — and it costs nothing, because GetSceneItemList already carries
     * every item's transform and this mapper was throwing it away.
     */
    stretch: stretchOf(it.sceneItemTransform),
    cropped: isCropped(it.sceneItemTransform),
    /*
     * The RESOLUTION the page renders at — the input's own width/height, which
     * OBS reports on the transform as the item's source size.
     *
     * Mirrored for the same reason the verdict is and under the same limit: it
     * is two numbers off a transform already in hand, not the transform. The
     * Player Name is drawn at an absolute size and its FRAME is what clamps
     * that size, so a console that cannot see the frame cannot explain why a
     * name is smaller than the number the producer typed.
     */
    renderWidth: it.sceneItemTransform?.sourceWidth ?? null,
    renderHeight: it.sceneItemTransform?.sourceHeight ?? null,
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
// The post-game callouts belong here for the same reason the hit visualizer
// does — a GSAP walkthrough on show, and a heavy one. Their in-page gate
// (lib/reveal-gate.js) covers the app's own hide and the container path, but
// the OBS-NATIVE eye stops the source's frames before any snap-dark can be
// painted, so a resident callout composites the last frame of the finished
// graphic for a beat before the intro starts. A fresh load per show is the
// only cure for that one, and it is the trade every animated PRSH source
// already makes.
const ANIMATED_LAYOUT = /\/layout\/(?:scoreboard\d*\/scoreboard|scorecard\/|lowerthird\/|matchup\/|commentary\/|playerplates\/|hitvisualizer\/|postgame\/)/i;
function layoutAnimates(url) {
    try { return ANIMATED_LAYOUT.test(new URL(url).pathname); } catch { return false; }
}
function desiredShutdown(url) {
    return layoutAnimates(url) && !urlIntroDisabled(url);
}

/*
 * EVERY scene item drawing this source, with its transform.
 *
 * An OBS input is GLOBAL, so both callers that change one (`redrawSourceAtSize`
 * and a render-matched `matchSceneItemSize`) have to correct the items they are
 * not looking at, or a source placed in six scenes silently resizes five of
 * them. One enumeration, so the two cannot drift about what they visit.
 *
 * Scenes come from `scenes` — every name OBS knows, mirrored or not — because a
 * scene the producer never expanded is still on air. Items nested inside GROUPS
 * are not visited: GetSceneItemList does not descend, and a PRSH source is
 * placed at scene level by addBrowserSource.
 */
async function itemsOfSource(sourceName) {
    const out = [];
    for (const sceneName of useObsStore.getState().scenes || []) {
        let items;
        try {
            ({ sceneItems: items } = await obs.call('GetSceneItemList', { sceneName }));
        } catch {
            continue;   // a scene that vanished between the list and here
        }
        for (const it of items || []) {
            if (it.sourceName !== sourceName) continue;
            out.push({ sceneName, id: it.sceneItemId, transform: it.sceneItemTransform });
        }
    }
    return out;
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
    /*
     * Take a source out of ONE scene — the inverse of addBrowserSource, and the
     * verb behind the rack row's trash.
     *
     * RemoveSceneItem, never RemoveInput: a PRSH overlay can be placed in
     * several scenes, and each placement is its own row with its own enabled
     * state (../routes/production/placements). Removing the Game copy must
     * leave the Break copy alone. OBS reference-counts inputs, so when this
     * WAS the last scene item the input goes with it on its own — which is the
     * behaviour we want and the reason the confirm names it.
     *
     * No optimistic mutation: SceneItemRemoved reloads the scene (see the event
     * wiring below), so the rack drops the row when OBS says it is gone.
     */
    removeSceneItem: async (sceneName, sceneItemId) => {
        if (!obs) throw new Error('Not connected to OBS');
        await obs.call('RemoveSceneItem', { sceneName, sceneItemId });
    },

    /*
     * Resize one scene item to exactly the drawn size of another — the verb
     * behind the stage's "Match the other side" row.
     *
     * TRANSFORMS ARE NOT MIRRORED into the store and this does not start. The
     * mirror carries what the console MONITORS (what is in a scene, and whether
     * it is visible); a transform is something the producer edits in OBS, on a
     * surface that already shows them the numbers, and mirroring every
     * SceneItemTransformChanged would put a drag's worth of events per frame
     * through the store to feed nothing that reads it. So both sides are read
     * on demand, at the moment the producer asks.
     *
     * Read at RUN time, not at click time, which is what a staged copy under
     * confirm mode should mean: the producer stages "make these two match",
     * keeps nudging the model, and Go Live matches whatever it has become. A
     * snapshot taken at click time would commit a size that is no longer on
     * screen anywhere.
     *
     * Returns the size it landed on, so the caller can say what happened.
     */
    /*
     * `matchRender` copies the model's RESOLUTION too, for an element whose type
     * is drawn at an absolute size — see the section in lib/obs-transform.js.
     * The caller decides (../routes/production/stage/sizematch.jsx, off the one
     * `isScaleSensitive` list), because whether the second size matters is a
     * fact about the element and not about the transforms.
     *
     * It is the SAME global-input problem `redrawSourceAtSize` has below, so it
     * is the same discipline: every other item of this source is re-solved to
     * keep the size it has, and a crop anywhere is a refusal rather than a skip.
     * `sourceName` is required for that and optional otherwise.
     */
    matchSceneItemSize: async ({
        scene, itemId, modelScene, modelItemId, sourceName, matchRender = false,
    }) => {
        if (!obs) throw new Error('Not connected to OBS');
        const [model, target] = await Promise.all([
            obs.call('GetSceneItemTransform', {
                sceneName: modelScene, sceneItemId: modelItemId,
            }),
            obs.call('GetSceneItemTransform', { sceneName: scene, sceneItemId: itemId }),
        ]);
        let mine = target?.sceneItemTransform;
        const theirs = model?.sceneItemTransform;

        /*
         * The resolution first, because the transform is then solved against
         * the dimensions the source is ABOUT to have. Skipped when the two
         * already agree, which is the ordinary case and the one that must not
         * cost a scene sweep or touch a global input for nothing.
         */
        let render = null;
        if (matchRender && sourceName && !sameInputSize(theirs, mine)) {
            render = inputSize(theirs);
            if (!render) throw new Error('OBS reports no size for one of these sources yet');
            const occurrences = await itemsOfSource(sourceName);
            if (occurrences.some(o => isCropped(o.transform))) {
                throw new Error('This source is cropped in at least one scene — changing its '
                    + 'render size would move what the crop cuts. Match it in OBS instead.');
            }
            await obs.call('SetInputSettings', {
                inputName: sourceName,
                inputSettings: { width: render.width, height: render.height },
                overlay: true,
            });
            await Promise.all(occurrences.map((o) => {
                // Not this one: it is about to be given the model's size outright.
                if (o.sceneName === scene && o.id === itemId) return null;
                const keep = rescaleForSource(o.transform, render);
                if (!keep) return null;   // a bounded item's box already fixes its size
                return obs.call('SetSceneItemTransform', {
                    sceneName: o.sceneName, sceneItemId: o.id, sceneItemTransform: keep,
                }).catch(() => { /* one scene's correction must not strand the rest */ });
            }).filter(Boolean));
            mine = { ...mine, sourceWidth: render.width, sourceHeight: render.height };
        }

        const patch = sizeMatchTransform(theirs, mine);
        if (!patch) {
            throw new Error('OBS reports no size for one of these sources yet');
        }
        await obs.call('SetSceneItemTransform', {
            sceneName: scene, sceneItemId: itemId, sceneItemTransform: patch,
        });
        return { ...renderedSize(theirs), render };
    },

    /*
     * Re-render this source at the size it is actually drawn: raise the browser
     * source's own resolution to the item's rendered size and take the stretch
     * back out.
     *
     * THE INPUT IS GLOBAL, and that is the whole difficulty. Resizing it
     * changes the picture in every scene that draws this source, so every item
     * of it is re-solved to keep the size it has (`rescaleForSource`) and only
     * the one the producer is looking at ends up at 1:1 — which it does by
     * arithmetic rather than as a special case, since its rendered size IS the
     * new resolution. A source in one scene is the common case and costs one
     * extra list call; a source in six is exactly the case that would otherwise
     * blow five of them up without saying so.
     *
     * The scene sweep is `itemsOfSource` above, shared with the render-matched
     * half of `matchSceneItemSize` — the same global input, the same correction.
     *
     * The corrections go out together so the window in which another scene is
     * drawing the new resolution at the old scale is a frame, not a loop.
     */
    redrawSourceAtSize: async ({ scene, itemId, sourceName }) => {
        if (!obs) throw new Error('Not connected to OBS');
        const { sceneItemTransform } = await obs.call('GetSceneItemTransform', {
            sceneName: scene, sceneItemId: itemId,
        });
        const plan = redrawPlan(sceneItemTransform);
        if (!plan) {
            throw new Error('OBS is already rendering this source at its full size');
        }

        const occurrences = await itemsOfSource(sourceName);

        /*
         * A CROP anywhere is a refusal, not a skip. The crop is in source pixels
         * and the source is about to be a different size, so leaving that item
         * alone would silently re-frame it — and having already resized the
         * input, there would be no way back. Checked before the write.
         */
        if (occurrences.some(o => isCropped(o.transform))) {
            throw new Error('This source is cropped in at least one scene — resizing its '
                + 'render would move what the crop cuts. Set its size in OBS Properties instead.');
        }

        await obs.call('SetInputSettings', {
            inputName: sourceName,
            inputSettings: { width: plan.width, height: plan.height },
            overlay: true,
        });

        await Promise.all(occurrences.map((o) => {
            const patch = rescaleForSource(o.transform, plan);
            if (!patch) return null;   // a bounded item's box already fixes its size
            return obs.call('SetSceneItemTransform', {
                sceneName: o.sceneName, sceneItemId: o.id, sceneItemTransform: patch,
            }).catch(() => { /* one scene's correction failing must not strand the rest */ });
        }).filter(Boolean));

        return { width: plan.width, height: plan.height, scenes: occurrences.length };
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
    // Console adds pass `enabled: false` — adding a source mid-broadcast must
    // never put it on air, so the panel's Air switch stays the single
    // deliberate act that does (production-console-contract skill). The one
    // exception is the Add picker's **Add visible**, which passes true on
    // purpose: laying a scene out before a stream, the producer has to see
    // what they placed, and there is no broadcast to protect.
    // The `true` default is a legacy of the deleted Setup layout browser; every
    // live caller states `enabled` rather than relying on it.
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
            const { obsWebSocketVersion } = await withConnectTimeout(client.connect(
                `ws://${host}:${port}`,
                password || undefined,
                /*
                 * `All` IS NOT ALL. obs-websocket sorts a handful of events it
                 * considers high-volume outside the default mask (4095), and
                 * SceneItemTransformChanged (1 << 19) is one of them — so
                 * subscribing to "everything" delivers every event in this file
                 * except the one that says a source's geometry moved.
                 *
                 * It failed exactly the way an unsubscribed event does, which is
                 * to say silently and asymmetrically: the scaled-source verdict
                 * (`mapItem`) was correct whenever a scene was mirrored and then
                 * frozen forever, so the badge appeared on a source the producer
                 * had dragged and then would not clear when they fixed it.
                 *
                 * The volume is real — one event per frame while a handle is
                 * being dragged — and is answered where it lands rather than by
                 * declining to hear it: the handler writes to the store only
                 * when the ROUNDED verdict changes, so a ten-second drag moves
                 * the rack twice. Over a loopback socket the frames themselves
                 * cost nothing worth measuring.
                 */
                {
                    eventSubscriptions: EventSubscription.All
                        | EventSubscription.SceneItemTransformChanged,
                },
            ));
            if (myGen !== generation) return; // superseded while connecting
            reconnectAttempts = 0;
            set({ status: 'connected', error: null, obsVersion: obsWebSocketVersion });
            await refreshAll(myGen);
        } catch (e) {
            // A timed-out handshake leaves a socket still trying: drop it so it
            // can't land later behind the store's back. Events are already
            // generation-guarded, but the socket itself is not.
            if (e?.name === TIMED_OUT) {
                Promise.resolve(client.disconnect()).catch(() => { /* already gone */ });
            }
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

/*
 * A handshake that never settles is the one connect failure the status machine
 * cannot absorb on its own.
 *
 * With OBS simply closed on loopback the SYN is REFUSED, so client.connect()
 * rejects in milliseconds and the console lands on 'error' — which
 * useConsoleOffline counts, so the catalog tier takes over. But a SYN that is
 * DROPPED rather than refused (a host firewall, a VPN, obs.host pointed at a
 * LAN machine that is off) never produces either outcome: obs-websocket-js
 * has no connect timeout of its own, so the promise stays pending, the status
 * stays 'connecting' — which useConsoleOffline deliberately does NOT count —
 * and the rack sits on "Connecting to OBS…" with neither scenes nor catalog.
 *
 * That exclusion is right (see placements.js: publishing 'connecting' on every
 * backoff retry blanked the console every 30s), but it rests on 'connecting'
 * being short-lived. This is what makes that true by construction: a handshake
 * that hasn't landed in CONNECT_TIMEOUT_MS fails like a refused one — same
 * error status, same backoff — so the console always reaches a tier it can
 * actually work in.
 */
const CONNECT_TIMEOUT_MS = 5000;
const TIMED_OUT = 'ObsConnectTimeout';

function withConnectTimeout(promise) {
    let timer;
    const limit = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const e = new Error(`No response from OBS within ${CONNECT_TIMEOUT_MS / 1000}s.`);
            e.name = TIMED_OUT;
            reject(e);
        }, CONNECT_TIMEOUT_MS);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function friendlyError(e) {
    const msg = e?.message || String(e);
    // obs-websocket auth failure code is 4009.
    if (e?.code === 4009) return 'Authentication failed — check the OBS WebSocket password.';
    // A drop reads as a hang, so name the likely causes rather than the symptom.
    if (e?.name === TIMED_OUT) {
        return `${msg} Check the host and port on the Connections tab, and that a firewall `
            + 'or VPN is not blocking the connection.';
    }
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

    /*
     * A drag emits one of these per frame, so this writes to the store only when
     * the VERDICT changes — not when the numbers do. A producer nudging a source
     * for ten seconds moves the rack twice: once when it crosses into being
     * stretched, once when it crosses back.
     *
     * Rounded to one decimal for the same reason: the badge says "1.8x", and a
     * factor wandering in the fourth decimal is not news.
     */
    client.on('SceneItemTransformChanged', ({ sceneName, sceneItemId, sceneItemTransform }) => {
        if (!alive()) return;
        const next = stretchOf(sceneItemTransform);
        const cropped = isCropped(sceneItemTransform);
        const same = (a, b) => (a == null && b == null)
            || (a != null && b != null && Math.round(a * 10) === Math.round(b * 10));
        useObsStore.setState(state => {
            const items = state.sceneItems[sceneName];
            const it = items?.find(i => i.id === sceneItemId);
            const w = sceneItemTransform?.sourceWidth ?? null;
            const h = sceneItemTransform?.sourceHeight ?? null;
            const settled = same(it?.stretch, next) && it?.cropped === cropped
                && it?.renderWidth === w && it?.renderHeight === h;
            if (!it || settled) return {};
            return {
                sceneItems: {
                    ...state.sceneItems,
                    [sceneName]: items.map(i => (i.id === sceneItemId
                        ? { ...i, stretch: next, cropped, renderWidth: w, renderHeight: h }
                        : i)),
                },
            };
        });
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

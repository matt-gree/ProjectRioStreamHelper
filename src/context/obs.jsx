import { useEffect } from 'react';
import { create } from 'zustand';
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import { useSettingsStore } from './store';
// Pure helper, no imports of its own — the one rule for reading a boolean
// setting that the string-typed REST route can deliver as "true".
import { settingOn } from '../routes/design/designConstants';
import { resolveUrlForObs } from '../lib/obs-reach';
import {
    session, resetMirror, inputSettingsFor, isPrshUrl, loadGcLegacyPorts, ownerScene, reconcileShutdown,
    liveName, desiredShutdown,
} from './obs-session';
import { reconcileOnConnect, renameEverywhere, replayRenames } from './obs-renames';
import {
    followUrlWithName, repairSourceAddresses, upgradeRetiredCanvases, upgradeRetiredNames,
} from './obs-source-passes';
import {
    renderedSize, sizeMatchTransform, redrawPlan, rescaleForSource, reshapePatch, isCropped, stretchOf,
    inputSize, sameInputSize, typeScaleOf, growPatch,
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

// The connection's shared state lives in ./obs-session; rename tracking in
// ./obs-renames; the connect-time passes over PRSH's sources in
// ./obs-source-passes. Their public names are re-exported here, so the
// console keeps importing one module.
export { liveName, ownerScene, isPrshUrl, setGcLegacyPorts } from './obs-session';
export { onObsRename } from './obs-renames';

let reconnectTimer = null;
let reconnectAttempts = 0;

// Track a scene and pull it in. Tracking BEFORE the fetch matters twice: the
// refreshScene write guards on membership, and a second concurrent request for
// the same scene short-circuits in mirrorScene.
function track(sceneName, gen) {
    if (!sceneName) return undefined;
    session.tracked.add(sceneName);
    useObsStore.setState({ mirroredScenes: [...session.tracked] });
    return refreshScene(sceneName, gen);
}

const mapItem = (it) => ({
    id: it.sceneItemId,
    sourceName: it.sourceName,
    // OBS 30+ only (obs-websocket 5.3); null on 28/29. See the name book.
    uuid: it.sourceUuid ?? null,
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

/*
 * EVERY scene item drawing this source, with its transform.
 *
 * An OBS input is GLOBAL, so both callers that change one (`redrawSourceAtSize`
 * and a render-matched `matchSceneItemSize`) have to correct the items they are
 * not looking at, or a source placed in six scenes silently resizes five of
 * them. One enumeration, so the two cannot drift about what they visit.
 *
 * Scenes come from `scenes` — every name OBS knows, mirrored or not — because a
 * scene the producer never expanded is still on air. GetSceneItemList does not
 * descend into GROUPS, so each group is read once on its own — a producer who
 * files sources into folders has them in there, and a copy skipped here is one
 * the redraw silently resizes. A grouped item's `sceneName` is the GROUP, the
 * name every request against it has to carry (see `ownerScene`).
 */
async function itemsOfSource(sourceName) {
    const out = [];
    const groups = new Set();
    const visit = (sceneName, items) => {
        for (const it of items || []) {
            if (it.isGroup) groups.add(it.sourceName);
            if (it.sourceName !== sourceName) continue;
            out.push({ sceneName, id: it.sceneItemId, transform: it.sceneItemTransform });
        }
    };
    for (const sceneName of useObsStore.getState().scenes || []) {
        try {
            visit(sceneName, (await session.client.call('GetSceneItemList', { sceneName })).sceneItems);
        } catch {
            continue;   // a scene that vanished between the list and here
        }
    }
    for (const group of groups) {
        try {
            visit(group, (await session.client.call('GetGroupSceneItemList', { sceneName: group })).sceneItems);
        } catch { /* removed between the two reads */ }
    }
    return out;
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
        if (!session.client) throw new Error('Not connected to OBS');
        // Two-phase hide for PRSH overlays. OBS stops producing frames for a
        // browser source the instant its scene item is disabled, keeping the
        // last painted frame in the source's GPU texture — a full-alpha
        // overlay. Re-enabling composites that stale frame for a beat before
        // the page can react (the appear→vanish→replay stutter). Cueing the
        // overlay to conceal itself first, while it's still painting, parks a
        // transparent frame in that texture; the later re-enable then reveals
        // cleanly from nothing. (gc-overlay has no /layout/ path and no
        // overlay-base, so the cue correctly skips it.)
        sceneName = liveName(sceneName);
        if (!enabled) {
            // By OWNER, across every mirrored scene: `sceneName` is the group
            // for an item inside one, and a group has no list of its own here.
            const item = Object.entries(useObsStore.getState().sceneItems)
                .flatMap(([scene, items]) => items.filter(it => ownerScene(scene, it) === sceneName))
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
        await session.client.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled });
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
        if (!session.client) throw new Error('Not connected to OBS');
        await session.client.call('RemoveSceneItem', { sceneName: liveName(sceneName), sceneItemId });
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
        if (!session.client) throw new Error('Not connected to OBS');
        scene = liveName(scene);
        modelScene = liveName(modelScene);
        sourceName = liveName(sourceName);
        const [model, target] = await Promise.all([
            session.client.call('GetSceneItemTransform', {
                sceneName: modelScene, sceneItemId: modelItemId,
            }),
            session.client.call('GetSceneItemTransform', { sceneName: scene, sceneItemId: itemId }),
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
            await session.client.call('SetInputSettings', {
                inputName: sourceName,
                inputSettings: { width: render.width, height: render.height },
                overlay: true,
            });
            await Promise.all(occurrences.map((o) => {
                // Not this one: it is about to be given the model's size outright.
                if (o.sceneName === scene && o.id === itemId) return null;
                const keep = rescaleForSource(o.transform, render);
                if (!keep) return null;   // a bounded item's box already fixes its size
                return session.client.call('SetSceneItemTransform', {
                    sceneName: o.sceneName, sceneItemId: o.id, sceneItemTransform: keep,
                }).catch(() => { /* one scene's correction must not strand the rest */ });
            }).filter(Boolean));
            mine = { ...mine, sourceWidth: render.width, sourceHeight: render.height };
        }

        const patch = sizeMatchTransform(theirs, mine);
        if (!patch) {
            throw new Error('OBS reports no size for one of these sources yet');
        }
        await session.client.call('SetSceneItemTransform', {
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
    /*
     * `rewriteUrl(url, typeScale)` — optional, for a source whose CONTENT has to
     * follow the redraw (the Player Name keeps the size its text was drawn at;
     * see scaleSourceSizes). Its URL rides the same SetInputSettings as the new
     * resolution, so the source reloads once, at the new size, with the new
     * type. `typeScale` is measured off the item the producer pressed on.
     */
    redrawSourceAtSize: async ({ scene, itemId, sourceName, rewriteUrl = null }) => {
        if (!session.client) throw new Error('Not connected to OBS');
        scene = liveName(scene);
        sourceName = liveName(sourceName);
        const { sceneItemTransform } = await session.client.call('GetSceneItemTransform', {
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

        const inputSettings = { width: plan.width, height: plan.height };
        let url = null;
        if (rewriteUrl) {
            const { inputSettings: current } = await session.client.call('GetInputSettings', { inputName: sourceName });
            url = rewriteUrl(current?.url || '', typeScaleOf(sceneItemTransform));
            if (url) inputSettings.url = url;
        }

        await session.client.call('SetInputSettings', { inputName: sourceName, inputSettings, overlay: true });

        await Promise.all(occurrences.map((o) => {
            const patch = rescaleForSource(o.transform, plan);
            if (!patch) return null;   // a bounded item's box already fixes its size
            return session.client.call('SetSceneItemTransform', {
                sceneName: o.sceneName, sceneItemId: o.id, sceneItemTransform: patch,
            }).catch(() => { /* one scene's correction failing must not strand the rest */ });
        }).filter(Boolean));

        return { width: plan.width, height: plan.height, scenes: occurrences.length, url };
    },

    /*
     * Give a browser source a new URL AND a new resolution in one write — the
     * Roster switching layout, whose `?layout=` names a different canvas
     * (public/layout/lib/roster-layouts.js). One SetInputSettings, so the page
     * reloads once, at the new size, drawing the new shape: two writes would
     * put a frame on air of one layout on the other's canvas.
     *
     * Every scene drawing the source keeps its SCALE (`reshapePatch`): an
     * unbounded item needs nothing, a bounded one has its box re-solved so the
     * new shape is not squeezed into the old one. A crop anywhere refuses,
     * before the write, for `redrawSourceAtSize`'s reason — it is in source
     * pixels, and the source is about to be a different picture.
     */
    reshapeBrowserSource: async ({ sourceName, url, width, height }) => {
        if (!session.client) throw new Error('Not connected to OBS');
        sourceName = liveName(sourceName);
        const occurrences = await itemsOfSource(sourceName);
        if (occurrences.some(o => isCropped(o.transform))) {
            throw new Error('This source is cropped in at least one scene — changing its '
                + 'shape would move what the crop cuts. Remove the crop in OBS first.');
        }
        await session.client.call('SetInputSettings', {
            inputName: sourceName,
            inputSettings: { url, width, height },
            overlay: true,
        });
        await Promise.all(occurrences.map((o) => {
            const patch = reshapePatch(o.transform, width, height);
            if (!patch) return null;
            return session.client.call('SetSceneItemTransform', {
                sceneName: o.sceneName, sceneItemId: o.id, sceneItemTransform: patch,
            }).catch(() => { /* one scene's correction failing must not strand the rest */ });
        }).filter(Boolean));
        return { sourceName, scenes: occurrences.length };
    },

    /*
     * Grow a browser source to a canvas its element has since outgrown, and
     * keep it looking exactly as it did (`growPatch`): each scene keeps the
     * item's scale, and a cropped item keeps cutting the same area — its bottom
     * crop grows by the height the canvas added. The retired-canvas migration's
     * Resize; checked before the write, so a source that cannot keep its crop
     * is never half-changed.
     */
    growBrowserSource: async ({ sourceName, from, width, height }) => {
        if (!session.client) throw new Error('Not connected to OBS');
        sourceName = liveName(sourceName);
        const to = { width, height };
        const occurrences = await itemsOfSource(sourceName);
        const patches = occurrences.map(o => growPatch(o.transform, from, to));   // throws first
        await session.client.call('SetInputSettings', {
            inputName: sourceName,
            inputSettings: { width, height },
            overlay: true,
        });
        await Promise.all(occurrences.map((o, i) => (patches[i]
            ? session.client.call('SetSceneItemTransform', {
                sceneName: o.sceneName, sceneItemId: o.id, sceneItemTransform: patches[i],
            }).catch(() => { /* one scene's correction failing must not strand the rest */ })
            : null)).filter(Boolean));
        return { sourceName, scenes: occurrences.length };
    },

    // Pull a scene's items into the mirror and keep them live from then on.
    // Idempotent and safe to call from render effects — a scene already session.tracked
    // returns immediately rather than re-fetching, which is what makes "expand
    // a scene section" cheap on the second expand.
    mirrorScene: async (sceneName) => {
        sceneName = liveName(sceneName);
        if (!session.client || !sceneName || session.tracked.has(sceneName)) return;
        await track(sceneName, session.generation);
    },

    setProgramScene: async (sceneName) => {
        if (!session.client) throw new Error('Not connected to OBS');
        await session.client.call('SetCurrentProgramScene', { sceneName: liveName(sceneName) });
    },
    setPreviewScene: async (sceneName) => {
        if (!session.client) throw new Error('Not connected to OBS');
        await session.client.call('SetCurrentPreviewScene', { sceneName: liveName(sceneName) });
    },
    triggerTransition: async () => {
        if (!session.client) throw new Error('Not connected to OBS');
        await session.client.call('TriggerStudioModeTransition');
    },
    setStudioMode: async (enabled) => {
        if (!session.client) throw new Error('Not connected to OBS');
        await session.client.call('SetStudioModeEnabled', { studioModeEnabled: enabled });
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
    // Re-run the address repair (PRSH's socket reconnecting: a restart may
    // have changed its LAN bind or port while OBS stayed connected).
    repairSourceAddresses: () => (useObsStore.getState().status === 'connected' ? repairSourceAddresses() : null),

    addBrowserSource: async ({ inputName, url, width, height, sceneName, enabled = true }) => {
        if (!session.client) throw new Error('Not connected to OBS');
        // The URL is qualified with the host THIS browser reached PRSH at; an
        // OBS on another machine needs PRSH's LAN address instead (obs-reach.js).
        url = await resolveUrlForObs(url, useSettingsStore.getState());
        const scene = liveName(sceneName) || useObsStore.getState().programScene;
        if (!scene) throw new Error('No active program scene in OBS');

        const taken = new Set();
        try {
            const { inputs } = await session.client.call('GetInputList');
            for (const i of inputs) taken.add(i.inputName);
        } catch { /* best-effort; CreateInput still guards uniqueness */ }

        const base = (inputName || 'PRSH Overlay').trim();
        let name = base;
        for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;

        await session.client.call('CreateInput', {
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

    /*
     * Point an existing browser source at a different URL — the console's
     * board switch (`?scoreboard=N`). An OBS input is GLOBAL, so this re-points
     * the source in every scene that draws it; the caller says so. The NAME is
     * not this action's: the InputSettingsChanged echo renames a PRSH-named
     * source for any URL change, this one included (followUrlWithName).
     */
    repointBrowserSource: async ({ sourceName, url }) => {
        if (!session.client) throw new Error('Not connected to OBS');
        url = await resolveUrlForObs(url, useSettingsStore.getState());
        sourceName = liveName(sourceName);
        await session.client.call('SetInputSettings', {
            inputName: sourceName,
            inputSettings: { url },
            overlay: true,
        });
        return { sourceName };
    },

    // Flip the intro animation on every live PRSH browser source that serves a
    // given layout (matched by URL path, so all size/team/scoreboard variants of
    // it are covered). Rewrites each source's `?intro=` param AND its shutdown
    // property in lockstep, so an already-added source updates without the user
    // re-copying its URL. `pathname` is the layout's URL path (no query).
    setLayoutIntroDisabled: async (pathname, disabled) => {
        if (!session.client || !pathname) return 0;
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
                    await session.client.call('SetInputSettings', {
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
        const myGen = ++session.generation;
        resetMirror();
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (session.client) { try { await session.client.disconnect(); } catch { /* ignore */ } }

        const client = new OBSWebSocket();
        session.client = client;
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
            if (myGen !== session.generation) return; // superseded while connecting
            reconnectAttempts = 0;
            await loadGcLegacyPorts();
            await reconcileOnConnect(myGen);
            if (myGen !== session.generation) return;
            set({ status: 'connected', error: null, obsVersion: obsWebSocketVersion });
            /*
             * One success is what turns a later failure into an ERROR rather
             * than into "not set up yet" — see session.client.ever_connected in
             * server/settings.py. Written once and never cleared: the claim is
             * that this install has talked to OBS at some point, which a
             * subsequent outage does not undo.
             */
            if (!settingOn(useSettingsStore.getState()?.obs?.ever_connected, false)) {
                useSettingsStore.getState().setItem('obs.ever_connected', true);
            }
            await refreshAll(myGen);
            // Background: a rename pass must never hold up the console coming up.
            // Names first, so the resize toast below counts sources under the
            // names the producer is about to see.
            // The address repair FIRST: a source that can't reach PRSH is
            // drawing nothing, and a rename racing it would skip that source.
            repairSourceAddresses(myGen)
                .then(() => upgradeRetiredNames(myGen))
                .then(() => upgradeRetiredCanvases(myGen));
        } catch (e) {
            // A timed-out handshake leaves a socket still trying: drop it so it
            // can't land later behind the store's back. Events are already
            // generation-guarded, but the socket itself is not.
            if (e?.name === TIMED_OUT) {
                Promise.resolve(client.disconnect()).catch(() => { /* already gone */ });
            }
            if (myGen !== session.generation) return;
            const error = friendlyError(e, { host, port });
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
        session.generation++; // invalidate handlers/in-flight work
        resetMirror();
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        reconnectAttempts = 0;
        const client = session.client;
        session.client = null;
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
 * DROPPED rather than refused (a host firewall, a VPN, session.client.host pointed at a
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

/*
 * The pill beside this already says the connection failed, so the line only
 * ever carries what the pill CAN'T: which address, or which rejection. Short
 * enough to sit on the band's one row — the fix is the link, not a sentence.
 *
 * Never `String(e)`: a socket that never opens closes 1006 with an EMPTY
 * reason, so obs-websocket-js raises an Error whose message is '' — and
 * String() of that is the bare word "Error", which is what the band printed
 * for the likeliest failure there is.
 */
export function friendlyError(e, { host, port } = {}) {
    const at = host ? `${host}:${port}` : 'OBS';
    // obs-websocket auth failure code is 4009.
    if (e?.code === 4009) return 'Password rejected.';
    if (e?.name === TIMED_OUT) return `No response from ${at}.`;
    // 1006 is an abnormal close: refused, or dropped without a close frame.
    if (!e?.code || e.code === 1006) return `Nothing listening at ${at}.`;
    return e.message || `Connection closed (code ${e.code}).`;
}

async function refreshAll(gen) {
    if (!session.client || gen !== session.generation) return;
    try {
        const [{ studioModeEnabled }, sceneList] = await Promise.all([
            session.client.call('GetStudioModeEnabled'),
            session.client.call('GetSceneList'),
        ]);
        if (gen !== session.generation) return;
        const programScene = sceneList.currentProgramSceneName || null;
        const previewScene = sceneList.currentPreviewSceneName || null;
        const scenes = (sceneList.scenes || []).map(sc => sc.sceneName);
        useObsStore.setState({ studioMode: studioModeEnabled, programScene, previewScene, scenes });

        // Program + preview are always mirrored; scenes a surface asked for
        // stay mirrored, minus any that OBS no longer has (renamed/deleted).
        // Everything else drops out of sceneItems so the store never serves
        // items for a scene it has stopped following.
        const eager = [programScene, studioModeEnabled ? previewScene : null];
        const keep = [...session.tracked].filter(n => scenes.includes(n));
        session.tracked = new Set([...eager, ...keep].filter(Boolean));
        useObsStore.setState(state => ({
            mirroredScenes: [...session.tracked],
            sceneItems: Object.fromEntries(
                Object.entries(state.sceneItems).filter(([n]) => session.tracked.has(n))),
        }));

        await Promise.all([...session.tracked].map(n => refreshScene(n, gen)));
    } catch (e) {
        if (gen === session.generation) console.debug('OBS refreshAll failed', e);
    }
}

/*
 * OBS'S SOURCE-LIST ORDER, top first.
 *
 * GetSceneItemList answers BOTTOM-first (`sceneItemIndex` 0 is the item drawn
 * underneath everything), which is the reverse of the list a producer reads in
 * OBS's Sources dock. The rack is meant to read the way that list does, so the
 * mirror stores it top-first. An item with no index (an old server, a test
 * fake) keeps the order it came in.
 */
function topFirst(items) {
    if (!(items || []).every(it => typeof it.sceneItemIndex === 'number')) return items || [];
    return [...items].sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);
}

async function refreshScene(sceneName, gen) {
    if (!session.client || !sceneName || gen !== session.generation) return;
    try {
        const { sceneItems } = await session.client.call('GetSceneItemList', { sceneName });
        // Enrich browser sources with their URL so we can tell which are fed by
        // PRSH. Cached per source name, so mirroring a fifth scene costs one
        // GetSceneItemList plus a call only for sources not seen before.
        const enrich = async (it, extra) => {
            const base = { ...mapItem(it), ...extra };
            if (it.inputKind === 'browser_source' && !it.isGroup) {
                const settings = await inputSettingsFor(it.sourceName, gen);
                base.url = settings?.url || null;
                base.isPrsh = isPrshUrl(base.url);
            }
            return base;
        };
        /*
         * A GROUP IS FLATTENED IN PLACE: the group's own item, then its
         * contents, each carrying `group` (the folder's name, which is also the
         * `owner` every request against it must name) and `groupEnabled`, since
         * a hidden folder hides everything in it whatever the child's own eye
         * says. OBS groups do not nest, so one level is the whole tree.
         */
        const lists = await Promise.all(topFirst(sceneItems).map(async (it) => {
            const own = await enrich(it, { owner: sceneName, group: null, groupEnabled: true });
            if (!it.isGroup) return [own];
            let children = [];
            try {
                ({ sceneItems: children } = await session.client.call('GetGroupSceneItemList', { sceneName: it.sourceName }));
            } catch { /* a group removed between the two calls */ }
            const inner = await Promise.all(topFirst(children).map(c => enrich(c, {
                owner: it.sourceName, group: it.sourceName, groupEnabled: !!it.sceneItemEnabled,
            })));
            return [own, ...inner];
        }));
        const enriched = lists.flat();
        if (gen !== session.generation || !session.tracked.has(sceneName)) return;
        // A GROUP's uuid is reported here and nowhere else, so a folder renamed
        // while PRSH was away is only recognised once a scene holding it loads.
        replayRenames(enriched.map(it => ({ uuid: it.uuid, name: it.sourceName })));
        for (const [g, parents] of session.groupParents) {
            parents.delete(sceneName);
            if (!parents.size) session.groupParents.delete(g);
        }
        for (const it of enriched) {
            if (!it.isGroup) continue;
            if (!session.groupParents.has(it.sourceName)) session.groupParents.set(it.sourceName, new Set());
            session.groupParents.get(it.sourceName).add(sceneName);
        }
        useObsStore.setState(state => ({
            sceneItems: { ...state.sceneItems, [sceneName]: enriched },
        }));
    } catch {
        // Scene may have been renamed/removed between the event and this call.
    }
}

/*
 * Patch the mirrored copies of ONE OBS scene item, addressed the way OBS
 * addresses it: by its owner (the group, for an item inside one) and its id.
 * A group can sit in more than one mirrored scene, so every copy is patched.
 * `fn(item)` returns the fields to change, or null for "already true" — the
 * store is only written when something actually moved.
 */
function patchOwned(owner, id, fn) {
    useObsStore.setState(state => {
        let changed = false;
        const next = {};
        for (const [scene, items] of Object.entries(state.sceneItems)) {
            next[scene] = items.map((it) => {
                if (it.id !== id || ownerScene(scene, it) !== owner) return it;
                const patch = fn(it);
                if (!patch) return it;
                changed = true;
                return { ...it, ...patch };
            });
        }
        return changed ? { sceneItems: next } : {};
    });
}

function wireEvents(client, gen) {
    const alive = () => gen === session.generation;

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
        // A deleted or renamed scene stops being session.tracked here rather than
        // lingering in the mirror until the next refreshAll.
        const gone = [...session.tracked].filter(n => !names.includes(n));
        if (gone.length) {
            for (const n of gone) session.tracked.delete(n);
            useObsStore.setState(state => ({
                mirroredScenes: [...session.tracked],
                sceneItems: Object.fromEntries(
                    Object.entries(state.sceneItems).filter(([n]) => session.tracked.has(n))),
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
        const w = sceneItemTransform?.sourceWidth ?? null;
        const h = sceneItemTransform?.sourceHeight ?? null;
        // By OWNER: an item inside a group reports the group as its scene.
        patchOwned(sceneName, sceneItemId, it => (
            same(it.stretch, next) && it.cropped === cropped
                && it.renderWidth === w && it.renderHeight === h
                ? null
                : { stretch: next, cropped, renderWidth: w, renderHeight: h }
        ));
    });

    client.on('SceneItemEnableStateChanged', ({ sceneName, sceneItemId, sceneItemEnabled }) => {
        if (!alive()) return;
        patchOwned(sceneName, sceneItemId, () => ({ enabled: sceneItemEnabled }));
        // A FOLDER's eye is its contents' too: everything filed in it goes dark
        // with it, whatever each child's own eye says.
        useObsStore.setState(state => {
            const items = state.sceneItems[sceneName];
            const folder = items?.find(it => it.id === sceneItemId && it.isGroup && !it.group);
            if (!folder) return {};
            return {
                sceneItems: {
                    ...state.sceneItems,
                    [sceneName]: items.map(it => (it.group === folder.sourceName
                        ? { ...it, groupEnabled: sceneItemEnabled } : it)),
                },
            };
        });
    });

    // Only scenes we mirror. Lazily-mirrored ones are in `tracked`, so a Break
    // scene a producer expanded stays live; a scene nobody opened is dropped
    // rather than pulled in by the event. An event about a GROUP's contents
    // names the group, so it reloads every mirrored scene that holds it.
    const reloadScene = ({ sceneName }) => {
        if (!alive()) return;
        if (session.tracked.has(sceneName)) refreshScene(sceneName, gen);
        for (const parent of session.groupParents.get(sceneName) ?? []) {
            if (session.tracked.has(parent)) refreshScene(parent, gen);
        }
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
        session.inputCache.set(inputName, Promise.resolve(settings));
        reconcileShutdown(inputName, settings);
        const url = settings.url || null;
        const isPrsh = isPrshUrl(url);
        followUrlWithName(inputName, url);
        useObsStore.setState(state => ({
            sceneItems: Object.fromEntries(Object.entries(state.sceneItems).map(([scene, items]) => [
                scene,
                items.map(it => (it.sourceName === inputName ? { ...it, url, isPrsh } : it)),
            ])),
        }));
    });

    /*
     * A RENAME — of a source, a scene or an OBS group (obs-websocket reports a
     * group as a scene). Ours (followUrlWithName) or the producer's in OBS.
     * Everything this layer holds by name moves with it (`renameEverywhere`);
     * without that the rack keeps a row for a name OBS no longer has, and every
     * request made from it fails.
     *
     * OBS says nothing about the program or preview scene when one of those is
     * renamed, and SceneListChanged may land either side of this event — so a
     * scene that was mirrored is re-fetched under its new name if the list
     * handler got there first and dropped it.
     */
    client.on('InputNameChanged', ({ oldInputName, inputName }) => {
        if (alive()) renameEverywhere(oldInputName, inputName);
    });
    client.on('SceneNameChanged', ({ oldSceneName, sceneName }) => {
        if (!alive()) return;
        const { programScene, previewScene } = useObsStore.getState();
        const wasMirrored = session.tracked.has(oldSceneName)
            || oldSceneName === programScene || oldSceneName === previewScene;
        renameEverywhere(oldSceneName, sceneName);
        if (wasMirrored && !useObsStore.getState().sceneItems[sceneName]) track(sceneName, gen);
    });

    // A name taken by something NEW means the new thing from now on — an alias
    // left behind would send its requests to whatever used to be called that.
    // And it goes in the name book now, or a rename made after the next
    // disconnect would find no record of what it was called.
    client.on('InputCreated', ({ inputName, inputUuid }) => {
        if (!alive()) return;
        session.aliases.delete(inputName);
        replayRenames([{ uuid: inputUuid, name: inputName }]);
    });
    client.on('SceneCreated', ({ sceneName, sceneUuid }) => {
        if (!alive()) return;
        session.aliases.delete(sceneName);
        replayRenames([{ uuid: sceneUuid, name: sceneName }]);
    });

    // A name freed by one input can be taken by another, so a stale cache entry
    // would describe the wrong source rather than merely be out of date.
    client.on('InputRemoved', ({ inputName }) => {
        if (alive()) session.inputCache.delete(inputName);
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
 * and preview session.tracked, so anything a surface had opened has to re-ask.
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

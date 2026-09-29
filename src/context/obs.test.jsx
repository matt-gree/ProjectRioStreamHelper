import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore } from './store';

/*
 * OBS WebSocket layer contract tests.
 *
 * The load-bearing one is shutdown reconciliation: PRSH sets the OBS browser
 * source "Shutdown source when not visible" property so animated overlays get
 * a fresh load on every show (no stale-frame stutter), while `?intro=0`
 * sources stay resident. CLAUDE.md marks this "don't regress" — these tests
 * pin it against a fake obs-websocket-js client.
 */

// The whole fake lives in vi.hoisted so the vi.mock factory (hoisted above
// all imports) can reference it; `h.instances` hands each client to the test.
const h = vi.hoisted(() => {
    class FakeOBS {
        constructor() {
            this.handlers = {};
            this.calls = [];              // [requestType, payload] in order
            this.rpc = {};                // requestType -> response | fn(payload)
            // connect() invokes the client synchronously, so a test that needs
            // a failing/slow handshake stages it via h.nextConnectImpl BEFORE
            // calling connect — an assignment afterwards would be too late.
            this.connectImpl = h.nextConnectImpl
                ?? (async () => ({ obsWebSocketVersion: '5.3.0' }));
            h.nextConnectImpl = null;
            h.instances.push(this);
        }
        on(e, fn) { (this.handlers[e] ||= []).push(fn); }
        async connect(url, password, options) {
            this.connectOptions = options;
            return this.connectImpl(url, password, options);
        }
        async disconnect() {}
        async call(type, payload) {
            this.calls.push([type, payload]);
            const r = this.rpc[type];
            if (typeof r === 'function') return r(payload);
            return r ?? {};
        }
        fire(e, payload) { (this.handlers[e] || []).forEach(fn => fn(payload)); }
        callsOf(type) { return this.calls.filter(([t]) => t === type); }
    }
    return { instances: [], nextConnectImpl: null, FakeOBS };
});

/*
 * The real module's flags, because the store reads them to build its
 * subscription mask and a stub of zero would look like a passing test for a
 * connection subscribing to nothing. `All` is 4095 and deliberately does NOT
 * include the high-volume events above it — which is the whole point of the
 * SceneItemTransformChanged tests below.
 */
vi.mock('obs-websocket-js', () => ({
    default: h.FakeOBS,
    EventSubscription: { All: 4095, SceneItemTransformChanged: 524288 },
}));

import { useObsStore } from './obs';
import { notifications } from '../lib/notify';

const SETTINGS_INIT = useSettingsStore.getState();

const browserItem = (id, sourceName) => ({
    sceneItemId: id, sourceName, sceneItemEnabled: true,
    inputKind: 'browser_source', isGroup: false,
});

// Wire a FakeOBS's rpc for the standard connect → refreshAll flow: one scene
// ('Main') whose items are given as { name: { url, shutdown } }.
function sceneRpc(fake, sources, { program = 'Main' } = {}) {
    fake.rpc.GetStudioModeEnabled = { studioModeEnabled: false };
    fake.rpc.GetSceneList = {
        currentProgramSceneName: program,
        scenes: [{ sceneName: program }],
    };
    fake.rpc.GetSceneItemList = {
        sceneItems: Object.keys(sources).map((name, i) => browserItem(i + 1, name)),
    };
    fake.rpc.GetInputSettings = ({ inputName }) =>
        ({ inputSettings: sources[inputName] });
}

/*
 * Multi-scene rig: { sceneName: { sourceName: settings } }, program first.
 * Sources repeated across scenes are the same input, which is what makes the
 * GetInputSettings cache observable.
 */
function multiSceneRpc(fake, rig, { program, preview, studio = false } = {}) {
    const names = Object.keys(rig);
    fake.rpc.GetStudioModeEnabled = { studioModeEnabled: studio };
    fake.rpc.GetSceneList = {
        currentProgramSceneName: program ?? names[0],
        currentPreviewSceneName: preview ?? null,
        scenes: names.map(sceneName => ({ sceneName })),
    };
    fake.rpc.GetSceneItemList = ({ sceneName }) => ({
        sceneItems: Object.keys(rig[sceneName] || {}).map((n, i) => browserItem(i + 1, n)),
    });
    const all = Object.assign({}, ...Object.values(rig));
    fake.rpc.GetInputSettings = ({ inputName }) => ({ inputSettings: all[inputName] });
}

async function connectMulti(rig, opts) {
    const connectPromise = useObsStore.getState().connect();
    const fake = h.instances.at(-1);
    multiSceneRpc(fake, rig, opts);
    await connectPromise;
    return fake;
}

async function connectWith(sources, opts) {
    const connectPromise = useObsStore.getState().connect();
    const fake = h.instances.at(-1);
    sceneRpc(fake, sources, opts);
    await connectPromise;
    return fake;
}

beforeEach(() => {
    h.instances.length = 0;
    useSettingsStore.setState(
        { ...SETTINGS_INIT, loaded: true, obs: {}, controller_overlay: { port: 8069 } },
        true,
    );
});

afterEach(async () => {
    await useObsStore.getState().disconnect();  // clears client + reconnect timer
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const SB_URL = 'http://localhost:5260/layout/scoreboard1/scoreboard.html?scoreboard=1';

describe('connect + scene mirror', () => {
    it('mirrors scenes and enriches PRSH browser sources', async () => {
        const fake = await connectWith({
            SB: { url: SB_URL, shutdown: true },
            Cam: { url: null },
        });
        const s = useObsStore.getState();
        expect(s.status).toBe('connected');
        expect(s.obsVersion).toBe('5.3.0');
        expect(s.programScene).toBe('Main');
        expect(s.scenes).toEqual(['Main']);
        const items = s.sceneItems.Main;
        expect(items.find(i => i.sourceName === 'SB').isPrsh).toBe(true);
        expect(items.find(i => i.sourceName === 'Cam').isPrsh).toBe(false);
        expect(fake.callsOf('GetInputSettings').length).toBe(2);
    });

    it('recognizes the gc-overlay source by its configured port', async () => {
        await connectWith({
            GC: { url: 'http://localhost:8069/?port=2' },
        });
        expect(useObsStore.getState().sceneItems.Main[0].isPrsh).toBe(true);
    });

    it('reports a friendly auth error on code 4009', async () => {
        useSettingsStore.setState({ obs: { auto_connect: false } });   // no retry loop
        h.nextConnectImpl = async () => {
            throw Object.assign(new Error('boom'), { code: 4009 });
        };
        await useObsStore.getState().connect();
        const s = useObsStore.getState();
        expect(s.status).toBe('error');
        expect(s.error).toBe('Password rejected.');
    });

    /*
     * The likeliest OBS failure of all — nothing listening on the port —
     * closes with 1006 and an EMPTY reason, so obs-websocket-js raises an
     * Error whose message is '' and whose String() is the bare word "Error".
     * That word was the whole of what the console band printed.
     */
    it('names the address when a refused socket arrives with no message', async () => {
        useSettingsStore.setState({
            obs: { auto_connect: false, host: '192.168.1.40', port: 4455 },
        });
        h.nextConnectImpl = async () => {
            throw Object.assign(new Error(''), { code: 1006 });
        };
        await useObsStore.getState().connect();
        const s = useObsStore.getState();
        expect(s.status).toBe('error');
        expect(s.error).toBe('Nothing listening at 192.168.1.40:4455.');
    });

    it('disconnect clears the mirror', async () => {
        await connectWith({ SB: { url: SB_URL, shutdown: true } });
        await useObsStore.getState().disconnect();
        const s = useObsStore.getState();
        expect(s.status).toBe('disconnected');
        expect(s.sceneItems).toEqual({});
        expect(s.programScene).toBeNull();
    });
});

describe('shutdown-property reconciliation (do not regress)', () => {
    it('animated overlay missing shutdown gets shutdown:true', async () => {
        const fake = await connectWith({ SB: { url: SB_URL } });
        const writes = fake.callsOf('SetInputSettings');
        expect(writes).toEqual([['SetInputSettings', {
            inputName: 'SB', inputSettings: { shutdown: true }, overlay: true,
        }]]);
    });

    it('animated overlay already correct is left alone (idempotent)', async () => {
        const fake = await connectWith({ SB: { url: SB_URL, shutdown: true } });
        expect(fake.callsOf('SetInputSettings')).toEqual([]);
    });

    it('intro=0 overlay is reconciled to shutdown:false (resident)', async () => {
        const fake = await connectWith({
            SB: { url: SB_URL + '&intro=0', shutdown: true },
        });
        expect(fake.callsOf('SetInputSettings')[0][1].inputSettings)
            .toEqual({ shutdown: false });
    });

    /*
     * The post-game callouts animate on show like the band elements do, and
     * they were left out of the animated set — so their sources stayed
     * resident and OBS composited the retained full-alpha frame of the
     * FINISHED graphic for a beat before the intro started. Their in-page
     * reveal gate can't cover this one: the OBS-native eye stops the source's
     * frames before any snap-dark is painted, so a fresh load per show is the
     * cure. Both files, because they are two separate sources.
     */
    it('post-game callouts are animated overlays (shutdown:true)', async () => {
        const fake = await connectWith({
            Spot: { url: 'http://localhost:5260/layout/postgame/spotlight.html?scoreboard=1' },
            Summary: { url: 'http://localhost:5260/layout/postgame/summary.html' },
        });
        expect(fake.callsOf('SetInputSettings').map(c => [c[1].inputName, c[1].inputSettings]))
            .toEqual([['Spot', { shutdown: true }], ['Summary', { shutdown: true }]]);
    });

    it('static PRSH overlays (nothing animates) are never touched', async () => {
        const fake = await connectWith({
            Stats: { url: 'http://localhost:5260/layout/scoreboard1/statsbar.html?team=1' },
            Bracket: { url: 'http://localhost:5260/layout/bracket/bracket.html' },
        });
        expect(fake.callsOf('SetInputSettings')).toEqual([]);
    });

    it('non-PRSH browser sources are never touched', async () => {
        const fake = await connectWith({
            Chat: { url: 'https://example.com/chat.html' },
        });
        expect(fake.callsOf('SetInputSettings')).toEqual([]);
    });
});

describe('addBrowserSource', () => {
    it('creates the input with the shutdown property derived from its url', async () => {
        const fake = await connectWith({});
        fake.rpc.GetInputList = { inputs: [] };
        const res = await useObsStore.getState().addBrowserSource({
            inputName: 'PRSH Scoreboard', url: SB_URL, width: 800, height: 460,
        });
        expect(res).toEqual({ inputName: 'PRSH Scoreboard', sceneName: 'Main', enabled: true });
        const [, payload] = fake.callsOf('CreateInput')[0];
        expect(payload.inputKind).toBe('browser_source');
        expect(payload.sceneItemEnabled).toBe(true);
        expect(payload.inputSettings).toMatchObject({
            url: SB_URL, width: 800, height: 460, shutdown: true,
        });
    });

    // The Production console's source strip adds hidden: creating a source
    // mid-broadcast must never put it on air (production-console-contract).
    it('creates the scene item hidden when enabled: false', async () => {
        const fake = await connectWith({});
        fake.rpc.GetInputList = { inputs: [] };
        const res = await useObsStore.getState().addBrowserSource({
            inputName: 'PRSH Scoreboard', url: SB_URL, width: 800, height: 460, enabled: false,
        });
        expect(res.enabled).toBe(false);
        const [, payload] = fake.callsOf('CreateInput')[0];
        expect(payload.sceneItemEnabled).toBe(false);
    });

    it('suffixes on input-name collision instead of failing', async () => {
        const fake = await connectWith({});
        fake.rpc.GetInputList = {
            inputs: [{ inputName: 'Overlay' }, { inputName: 'Overlay 2' }],
        };
        const res = await useObsStore.getState().addBrowserSource({
            inputName: 'Overlay', url: SB_URL,
        });
        expect(res.inputName).toBe('Overlay 3');
    });

    it('throws without an active program scene', async () => {
        const fake = await connectWith({}, { program: null });
        fake.rpc.GetSceneList = {};
        await expect(useObsStore.getState().addBrowserSource({
            inputName: 'X', url: SB_URL,
        })).rejects.toThrow(/program scene/i);
    });
});

describe('setLayoutIntroDisabled', () => {
    it('rewrites intro param and shutdown in lockstep for every variant', async () => {
        const fake = await connectWith({
            SB1: { url: SB_URL, shutdown: true },
            SB2: { url: SB_URL.replace('scoreboard=1', 'scoreboard=2'), shutdown: true },
            Other: { url: 'http://localhost:5260/layout/lowerthird/lowerthird.html', shutdown: true },
        });
        fake.calls.length = 0;
        const changed = await useObsStore.getState().setLayoutIntroDisabled(
            '/layout/scoreboard1/scoreboard.html', true);
        expect(changed).toBe(2);
        const writes = fake.callsOf('SetInputSettings');
        expect(writes.map(([, p]) => p.inputName).sort()).toEqual(['SB1', 'SB2']);
        for (const [, p] of writes) {
            expect(p.inputSettings.url).toContain('intro=0');
            expect(p.inputSettings.shutdown).toBe(false);
        }
    });

    it('re-enabling intro removes the param and restores shutdown:true', async () => {
        const fake = await connectWith({
            SB: { url: SB_URL + '&intro=0', shutdown: false },
        });
        fake.calls.length = 0;
        const changed = await useObsStore.getState().setLayoutIntroDisabled(
            '/layout/scoreboard1/scoreboard.html', false);
        expect(changed).toBe(1);
        const [, p] = fake.callsOf('SetInputSettings')[0];
        expect(p.inputSettings.url).not.toContain('intro=');
        expect(p.inputSettings.shutdown).toBe(true);
    });
});

describe('setSceneItemEnabled (two-phase hide)', () => {
    it('cues overlay.conceal before disabling a PRSH overlay', async () => {
        const fake = await connectWith({ SB: { url: SB_URL, shutdown: true } });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        vi.useFakeTimers();

        const p = useObsStore.getState().setSceneItemEnabled('Main', 1, false);
        await vi.advanceTimersByTimeAsync(300);   // the 250ms settle window
        await p;

        expect(fetchMock).toHaveBeenCalledWith('/api/v1/action',
            expect.objectContaining({ method: 'POST' }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            action: 'overlay.conceal', payload: { url: SB_URL },
        });
        // why: the conceal cue must land BEFORE the disable, or OBS freezes
        // the still-visible frame into the source texture (the stutter).
        const disable = fake.callsOf('SetSceneItemEnabled');
        expect(disable).toEqual([['SetSceneItemEnabled',
            { sceneName: 'Main', sceneItemId: 1, sceneItemEnabled: false }]]);
    });

    it('showing (enable) and non-PRSH sources skip the conceal cue', async () => {
        const fake = await connectWith({
            SB: { url: SB_URL, shutdown: true },
            Chat: { url: 'https://example.com/chat.html' },
        });
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await useObsStore.getState().setSceneItemEnabled('Main', 1, true);   // show
        await useObsStore.getState().setSceneItemEnabled('Main', 2, false);  // non-PRSH hide
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fake.callsOf('SetSceneItemEnabled').length).toBe(2);
    });
});

/*
 * Lazy multi-scene mirroring. Program + preview are eager; every other scene
 * joins only when a surface asks (mirrorScene), and from then on its scene-item
 * events are honoured — staging a Break scene before cutting to it is the whole
 * point, and it is impossible with a program+preview-only mirror.
 */
describe('lazy scene mirroring', () => {
    const RIG = {
        Main: { SB: { url: SB_URL, shutdown: true } },
        Break: { Card: { url: 'http://localhost:5260/layout/scenes/break.html' } },
        Intro: { Logo: { url: 'http://localhost:5260/layout/scenes/intro.html' } },
    };

    it('mirrors only program at connect, leaving other scenes untouched', async () => {
        const fake = await connectMulti(RIG);
        const s = useObsStore.getState();
        expect(s.scenes).toEqual(['Main', 'Break', 'Intro']);
        expect(Object.keys(s.sceneItems)).toEqual(['Main']);
        expect(s.mirroredScenes).toEqual(['Main']);
        expect(fake.callsOf('GetSceneItemList').map(([, p]) => p.sceneName)).toEqual(['Main']);
    });

    it('mirrors program AND preview eagerly in studio mode', async () => {
        await connectMulti(RIG, { program: 'Main', preview: 'Break', studio: true });
        const s = useObsStore.getState();
        expect(s.mirroredScenes.sort()).toEqual(['Break', 'Main']);
        expect(s.sceneItems.Break[0].sourceName).toBe('Card');
    });

    it('mirrorScene pulls a scene in on demand', async () => {
        await connectMulti(RIG);
        await useObsStore.getState().mirrorScene('Break');
        const s = useObsStore.getState();
        expect(s.sceneItems.Break.map(i => i.sourceName)).toEqual(['Card']);
        expect(s.sceneItems.Break[0].isPrsh).toBe(true);
        expect(s.mirroredScenes).toContain('Break');
        expect(s.sceneItems.Intro).toBeUndefined();
    });

    it('a second mirrorScene for the same scene does not refetch', async () => {
        const fake = await connectMulti(RIG);
        await useObsStore.getState().mirrorScene('Break');
        fake.calls.length = 0;
        await useObsStore.getState().mirrorScene('Break');
        expect(fake.callsOf('GetSceneItemList')).toEqual([]);
    });

    // The reason lazy mirroring needs an event fix: before it, handlers
    // refreshed whatever scene an event named.
    it('scene-item events are honoured for a lazily-mirrored scene', async () => {
        const fake = await connectMulti(RIG);
        await useObsStore.getState().mirrorScene('Break');
        RIG.Break.Card2 = { url: 'http://localhost:5260/layout/scenes/break2.html' };
        multiSceneRpc(fake, RIG);
        fake.fire('SceneItemCreated', { sceneName: 'Break' });
        await vi.waitFor(() =>
            expect(useObsStore.getState().sceneItems.Break.length).toBe(2));
        delete RIG.Break.Card2;
    });

    it('an event for an untracked scene does not pull it into the mirror', async () => {
        const fake = await connectMulti(RIG);
        fake.calls.length = 0;
        fake.fire('SceneItemCreated', { sceneName: 'Intro' });
        fake.fire('SceneItemListReindexed', { sceneName: 'Intro' });
        expect(fake.callsOf('GetSceneItemList')).toEqual([]);
        expect(useObsStore.getState().sceneItems.Intro).toBeUndefined();
    });

    it('a deleted scene drops out of the mirror', async () => {
        const fake = await connectMulti(RIG);
        await useObsStore.getState().mirrorScene('Break');
        fake.fire('SceneListChanged', { scenes: [{ sceneName: 'Main' }, { sceneName: 'Intro' }] });
        const s = useObsStore.getState();
        expect(s.sceneItems.Break).toBeUndefined();
        expect(s.mirroredScenes).toEqual(['Main']);
    });

    it('a lazily-mirrored scene survives a studio-mode refreshAll', async () => {
        const fake = await connectMulti(RIG);
        await useObsStore.getState().mirrorScene('Intro');
        multiSceneRpc(fake, RIG, { program: 'Main', preview: 'Break', studio: true });
        fake.fire('StudioModeStateChanged', { studioModeEnabled: true });
        await vi.waitFor(() =>
            expect(useObsStore.getState().mirroredScenes.sort())
                .toEqual(['Break', 'Intro', 'Main']));
    });

    it('a reconnect starts over with only the eager scenes', async () => {
        await connectMulti(RIG);
        await useObsStore.getState().mirrorScene('Break');
        // A reconnect awaits the old client's disconnect before building the
        // new one, so gate the handshake to stage rpc on the right instance.
        let release;
        const gate = new Promise(r => { release = r; });
        h.nextConnectImpl = async () => { await gate; return { obsWebSocketVersion: '5.3.0' }; };
        const again = useObsStore.getState().connect();
        await vi.waitFor(() => expect(h.instances.length).toBe(2));
        multiSceneRpc(h.instances.at(-1), RIG);
        release();
        await again;
        expect(useObsStore.getState().mirroredScenes).toEqual(['Main']);
        expect(useObsStore.getState().sceneItems.Break).toBeUndefined();
    });
});

/*
 * The fan-out this phase had to mitigate: GetInputSettings was one round trip
 * per browser source PER SCENE. Fine at two scenes, not at N.
 */
describe('input-settings cache', () => {
    const SHARED = {
        Main: { SB: { url: SB_URL, shutdown: true }, Cam: { url: null } },
        Break: { SB: { url: SB_URL, shutdown: true }, Card: { url: null } },
    };

    it('a source shared by two scenes is fetched once', async () => {
        const fake = await connectMulti(SHARED);
        await useObsStore.getState().mirrorScene('Break');
        const names = fake.callsOf('GetInputSettings').map(([, p]) => p.inputName);
        expect(names.filter(n => n === 'SB').length).toBe(1);
        expect(useObsStore.getState().sceneItems.Break.find(i => i.sourceName === 'SB').isPrsh)
            .toBe(true);
    });

    it('shutdown reconciliation still runs exactly once per source', async () => {
        const fake = await connectMulti({
            Main: { SB: { url: SB_URL } },        // missing shutdown → needs the write
            Break: { SB: { url: SB_URL } },
        });
        await useObsStore.getState().mirrorScene('Break');
        expect(fake.callsOf('SetInputSettings').length).toBe(1);
    });

    it('InputSettingsChanged patches every mirrored copy without refetching', async () => {
        const fake = await connectMulti(SHARED);
        await useObsStore.getState().mirrorScene('Break');
        fake.calls.length = 0;

        const moved = SB_URL.replace('scoreboard=1', 'scoreboard=2');
        fake.fire('InputSettingsChanged', {
            inputName: 'SB', inputSettings: { url: moved, shutdown: true },
        });

        const s = useObsStore.getState();
        expect(s.sceneItems.Main.find(i => i.sourceName === 'SB').url).toBe(moved);
        expect(s.sceneItems.Break.find(i => i.sourceName === 'SB').url).toBe(moved);
        expect(fake.callsOf('GetSceneItemList')).toEqual([]);
        expect(fake.callsOf('GetInputSettings')).toEqual([]);
    });

    // A url edited in OBS to add ?intro=0 must still flip the shutdown
    // property — the reconciliation can't only live on the fetch path.
    it('InputSettingsChanged re-reconciles shutdown for the new url', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.calls.length = 0;
        fake.fire('InputSettingsChanged', {
            inputName: 'SB', inputSettings: { url: SB_URL + '&intro=0', shutdown: true },
        });
        expect(fake.callsOf('SetInputSettings')[0][1].inputSettings).toEqual({ shutdown: false });
    });

    it('a settled url does not bounce a write back (no echo loop)', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.calls.length = 0;
        fake.fire('InputSettingsChanged', {
            inputName: 'SB', inputSettings: { url: SB_URL, shutdown: true },
        });
        expect(fake.callsOf('SetInputSettings')).toEqual([]);
    });

    it('InputRemoved evicts the entry so a reused name is refetched', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.fire('InputRemoved', { inputName: 'SB' });
        fake.calls.length = 0;
        fake.fire('SceneItemCreated', { sceneName: 'Main' });
        await vi.waitFor(() =>
            expect(fake.callsOf('GetInputSettings').length).toBe(1));
    });
});

describe('events + reconnect', () => {
    it('SceneItemEnableStateChanged updates the mirrored enabled flag', async () => {
        const fake = await connectWith({ SB: { url: SB_URL, shutdown: true } });
        fake.fire('SceneItemEnableStateChanged',
            { sceneName: 'Main', sceneItemId: 1, sceneItemEnabled: false });
        expect(useObsStore.getState().sceneItems.Main[0].enabled).toBe(false);
    });

    it('ConnectionClosed schedules a reconnect with backoff', async () => {
        const fake = await connectWith({ SB: { url: SB_URL, shutdown: true } });
        vi.useFakeTimers();
        fake.fire('ConnectionClosed', {});
        expect(useObsStore.getState().status).toBe('disconnected');

        const before = h.instances.length;
        await vi.advanceTimersByTimeAsync(2100);   // first backoff step is 2s
        expect(h.instances.length).toBe(before + 1);   // a fresh client connected
    });

    it('auto_connect=false suppresses the reconnect', async () => {
        const fake = await connectWith({ SB: { url: SB_URL, shutdown: true } });
        useSettingsStore.setState({ obs: { auto_connect: false } });
        vi.useFakeTimers();
        fake.fire('ConnectionClosed', {});
        const before = h.instances.length;
        await vi.advanceTimersByTimeAsync(60000);
        expect(h.instances.length).toBe(before);
    });

    /*
     * The console blanked every 30s with OBS closed: each backoff retry
     * published 'connecting', which useConsoleOffline does not count as
     * offline, so the rack's catalog tier was torn down and rebuilt around a
     * refused handshake that takes about a second. A retry nobody asked for
     * must not touch the status until it changes something.
     */
    it('a background reconnect stays silent while it retries', async () => {
        h.nextConnectImpl = async () => { throw new Error('refused'); };
        vi.useFakeTimers();
        await useObsStore.getState().connect();
        expect(useObsStore.getState().status).toBe('error');

        const seen = [];
        const unsub = useObsStore.subscribe(s => seen.push(s.status));

        // Hold the retry's handshake open, so a 'connecting' publish would be
        // plainly observable rather than a race we might miss.
        let release;
        const gate = new Promise(r => { release = r; });
        h.nextConnectImpl = async () => { await gate; throw new Error('refused'); };

        await vi.advanceTimersByTimeAsync(2100);   // first backoff step is 2s
        expect(useObsStore.getState().status).toBe('error');   // mid-handshake

        release();
        await vi.advanceTimersByTimeAsync(0);
        unsub();

        expect(seen).not.toContain('connecting');
        // Same failure as before, so the identical error isn't republished either.
        expect(seen).toEqual([]);
        expect(useObsStore.getState().status).toBe('error');
    });

    it('a producer-initiated connect still shows "connecting"', async () => {
        let release;
        const gate = new Promise(r => { release = r; });
        h.nextConnectImpl = async () => { await gate; throw new Error('refused'); };
        useSettingsStore.setState({ obs: { auto_connect: false } });   // no retry loop

        const pending = useObsStore.getState().connect();
        expect(useObsStore.getState().status).toBe('connecting');
        release();
        await pending;
        expect(useObsStore.getState().status).toBe('error');
    });

    /*
     * "The app hangs on Connecting to OBS if I don't have OBS open."
     *
     * With OBS closed on loopback the SYN is refused and connect() rejects at
     * once, so the console lands on 'error' and the catalog tier takes over. A
     * DROPPED SYN — host firewall, VPN, obs.host pointed at a machine that is
     * off — resolves and rejects never, and obs-websocket-js has no connect
     * timeout of its own. The status stayed 'connecting', which
     * useConsoleOffline deliberately does not count as offline, so the rack sat
     * on "Connecting to OBS…" with neither scenes nor catalog, forever.
     */
    it('a handshake that never lands fails instead of hanging', async () => {
        h.nextConnectImpl = () => new Promise(() => { /* never settles */ });
        useSettingsStore.setState({ obs: { auto_connect: false } });   // no retry loop
        vi.useFakeTimers();

        const pending = useObsStore.getState().connect();
        expect(useObsStore.getState().status).toBe('connecting');

        // Still pending well into the attempt — the timeout is a ceiling, not a
        // delay it waits out on every connect.
        await vi.advanceTimersByTimeAsync(4000);
        expect(useObsStore.getState().status).toBe('connecting');

        await vi.advanceTimersByTimeAsync(1100);
        await pending;

        expect(useObsStore.getState().status).toBe('error');
        expect(useObsStore.getState().error).toBe('No response from 127.0.0.1:4455.');
    });

    // The ceiling must not clip a slow-but-real handshake, and must not leave a
    // timer armed to reject a connection that already succeeded.
    it('does not time out a handshake that lands inside the window', async () => {
        let release;
        const gate = new Promise(r => { release = r; });
        h.nextConnectImpl = async () => {
            await gate;
            return { obsWebSocketVersion: '5.3.0' };
        };
        vi.useFakeTimers();

        const pending = useObsStore.getState().connect();
        await vi.advanceTimersByTimeAsync(4000);
        release();
        await pending;
        expect(useObsStore.getState().status).toBe('connected');

        await vi.advanceTimersByTimeAsync(10000);
        expect(useObsStore.getState().status).toBe('connected');
    });

    it('a superseded connection cannot clobber the store (generation guard)', async () => {
        let release;
        const gate = new Promise(r => { release = r; });
        h.nextConnectImpl = async () => {
            await gate;
            return { obsWebSocketVersion: 'stale' };
        };
        const first = useObsStore.getState().connect();
        // Second connect supersedes the first while it's still handshaking.
        const second = useObsStore.getState().connect();
        sceneRpc(h.instances.at(-1), {});
        await second;
        release();
        await first;
        expect(useObsStore.getState().obsVersion).toBe('5.3.0');   // not 'stale'
        expect(useObsStore.getState().status).toBe('connected');
    });
});

/*
 * ── "ALL" IS NOT ALL ────────────────────────────────────────────────────────
 *
 * obs-websocket sorts a few events it considers high-volume outside the default
 * subscription mask, and SceneItemTransformChanged is one of them — so a client
 * asking for "everything" is not told when a source's geometry moves.
 *
 * That is what broke the scaled-source badge, and it broke the way an
 * unsubscribed event always does: silently and asymmetrically. The verdict on
 * each item was computed correctly whenever a scene was mirrored, and then
 * frozen — so the badge appeared on a source the producer had dragged, and
 * would not clear when they fixed it.
 */
describe('scene item transforms', () => {
    // A scene item's geometry as OBS states it: an 800x200 browser source drawn
    // at 1:1, no crop, no bounding box.
    const transform = (over = {}) => ({
        sourceWidth: 800, sourceHeight: 200,
        scaleX: 1, scaleY: 1,
        cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
        boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0,
        ...over,
    });

    const connectOnce = () => connectMulti({
        Main: { 'Player Name 1': { url: 'http://x/layout/scoreboard1/playername.html' } },
    });

    it('subscribes to the high-volume transform event, not just All', async () => {
        const fake = await connectOnce();
        const mask = fake.connectOptions?.eventSubscriptions;
        expect(mask & 524288).toBeTruthy();
        expect(mask & 4095).toBeTruthy();
    });

    it('raises and CLEARS the scaled verdict as a producer drags', async () => {
        const fake = await connectOnce();
        const stretch = () => useObsStore.getState().sceneItems.Main?.[0]?.stretch;
        expect(stretch()).toBeNull();

        fake.fire('SceneItemTransformChanged', {
            sceneName: 'Main', sceneItemId: 1, sceneItemTransform: transform({ scaleX: 2, scaleY: 2 }),
        });
        expect(stretch()).toBe(2);

        // The half that was missing: putting it back has to put the badge back.
        fake.fire('SceneItemTransformChanged', {
            sceneName: 'Main', sceneItemId: 1, sceneItemTransform: transform(),
        });
        expect(stretch()).toBeNull();
    });

    /*
     * A drag emits one of these per frame. The verdict is what the rack draws,
     * so only a change in the verdict may reach the store — otherwise every
     * frame of a ten-second drag re-renders the console.
     */
    it('ignores a transform event that does not change the verdict', async () => {
        const fake = await connectOnce();
        fake.fire('SceneItemTransformChanged', {
            sceneName: 'Main', sceneItemId: 1, sceneItemTransform: transform({ scaleX: 2, scaleY: 2 }),
        });
        const before = useObsStore.getState().sceneItems.Main;
        fake.fire('SceneItemTransformChanged', {
            sceneName: 'Main', sceneItemId: 1,
            sceneItemTransform: transform({ scaleX: 2.001, scaleY: 2.001 }),
        });
        expect(useObsStore.getState().sceneItems.Main).toBe(before);
    });
});

/*
 * OBS's SOURCE LIST, as the rack reads it: top first, with each GROUP's
 * contents filed straight after it and addressed through the group.
 *
 * GetSceneItemList answers bottom-first, so a rack that took it verbatim read
 * upside down against the producer's own Sources dock; and it does not descend
 * into groups, so a PRSH source filed in a folder had no row at all.
 */
describe('source order and groups', () => {
    const LT_URL = 'http://localhost:5260/layout/lowerthird/lowerthird.html';
    const at = (id, sourceName, index, extra = {}) =>
        ({ ...browserItem(id, sourceName), sceneItemIndex: index, ...extra });

    async function connectGrouped({ groupEnabled = true } = {}) {
        const connectPromise = useObsStore.getState().connect();
        const fake = h.instances.at(-1);
        fake.rpc.GetStudioModeEnabled = { studioModeEnabled: false };
        fake.rpc.GetSceneList = { currentProgramSceneName: 'Main', scenes: [{ sceneName: 'Main' }] };
        // Bottom-first, as OBS answers: SB is drawn under everything.
        fake.rpc.GetSceneItemList = {
            sceneItems: [
                at(1, 'SB', 0),
                at(2, 'Graphics', 1, { inputKind: null, isGroup: true, sceneItemEnabled: groupEnabled }),
                at(3, 'Top', 2),
            ],
        };
        // Ids restart inside the group: 1 here is NOT the scoreboard.
        fake.rpc.GetGroupSceneItemList = ({ sceneName }) => (sceneName === 'Graphics'
            ? { sceneItems: [at(1, 'LT', 0), at(2, 'Inner', 1)] }
            : { sceneItems: [] });
        fake.rpc.GetInputSettings = ({ inputName }) => ({
            inputSettings: { url: inputName === 'LT' ? LT_URL : SB_URL },
        });
        await connectPromise;
        return fake;
    }

    const names = () => useObsStore.getState().sceneItems.Main.map(i => i.sourceName);

    it('stores the scene top-first, the way the Sources dock lists it', async () => {
        await connectGrouped();
        expect(names()).toEqual(['Top', 'Graphics', 'Inner', 'LT', 'SB']);
    });

    it('files a group’s contents under it, owned by the group', async () => {
        await connectGrouped({ groupEnabled: false });
        const lt = useObsStore.getState().sceneItems.Main.find(i => i.sourceName === 'LT');
        expect(lt).toMatchObject({ id: 1, group: 'Graphics', owner: 'Graphics', groupEnabled: false, isPrsh: true });
        const sb = useObsStore.getState().sceneItems.Main.find(i => i.sourceName === 'SB');
        expect(sb).toMatchObject({ id: 1, group: null, owner: 'Main' });
    });

    it('patches a grouped item from an event naming the group, not its twin id in the scene', async () => {
        const fake = await connectGrouped();
        fake.fire('SceneItemEnableStateChanged',
            { sceneName: 'Graphics', sceneItemId: 1, sceneItemEnabled: false });
        const items = useObsStore.getState().sceneItems.Main;
        expect(items.find(i => i.sourceName === 'LT').enabled).toBe(false);
        expect(items.find(i => i.sourceName === 'SB').enabled).toBe(true);
    });

    it('hiding the folder marks its contents hidden with it', async () => {
        const fake = await connectGrouped();
        fake.fire('SceneItemEnableStateChanged',
            { sceneName: 'Main', sceneItemId: 2, sceneItemEnabled: false });
        const items = useObsStore.getState().sceneItems.Main;
        expect(items.find(i => i.sourceName === 'LT').groupEnabled).toBe(false);
        expect(items.find(i => i.sourceName === 'Top').groupEnabled).toBe(true);
    });

    it('a change inside a group reloads the scene that lists it', async () => {
        const fake = await connectGrouped();
        fake.calls.length = 0;
        fake.fire('SceneItemListReindexed', { sceneName: 'Graphics' });
        await vi.waitFor(() =>
            expect(fake.callsOf('GetSceneItemList').map(([, p]) => p.sceneName)).toEqual(['Main']));
    });

    it('the conceal cue finds a grouped PRSH overlay by its owner', async () => {
        const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }));
        vi.stubGlobal('fetch', fetchSpy);
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const fake = await connectGrouped();
        const done = useObsStore.getState().setSceneItemEnabled('Graphics', 1, false);
        await vi.runAllTimersAsync();
        await done;
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body).payload.url).toBe(LT_URL);
        expect(fake.callsOf('SetSceneItemEnabled').at(-1)[1])
            .toEqual({ sceneName: 'Graphics', sceneItemId: 1, sceneItemEnabled: false });
    });
});

/*
 * RENAMES. OBS addresses everything by name and a producer can rename a source,
 * a scene or a group at any moment — so every name this layer holds has to
 * move with it, and a request made under the old name has to still land.
 */
describe('renames', () => {
    const LT_URL = 'http://localhost:5260/layout/lowerthird/lowerthird.html';

    it('a renamed source keeps its row, its url and its cache entry', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.calls.length = 0;
        fake.fire('InputNameChanged', { oldInputName: 'SB', inputName: 'Scoreboard' });
        const [item] = useObsStore.getState().sceneItems.Main;
        expect(item).toMatchObject({ sourceName: 'Scoreboard', url: SB_URL, isPrsh: true });
        // OBS now lists it under the new name; its settings are already cached.
        fake.rpc.GetSceneItemList = () => ({ sceneItems: [browserItem(1, 'Scoreboard')] });
        fake.fire('SceneItemCreated', { sceneName: 'Main' });
        await vi.waitFor(() => expect(fake.callsOf('GetSceneItemList').length).toBe(1));
        expect(fake.callsOf('GetInputSettings')).toEqual([]);
    });

    it('a request made under the old source name reaches the renamed source', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.fire('InputNameChanged', { oldInputName: 'SB', inputName: 'B' });
        fake.fire('InputNameChanged', { oldInputName: 'B', inputName: 'C' });
        await useObsStore.getState().repointBrowserSource({ sourceName: 'SB', url: SB_URL });
        expect(fake.callsOf('SetInputSettings').at(-1)[1].inputName).toBe('C');
    });

    it('a name reused by a NEW input means the new input', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.fire('InputNameChanged', { oldInputName: 'SB', inputName: 'Old' });
        fake.fire('InputCreated', { inputName: 'SB' });
        await useObsStore.getState().repointBrowserSource({ sourceName: 'SB', url: SB_URL });
        expect(fake.callsOf('SetInputSettings').at(-1)[1].inputName).toBe('SB');
    });

    it('renaming the program scene moves the mirror, and its events keep landing', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.fire('SceneNameChanged', { oldSceneName: 'Main', sceneName: 'Game' });
        fake.fire('SceneListChanged', { scenes: [{ sceneName: 'Game' }] });
        let s = useObsStore.getState();
        expect(s.programScene).toBe('Game');
        expect(s.scenes).toEqual(['Game']);
        expect(s.mirroredScenes).toEqual(['Game']);
        expect(s.sceneItems.Main).toBeUndefined();
        expect(s.sceneItems.Game[0]).toMatchObject({ sourceName: 'SB', owner: 'Game' });

        fake.fire('SceneItemEnableStateChanged',
            { sceneName: 'Game', sceneItemId: 1, sceneItemEnabled: false });
        s = useObsStore.getState();
        expect(s.sceneItems.Game[0].enabled).toBe(false);

        await useObsStore.getState().setSceneItemEnabled('Main', 1, true);
        expect(fake.callsOf('SetSceneItemEnabled').at(-1)[1].sceneName).toBe('Game');
    });

    it('re-mirrors the program scene when the list change beat the rename', async () => {
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.rpc.GetSceneItemList = () => ({ sceneItems: [browserItem(1, 'SB')] });
        fake.calls.length = 0;
        fake.fire('SceneListChanged', { scenes: [{ sceneName: 'Game' }] });
        fake.fire('SceneNameChanged', { oldSceneName: 'Main', sceneName: 'Game' });
        await vi.waitFor(() =>
            expect(useObsStore.getState().sceneItems.Game?.[0]?.sourceName).toBe('SB'));
        expect(useObsStore.getState().programScene).toBe('Game');
        expect(fake.callsOf('GetSceneItemList').map(([, p]) => p.sceneName)).toEqual(['Game']);
    });

    it('renaming a group moves its item, its children’s owner and its reload route', async () => {
        const connectPromise = useObsStore.getState().connect();
        const fake = h.instances.at(-1);
        fake.rpc.GetStudioModeEnabled = { studioModeEnabled: false };
        fake.rpc.GetSceneList = { currentProgramSceneName: 'Main', scenes: [{ sceneName: 'Main' }] };
        fake.rpc.GetSceneItemList = {
            sceneItems: [{ ...browserItem(2, 'Graphics'), inputKind: null, isGroup: true }],
        };
        fake.rpc.GetGroupSceneItemList = () => ({ sceneItems: [browserItem(1, 'LT')] });
        fake.rpc.GetInputSettings = () => ({ inputSettings: { url: LT_URL } });
        await connectPromise;

        fake.fire('SceneNameChanged', { oldSceneName: 'Graphics', sceneName: 'Folder' });
        const items = () => useObsStore.getState().sceneItems.Main;
        expect(items().find(i => i.isGroup).sourceName).toBe('Folder');
        expect(items().find(i => i.sourceName === 'LT')).toMatchObject({ owner: 'Folder', group: 'Folder' });

        fake.fire('SceneItemEnableStateChanged',
            { sceneName: 'Folder', sceneItemId: 1, sceneItemEnabled: false });
        expect(items().find(i => i.sourceName === 'LT').enabled).toBe(false);

        fake.calls.length = 0;
        fake.fire('SceneItemListReindexed', { sceneName: 'Folder' });
        await vi.waitFor(() =>
            expect(fake.callsOf('GetSceneItemList').map(([, p]) => p.sceneName)).toEqual(['Main']));
    });

    it('moves a staged action’s key to the new name', async () => {
        const { useStagingStore, obsStageKey } = await import('./staging');
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        useStagingStore.getState().stage({
            key: obsStageKey('vis', ['Main'], 1), label: 'Hide SB', value: false, run: () => {},
        });
        useStagingStore.getState().stage({
            key: obsStageKey('board', ['SB']), label: 'Point SB', value: 2, run: () => {},
        });
        fake.fire('SceneNameChanged', { oldSceneName: 'Main', sceneName: 'Game' });
        fake.fire('InputNameChanged', { oldInputName: 'SB', inputName: 'Scoreboard' });
        const { order, pending } = useStagingStore.getState();
        expect(order).toEqual([obsStageKey('vis', ['Game'], 1), obsStageKey('board', ['Scoreboard'])]);
        expect(pending[obsStageKey('vis', ['Game'], 1)].label).toBe('Hide SB');
        useStagingStore.getState().discardAll();
    });

    it('a Keep size answer follows its source', async () => {
        const mem = new Map([['prsh.ui.production.keptCanvases', JSON.stringify(['SB@452x118', 'X@1x1'])]]);
        vi.stubGlobal('localStorage', {
            getItem: k => (mem.has(k) ? mem.get(k) : null),
            setItem: (k, v) => mem.set(k, String(v)),
            removeItem: k => mem.delete(k),
        });
        const fake = await connectMulti({ Main: { SB: { url: SB_URL, shutdown: true } } });
        fake.fire('InputNameChanged', { oldInputName: 'SB', inputName: 'A@B' });
        expect(JSON.parse(localStorage.getItem('prsh.ui.production.keptCanvases')))
            .toEqual(['A@B@452x118', 'X@1x1']);
    });
});

/*
 * RENAMES NOBODY WAS LISTENING FOR. OBS 30+ gives inputs and scenes a uuid that
 * survives a rename, so the name this browser last saw it under is replayed as
 * a rename on the next connect — and staged work naming something OBS no
 * longer has is dropped before it can fail at Go Live.
 */
describe('renames while disconnected', () => {
    let mem;
    let shown;
    beforeEach(() => {
        mem = new Map();
        vi.stubGlobal('localStorage', {
            getItem: k => (mem.has(k) ? mem.get(k) : null),
            setItem: (k, v) => mem.set(k, String(v)),
            removeItem: k => mem.delete(k),
        });
        shown = [];
        vi.spyOn(notifications, 'show').mockImplementation((o) => { shown.push(o); });
    });
    afterEach(async () => {
        const { useStagingStore } = await import('./staging');
        useStagingStore.getState().discardAll();
        vi.restoreAllMocks();
    });

    const book = () => JSON.parse(mem.get('prsh.obs.nameBook') || '{}');

    // One program scene; `scenes`/`inputs` are [name, uuid] pairs as OBS lists them now.
    async function connectAs({ scenes, inputs = [], groups = [], items = [] }) {
        const p = useObsStore.getState().connect();
        const fake = h.instances.at(-1);
        fake.rpc.GetStudioModeEnabled = { studioModeEnabled: false };
        fake.rpc.GetSceneList = {
            currentProgramSceneName: scenes[0][0],
            scenes: scenes.map(([sceneName, sceneUuid]) => ({ sceneName, sceneUuid })),
        };
        fake.rpc.GetInputList = { inputs: inputs.map(([inputName, inputUuid]) => ({ inputName, inputUuid })) };
        fake.rpc.GetGroupList = { groups };
        fake.rpc.GetSceneItemList = { sceneItems: items };
        fake.rpc.GetGroupSceneItemList = { sceneItems: [] };
        fake.rpc.GetInputSettings = () => ({ inputSettings: { url: SB_URL, shutdown: true } });
        await p;
        return fake;
    }

    it('records what it sees, and replays an offline scene rename into the rack layout', async () => {
        const { followRename } = await import('../routes/production/sources/renames');
        expect(followRename).toBeTypeOf('function');   // registered on import
        await connectAs({ scenes: [['Game', 's1'], ['Break', 's2']], inputs: [['SB', 'i1']] });
        expect(book()).toEqual({ s1: 'Game', s2: 'Break', i1: 'SB' });
        await useObsStore.getState().disconnect();

        mem.set('prsh.ui.production.hiddenScenes', JSON.stringify(['Break']));
        mem.set('prsh.ui.production.rail', JSON.stringify(['scoreboard:1@Break']));
        await connectAs({ scenes: [['Game', 's1'], ['Intermission', 's2']], inputs: [['SB', 'i1']] });
        expect(JSON.parse(mem.get('prsh.ui.production.hiddenScenes'))).toEqual(['Intermission']);
        expect(JSON.parse(mem.get('prsh.ui.production.rail'))).toEqual(['scoreboard:1@Intermission']);
        expect(book().s2).toBe('Intermission');
    });

    it('re-keys a staged change and still delivers it after an offline source rename', async () => {
        const { useStagingStore, obsStageKey } = await import('./staging');
        mem.set('prsh.obs.nameBook', JSON.stringify({ i1: 'SB' }));
        useStagingStore.getState().stage({
            key: obsStageKey('board', ['SB']), label: 'Point SB', value: 2,
            run: () => useObsStore.getState().repointBrowserSource({ sourceName: 'SB', url: SB_URL }),
        });
        const fake = await connectAs({ scenes: [['Game', 's1']], inputs: [['Scoreboard', 'i1']] });
        expect(useStagingStore.getState().order).toEqual([obsStageKey('board', ['Scoreboard'])]);
        await useStagingStore.getState().commit();
        expect(fake.callsOf('SetInputSettings').at(-1)[1].inputName).toBe('Scoreboard');
        expect(shown).toEqual([]);
    });

    it('drops staged changes naming something gone, and says so', async () => {
        const { useStagingStore, obsStageKey } = await import('./staging');
        useStagingStore.getState().stage({
            key: obsStageKey('vis', ['Deleted scene'], 3), label: 'Hide SB', value: false, run: () => {},
        });
        useStagingStore.getState().stage({
            key: obsStageKey('vis', ['Game'], 1), label: 'Show SB', value: true, run: () => {},
        });
        await connectAs({ scenes: [['Game', 's1']] });
        expect(useStagingStore.getState().order).toEqual([obsStageKey('vis', ['Game'], 1)]);
        expect(shown).toHaveLength(1);
        expect(shown[0].message).toContain('Hide SB');
    });

    it('a swap offline keeps each thing’s layout apart and redirects neither old name', async () => {
        const { useStagingStore, obsStageKey } = await import('./staging');
        mem.set('prsh.obs.nameBook', JSON.stringify({ u1: 'A', u2: 'B' }));
        mem.set('prsh.ui.production.keptCanvases', JSON.stringify(['A@452x118']));
        useStagingStore.getState().stage({
            key: obsStageKey('board', ['A']), label: 'Point A', value: 2, run: () => {},
        });
        const fake = await connectAs({ scenes: [['Game', 's1']], inputs: [['B', 'u1'], ['A', 'u2']] });
        expect(JSON.parse(mem.get('prsh.ui.production.keptCanvases'))).toEqual(['B@452x118']);
        // Ambiguous: its run captured "A", which now names the other source.
        expect(useStagingStore.getState().order).toEqual([]);
        expect(shown[0].message).toContain('Point A');
        await useObsStore.getState().repointBrowserSource({ sourceName: 'A', url: SB_URL });
        expect(fake.callsOf('SetInputSettings').at(-1)[1].inputName).toBe('A');
    });

    it('a group’s uuid is learnt from the scene holding it', async () => {
        const group = { ...browserItem(2, 'Graphics'), inputKind: null, isGroup: true, sourceUuid: 'g1' };
        await connectAs({ scenes: [['Game', 's1']], items: [group] });
        await vi.waitFor(() => expect(book().g1).toBe('Graphics'));
        await useObsStore.getState().disconnect();

        await import('../routes/production/sources/renames');
        mem.set('prsh.ui.production.folders', JSON.stringify(['Game\nGraphics']));
        await connectAs({ scenes: [['Game', 's1']], items: [{ ...group, sourceName: 'Folder' }] });
        await vi.waitFor(() =>
            expect(JSON.parse(mem.get('prsh.ui.production.folders'))).toEqual(['Game\nFolder']));
    });

    it('OBS 28/29 report no uuids, so nothing is recorded or replayed', async () => {
        await connectAs({ scenes: [['Game', undefined]], inputs: [['SB', undefined]] });
        expect(mem.has('prsh.obs.nameBook')).toBe(false);
    });
});

/*
 * THE CANVAS PROMPT: a Stat Bar / Stat Card built before its canvas grew is
 * offered a resize on connect — never resized unasked. Resize keeps each item
 * looking as it did (a crop keeps its area); Keep size is remembered.
 */
describe('retired-canvas prompt on connect', () => {
    const BAR = 'http://localhost:5260/layout/scoreboard1/statsbar.html?scoreboard=1&team=1';
    const CARD = 'http://localhost:5260/layout/scoreboard1/statscard.html?scoreboard=1&team=2';
    const sizeWrites = (fake) => fake.callsOf('SetInputSettings')
        .map(([, p]) => p).filter(p => 'width' in p.inputSettings);
    let shown;

    beforeEach(() => {
        shown = [];
        vi.spyOn(notifications, 'show').mockImplementation((o) => { shown.push(o); });
        // Node's own global localStorage shadows jsdom's in this runner and has
        // no setItem, so "Keep size is remembered" needs a real one to test.
        const mem = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k) => (mem.has(k) ? mem.get(k) : null),
            setItem: (k, v) => { mem.set(k, String(v)); },
            removeItem: (k) => { mem.delete(k); },
            clear: () => mem.clear(),
        });
    });
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    const prompt = () => shown.find(o => o.id === 'retired-canvases');

    async function connectRig(sources, transform = {}) {
        const connectPromise = useObsStore.getState().connect();
        const fake = h.instances.at(-1);
        sceneRpc(fake, sources);
        fake.rpc.GetInputList = { inputs: Object.keys(sources).map(inputName => ({ inputName })) };
        const list = fake.rpc.GetSceneItemList;
        fake.rpc.GetSceneItemList = () => ({
            sceneItems: list.sceneItems.map(it => ({ ...it, sceneItemTransform: transform })),
        });
        await connectPromise;
        return fake;
    }

    it('asks, and writes nothing until the producer answers', async () => {
        const fake = await connectRig({
            'Stat Bar — Side 1': { url: BAR, width: 452, height: 118 },
            'Stat Card — Side 2': { url: CARD, width: 380, height: 240 },
        });
        await vi.waitFor(() => expect(prompt()).toBeTruthy());
        expect(prompt().title).toBe('Resize 2 stat card sources in OBS?');
        expect(sizeWrites(fake)).toHaveLength(0);
    });

    it('Resize grows each source to its element\'s new size', async () => {
        const fake = await connectRig({
            'Stat Bar — Side 1': { url: BAR, width: 452, height: 118 },
            'Stat Card — Side 2': { url: CARD, width: 380, height: 240 },
        });
        await vi.waitFor(() => expect(prompt()).toBeTruthy());
        await prompt().action.onClick();
        expect(sizeWrites(fake)).toEqual(expect.arrayContaining([
            expect.objectContaining({ inputName: 'Stat Bar — Side 1', inputSettings: { width: 452, height: 174 } }),
            expect.objectContaining({ inputName: 'Stat Card — Side 2', inputSettings: { width: 380, height: 294 } }),
        ]));
    });

    it('Resize keeps a crop cutting the same area', async () => {
        const fake = await connectRig(
            { 'Bar': { url: BAR, width: 452, height: 118 } },
            { cropBottom: 10, boundsType: 'OBS_BOUNDS_NONE' },
        );
        await vi.waitFor(() => expect(prompt()).toBeTruthy());
        await prompt().action.onClick();
        expect(sizeWrites(fake)).toHaveLength(1);
        const patches = fake.callsOf('SetSceneItemTransform').map(([, p]) => p.sceneItemTransform);
        expect(patches).toContainEqual({ cropBottom: 66 });
    });

    it('Keep size touches nothing and is not asked again', async () => {
        const rig = { 'Bar': { url: BAR, width: 452, height: 118 } };
        const fake = await connectRig(rig);
        await vi.waitFor(() => expect(prompt()).toBeTruthy());
        prompt().cancel.onClick();
        expect(sizeWrites(fake)).toHaveLength(0);

        shown = [];
        useObsStore.getState().disconnect();
        await connectRig(rig);
        await new Promise(r => setTimeout(r, 20));
        expect(prompt()).toBeUndefined();
    });

    it('never asks about a source already at the new size, or sized by hand', async () => {
        await connectRig({
            'Bar A': { url: BAR, width: 452, height: 174 },
            'Bar B': { url: BAR, width: 904, height: 236 },
        });
        await new Promise(r => setTimeout(r, 20));
        expect(prompt()).toBeUndefined();
    });
});

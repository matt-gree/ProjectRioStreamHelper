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
        async connect(url, password) { return this.connectImpl(url, password); }
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

vi.mock('obs-websocket-js', () => ({ default: h.FakeOBS }));

import { useObsStore } from './obs';

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
        expect(s.error).toMatch(/password/i);
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

    it('static PRSH overlays (nothing animates) are never touched', async () => {
        const fake = await connectWith({
            Stats: { url: 'http://localhost:5260/layout/scoreboard1/stats.html?team=1' },
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
        expect(useObsStore.getState().error).toMatch(/within 5s/);
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

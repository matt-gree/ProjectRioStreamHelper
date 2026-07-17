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
        expect(res).toEqual({ inputName: 'PRSH Scoreboard', sceneName: 'Main' });
        const [, payload] = fake.callsOf('CreateInput')[0];
        expect(payload.inputKind).toBe('browser_source');
        expect(payload.inputSettings).toMatchObject({
            url: SB_URL, width: 800, height: 460, shutdown: true,
        });
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

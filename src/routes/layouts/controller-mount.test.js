import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountController, watchesSetting } from '../../../public/layout/lib/controller-mount.js';

/*
 * The URL `lib/controller-mount.js` hands gc-overlay.
 *
 * Every part of this query string is silent when it is wrong. gc-overlay is a
 * separate program on a separate port, and PRSH's only contract with it is a
 * URL — so nothing in either codebase fails, or logs, or renders differently in
 * a preview when a param is dropped. It just goes out on air wrong:
 *
 *   - `port`, untranslated, draws the WRONG player's controller (gc-overlay is
 *     1-indexed, the HUD is 0-indexed, and port 0 worked by accident).
 *   - `bg`, missing, lands an opaque #1a1a2e box in the OBS scene.
 *   - `gear` / `portlabel` / `status`, missing, put gc-overlay's interactive
 *     chrome — a settings button, a "P1" tag, a "Waiting for controller
 *     data..." line — on the broadcast.
 *   - the appearance params, resolved against the wrong layer, leave a
 *     producer's Connections setting reaching nothing, or an element's pin
 *     unable to disagree with it.
 *
 * That is the whole of the integration, so it is pinned here rather than left
 * to be caught by looking at a stream.
 */

// The mount reaches gc-overlay through PRSH's controller status endpoint, and
// reads state through the OverlayBase globals a Layout page would have set up.
const GC = 'http://localhost:8069';

function stubOverlayBase(state, settings = {}) {
    globalThis.OverlayBase = {
        BASE_URL: '',
        state,
        settings,
        blank: null,
        // Byte-for-byte the real one (overlay-base.js). An earlier stub here
        // dropped the `def` argument, which quietly made every "what does an
        // unset key resolve to" assertion below vacuous — the mount's default
        // could be changed to its opposite and the suite stayed green.
        deepGet: (obj, path, def) => {
            let cur = obj;
            for (const k of path.split('.')) {
                if (cur == null || typeof cur !== 'object') return def;
                cur = cur[k];
            }
            return (cur !== undefined && cur !== null) ? cur : def;
        },
        setBlank(msg) { this.blank = msg; },
    };
}

function stubStatus(status) {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => status }));
}

// One game, side 1 on controller port 0, side 2 on port 2 (both 0-indexed, as
// the HUD reports them).
const STATE = { score: { 1: { player: { 1: { port: 0 }, 2: { port: 2 } } } } };

async function frameSrc({ team = 1, state = STATE, portOverride = null, settings } = {}) {
    if (settings) stubOverlayBase(state, settings);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ctl = mountController({ host, sb: 1, team, portOverride });
    await ctl.update(state);
    const frame = host.querySelector('iframe');
    return { src: frame.src, hidden: frame.style.display === 'none', ctl, host };
}

describe('controller-mount → gc-overlay URL', () => {
    beforeEach(() => {
        stubOverlayBase(STATE);
        stubStatus({ running: true, url: GC });
    });
    afterEach(() => {
        document.body.innerHTML = '';
        delete globalThis.OverlayBase;
        delete globalThis.fetch;
        vi.restoreAllMocks();
    });

    it('translates the HUD port into gc-overlay\'s 1-indexed convention', async () => {
        // Side 1 sits on HUD port 0 — the case that used to work by accident.
        expect(new URL((await frameSrc({ team: 1 })).src).searchParams.get('port')).toBe('1');
        // Side 2 sits on HUD port 2 — the case that used to be off by one.
        expect(new URL((await frameSrc({ team: 2 })).src).searchParams.get('port')).toBe('3');
    });

    it('asks for a transparent background and no interactive chrome', async () => {
        const params = new URL((await frameSrc()).src).searchParams;
        expect(params.get('bg')).toBe('transparent');
        // gc-overlay's booleans: 0 is off.
        expect(params.get('gear')).toBe('0');
        expect(params.get('portlabel')).toBe('0');
        expect(params.get('status')).toBe('0');
    });

    it('keeps the chrome params out of the producer\'s reach', async () => {
        // These four are PRSH's, not settings: the only correct value is the one
        // PRSH already picks, so no element can move them.
        const params = new URL((await frameSrc()).src).searchParams;
        expect(params.get('bg')).toBe('transparent');
        expect(params.get('gear')).toBe('0');
        expect(params.get('portlabel')).toBe('0');
        expect(params.get('status')).toBe('0');
    });

    it('honours a fixed ?port= override, translating it the same way', async () => {
        const { src } = await frameSrc({ team: 2, portOverride: 0 });
        expect(new URL(src).searchParams.get('port')).toBe('1');
    });

    it('blanks, and names why, when the side has no port yet', async () => {
        const empty = { score: { 1: { player: { 1: {}, 2: {} } } } };
        stubOverlayBase(empty);
        const { hidden } = await frameSrc({ state: empty });
        expect(hidden).toBe(true);
        expect(globalThis.OverlayBase.blank).toMatch(/controller port/i);
    });

    it('blanks, and names why, when the reader is not running', async () => {
        stubStatus({ running: false, url: null });
        const { hidden, ctl } = await frameSrc();
        expect(hidden).toBe(true);
        expect(globalThis.OverlayBase.blank).toMatch(/reader/i);
        ctl.dispose(); // cancel the retry timer
    });
});

/*
 * Appearance, one layer.
 *
 * `overlays.controller.*` is the only source — the same namespace every other
 * element's look lives in — and it is shared by both ?team= sources, so it is
 * app-wide for every controller source. An app-wide copy on the Connections tab
 * with three-state pins over it existed briefly and bought nothing: a pin beat
 * the global, so touching one element silently cut it off from the control that
 * was supposed to drive it.
 */
describe('controller-mount → appearance', () => {
    beforeEach(() => {
        stubOverlayBase(STATE);
        stubStatus({ running: true, url: GC });
    });
    afterEach(() => {
        document.body.innerHTML = '';
        delete globalThis.OverlayBase;
        delete globalThis.fetch;
        vi.restoreAllMocks();
    });

    const paramsWith = async (settings) =>
        new URL((await frameSrc({ settings })).src).searchParams;

    it("falls back to gc-overlay's own defaults when nothing is set", async () => {
        // An untouched element must draw exactly what the reader draws
        // standalone, or adding a source would change its look for no reason.
        const p = await paramsWith({});
        expect(p.get('labels')).toBe('1');
        expect(p.get('keyline')).toBe('1');
        expect(p.get('idlefill')).toBe('0');
    });

    it('sends what the element is set to', async () => {
        const p = await paramsWith({
            overlays: { controller: { labels: false, keyline: true, idleFillOpacity: 0.4 } },
        });
        expect(p.get('labels')).toBe('0');
        expect(p.get('keyline')).toBe('1');
        expect(p.get('idlefill')).toBe('0.4');
    });

    it('honours a 0 opacity rather than treating it as unset', async () => {
        // 0 is a real answer — "hollow" — and falsy, so a truthiness check here
        // would quietly substitute the default.
        const p = await paramsWith({ overlays: { controller: { idleFillOpacity: 0 } } });
        expect(p.get('idlefill')).toBe('0');
    });

    it("keeps the opacity in gc-overlay's own 0-1 unit, never a percentage", async () => {
        // The console shows 40%; anything reaching the reader as `40` would be
        // rejected as out of range and the key skipped entirely.
        const p = await paramsWith({ overlays: { controller: { idleFillOpacity: 0.4 } } });
        expect(p.get('idlefill')).toBe('0.4');
    });

    it('clamps an out-of-range opacity instead of letting the reader drop it', async () => {
        expect((await paramsWith({ overlays: { controller: { idleFillOpacity: 4 } } })).get('idlefill')).toBe('1');
        expect((await paramsWith({ overlays: { controller: { idleFillOpacity: -2 } } })).get('idlefill')).toBe('0');
    });

    it('reloads the frame when a setting changes, and not when it does not', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        stubOverlayBase(STATE, { overlays: { controller: { keyline: true } } });
        const ctl = mountController({ host, sb: 1, team: 1 });
        const frame = host.querySelector('iframe');

        await ctl.update(STATE);
        const first = frame.src;
        expect(first).toContain('keyline=1');

        // Same state, same settings — the iframe must not be reloaded, or every
        // render would restart the reader's socket mid-broadcast.
        await ctl.update(STATE);
        expect(frame.src).toBe(first);

        globalThis.OverlayBase.settings.overlays.controller.keyline = false;
        await ctl.update(STATE);
        expect(frame.src).toContain('keyline=0');
    });
});

/*
 * What the page subscribes to. `shouldRenderSettings` is a filter, so a key
 * missing here does not error — the source just never notices the producer
 * changed it, on Connections or on its own panel.
 */
describe('watchesSetting', () => {
    it('wakes on the element\'s own settings', () => {
        expect(watchesSetting('overlays.controller.labels')).toBe(true);
        expect(watchesSetting('overlays.controller.idleFillOpacity')).toBe(true);
        // A whole-branch write, which is what a reset or an import sends.
        expect(watchesSetting('overlays.controller')).toBe(true);
    });

    it("ignores other elements' settings and the reader's own lifecycle keys", () => {
        expect(watchesSetting('overlays.scoreboard.labels')).toBe(false);
        expect(watchesSetting('overlays.global.accentColor')).toBe(false);
        // Path/port/auto-start move the SUBPROCESS, not what it draws; the
        // status endpoint is how this mount learns about those.
        expect(watchesSetting('controller_overlay.port')).toBe(false);
        expect(watchesSetting('controller_overlay.auto_start')).toBe(false);
        // The app-wide appearance block that used to live here is gone.
        expect(watchesSetting('controller_overlay.display.keyline')).toBe(false);
    });
});

/* global OverlayBase */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * OverlayBase's sample bundle — the mechanism behind both the catalog/picker
 * preview (`?sample=1`) and app-wide demo mode (state `production.sample`).
 *
 * These are the three rules the rest of the design leans on, and none of them
 * is visible from a mount:
 *   1. `OverlayBase.state` keeps ONE object identity for the life of the page.
 *      A dozen layouts destructure it once at module scope, so a getter or a
 *      swap strands them on whichever bundle was current when they loaded.
 *   2. Live state keeps flowing in while the sample is on screen, which is what
 *      makes leaving demo mode land on the CURRENT game rather than a stale one.
 *   3. A layout that declares no sample ignores the switch entirely, rather
 *      than blanking a working source.
 *
 * The overlay lib is a browser IIFE, not a module, so it's evaluated here
 * against jsdom with `fetch` and socket.io stubbed.
 */

const SRC = readFileSync('public/layout/lib/overlay-base.js', 'utf8');

/** Load overlay-base.js fresh at `search`, returning the socket-handler table. */
function loadBase(search, samples = {}) {
    window.history.replaceState({}, '', `/layout/test.html${search}`);
    delete window.OverlayBase;

    const handlers = {};
    const socket = {
        id: 'test-sid',
        on: (event, cb) => { handlers[event] = cb; },
        emit: () => {},
    };
    globalThis.io = () => socket;

    globalThis.fetch = vi.fn(async (url) => {
        const sample = Object.entries(samples).find(([stem]) =>
            url.includes(`/layout/preview/${stem}_sample.json`));
        if (sample) return { ok: true, json: async () => sample[1] };
        if (url.includes('/api/v1/state')) return { ok: true, json: async () => ({ live: 'yes' }) };
        if (url.includes('/api/v1/settings')) return { ok: true, json: async () => ({ overlays: { global: {} } }) };
        return { ok: false, json: async () => ({}) };
    });

    new Function(SRC)();
    return { handlers, socket };
}

/**
 * Fire a live state change the way the server's socket event would, then let
 * the base's serialized render loop drain (renders coalesce across microtasks).
 */
async function setLive(handlers, key, value) {
    handlers['v1.state.set']({ sid: 'server', key, value });
    await Promise.resolve();
    await Promise.resolve();
}

const SCOREBOARD_SAMPLE = { state: { 'score.{sb}': { inning: 5, batter: 'Petey' } } };

describe('OverlayBase sample bundle', () => {
    beforeEach(() => { document.documentElement.innerHTML = '<head></head><body></body>'; });
    afterEach(() => { vi.restoreAllMocks(); });

    it('?sample=1 renders the bundle instead of live state', async () => {
        const { handlers } = loadBase('?sample=1', { scoreboard: SCOREBOARD_SAMPLE });
        await OverlayBase.init({ render: () => {}, sample: 'scoreboard' });

        expect(OverlayBase.sampleActive).toBe(true);
        expect(OverlayBase.deepGet(OverlayBase.state, 'score.1.batter', null)).toBe('Petey');
        expect(OverlayBase.deepGet(OverlayBase.state, 'live', null)).toBe(null);

        // Live state is still fetched and still tracked underneath — that is
        // what makes leaving demo mode instant rather than a reload.
        expect(globalThis.fetch.mock.calls.some(([u]) => u.includes('/api/v1/state'))).toBe(true);
        await setLive(handlers, 'score.1.batter', 'Boo');
        expect(OverlayBase.deepGet(OverlayBase.state, 'score.1.batter', null)).toBe('Petey');

        // ?sample=1 is a page-scoped FORCE: the app-wide switch can't turn this
        // page's preview back into a live source underneath the producer.
        await setLive(handlers, 'production.sample', false);
        expect(OverlayBase.sampleActive).toBe(true);
    });

    it('keeps one store identity across the switch', async () => {
        // Layouts do `const { deepGet, state } = OverlayBase` once at module
        // scope — bracket/index.html, eventheader, controller, playername,
        // teamlogo, roster, both scenes. If the switch hands back a different
        // object (or a getter's value is captured), every one of them keeps
        // reading whichever bundle happened to be current at script time and
        // silently never sees demo mode.
        const { handlers } = loadBase('', { scoreboard: SCOREBOARD_SAMPLE });
        await OverlayBase.init({ render: () => {}, sample: 'scoreboard' });
        const captured = OverlayBase.state;

        await setLive(handlers, 'production.sample', true);
        expect(OverlayBase.state).toBe(captured);
        expect(OverlayBase.deepGet(captured, 'score.1.batter', null)).toBe('Petey');

        await setLive(handlers, 'production.sample', false);
        expect(OverlayBase.state).toBe(captured);
        expect(OverlayBase.deepGet(captured, 'live', null)).toBe('yes');
    });

    it('state production.sample switches demo mode on and off at runtime', async () => {
        const { handlers } = loadBase('', { scoreboard: SCOREBOARD_SAMPLE });
        const render = vi.fn();
        await OverlayBase.init({ render, sample: 'scoreboard' });

        // Live by default — no URL flag, switch off.
        expect(OverlayBase.sampleActive).toBe(false);
        expect(OverlayBase.deepGet(OverlayBase.state, 'live', null)).toBe('yes');

        render.mockClear();
        await setLive(handlers, 'production.sample', true);
        expect(OverlayBase.sampleActive).toBe(true);
        expect(OverlayBase.deepGet(OverlayBase.state, 'score.1.batter', null)).toBe('Petey');
        expect(render).toHaveBeenCalled();

        render.mockClear();
        await setLive(handlers, 'production.sample', false);
        expect(OverlayBase.sampleActive).toBe(false);
        expect(OverlayBase.deepGet(OverlayBase.state, 'live', null)).toBe('yes');
        expect(render).toHaveBeenCalled();
    });

    it('a live change under demo mode updates the live bundle without rendering', async () => {
        const { handlers } = loadBase('', { scoreboard: SCOREBOARD_SAMPLE });
        const render = vi.fn();
        await OverlayBase.init({ render, sample: 'scoreboard', shouldRender: () => true });
        await setLive(handlers, 'production.sample', true);

        render.mockClear();
        await setLive(handlers, 'score.1.inning', 9);
        expect(render).not.toHaveBeenCalled();

        // …but it landed, so flipping demo off shows the current game, not a
        // stale one from before demo mode started.
        await setLive(handlers, 'production.sample', false);
        expect(OverlayBase.deepGet(OverlayBase.state, 'score.1.inning', null)).toBe(9);
    });

    it('{sb} and {team} in bundle keys resolve against the page URL', async () => {
        loadBase('?sample=1&scoreboard=2', { scoreboard: SCOREBOARD_SAMPLE });
        await OverlayBase.init({ render: () => {}, sample: 'scoreboard' });

        expect(OverlayBase.deepGet(OverlayBase.state, 'score.2.batter', null)).toBe('Petey');
        expect(OverlayBase.deepGet(OverlayBase.state, 'score.1', null)).toBe(null);
    });

    it('reads the demo switch strictly — a stringy "false" is off', async () => {
        // PUT /api/v1/state is str-typed, so turning demo off over REST stores
        // the STRING "false". A plain truthiness check would leave every source
        // stuck on a fixture with no way back short of a reload.
        const { handlers } = loadBase('', { scoreboard: SCOREBOARD_SAMPLE });
        await OverlayBase.init({ render: () => {}, sample: 'scoreboard' });

        await setLive(handlers, 'production.sample', 'true');
        expect(OverlayBase.sampleActive).toBe(true);

        await setLive(handlers, 'production.sample', 'false');
        expect(OverlayBase.sampleActive).toBe(false);
    });

    it('a layout with no sample stays live under both switches', async () => {
        const { handlers } = loadBase('?sample=1', {});
        await OverlayBase.init({ render: () => {} });

        expect(OverlayBase.sampleActive).toBe(false);
        expect(OverlayBase.deepGet(OverlayBase.state, 'live', null)).toBe('yes');

        setLive(handlers, 'production.sample', true);
        expect(OverlayBase.sampleActive).toBe(false);
        expect(OverlayBase.deepGet(OverlayBase.state, 'live', null)).toBe('yes');
    });

    it('sample settings seed unset keys and never override the producer', async () => {
        loadBase('?sample=1', { scoreboard: SCOREBOARD_SAMPLE });
        globalThis.fetch.mockImplementation(async (url) => {
            if (url.includes('/layout/preview/scoreboard_sample.json'))
                return { ok: true, json: async () => SCOREBOARD_SAMPLE };
            if (url.includes('/api/v1/settings'))
                return { ok: true, json: async () => ({ overlays: { scorecard: { 1: { titleText: 'Real Event' } } } }) };
            return { ok: true, json: async () => ({}) };
        });

        await OverlayBase.init({
            render: () => {},
            fetchSettings: true,
            sample: {
                file: 'scoreboard',
                settings: {
                    'overlays.scorecard.{sb}.titleText': 'Project Rio Invitational',
                    'overlays.scorecard.{sb}.phaseText': 'Winners Final',
                },
            },
        });

        expect(OverlayBase.deepGet(OverlayBase.settings, 'overlays.scorecard.1.titleText', null)).toBe('Real Event');
        expect(OverlayBase.deepGet(OverlayBase.settings, 'overlays.scorecard.1.phaseText', null)).toBe('Winners Final');
    });

    it('says so in preview when the layout has no sample to show', async () => {
        loadBase('?preview=1&sample=1', {});
        await OverlayBase.init({ render: () => {} });

        const note = document.querySelector('[data-prsh-no-sample]');
        expect(note).not.toBeNull();
        expect(note.textContent).toContain('no sample data');
    });
});

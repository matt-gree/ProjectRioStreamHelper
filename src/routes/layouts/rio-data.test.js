import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/*
 * The shared overlay data helpers (`public/layout/lib/rio-data.js`).
 *
 * Two facts here are load-bearing for every stat overlay and were both wrong on
 * air, silently, because a stat card with an empty caption still looks like a
 * working stat card:
 *
 *   1. TRANSPORT IS DERIVED. `isHudSource` used to read
 *      `scoreboards.sources.{sb}.type`, which the binding model retired — a
 *      read-only migration fallback nothing writes any more, frozen at whatever
 *      it held before the migration. Board 1 carries the HUD iff the global
 *      `project_rio.hud_enabled` toggle is on (server/bindings.py `transport`),
 *      and `current_game.batting_line` is only offered on a HUD board, so
 *      getting this wrong takes out the live game line everywhere at once.
 *
 *   2. RATES ARE WRITTEN THE WAY BASEBALL WRITES THEM. No leading zero under 1,
 *      whole number kept above it. The Character Spotlight has always done this
 *      (postgame-callout-mount.js); the stat cards now match.
 *
 * rio-data.js is a plain script that assigns `window.RioData` (overlays load it
 * with a <script> tag, not an import), so it is evaluated here rather than
 * imported — which also means this test exercises the real file, load order and
 * all.
 */
const SRC = readFileSync('public/layout/lib/rio-data.js', 'utf8');

function deepGet(obj, path, def) {
    const keys = path.split('.');
    let cur = obj;
    for (const k of keys) {
        if (cur == null || typeof cur !== 'object') return def;
        cur = cur[k];
    }
    return (cur !== undefined && cur !== null) ? cur : def;
}

function load(settings) {
    window.OverlayBase = {
        BASE_URL: '', deepGet,
        charId: (n) => String(n || '').toLowerCase(),
        teamId: (n) => String(n || '').toLowerCase(),
        settings,
    };
    new Function(SRC).call(window);
    return window.RioData;
}

describe('isHudSource — derived transport, not a stored source type', () => {
    beforeEach(() => { delete window.RioData; });

    it('is true for board 1 when the global HUD toggle is on', () => {
        const rd = load({ project_rio: { hud_enabled: true } });
        expect(rd.isHudSource(1)).toBe(true);
        expect(rd.isHudSource('1')).toBe(true);
    });

    it('is false for board 1 when the global HUD toggle is off', () => {
        const rd = load({ project_rio: { hud_enabled: false } });
        expect(rd.isHudSource(1)).toBe(false);
    });

    it('is false for every board but 1, toggle or not', () => {
        const rd = load({ project_rio: { hud_enabled: true } });
        expect(rd.isHudSource(2)).toBe(false);
        expect(rd.isHudSource(5)).toBe(false);
    });

    it('ignores the retired scoreboards.sources key entirely', () => {
        // The shape a real user_data carries: board 1 left at 'manual' by the
        // migration while it has carried the HUD ever since. Reading this is
        // what took the game line off the air.
        const rd = load({
            project_rio: { hud_enabled: true },
            scoreboards: { sources: { 1: { type: 'manual' }, 2: { type: 'hud' } } },
        });
        expect(rd.isHudSource(1)).toBe(true);
        expect(rd.isHudSource(2)).toBe(false);
    });
});

describe('fmt3 — a rate the way baseball writes one', () => {
    beforeEach(() => { delete window.RioData; });

    it('drops the leading zero below 1 and keeps the whole number above it', () => {
        const rd = load({});
        expect(rd.fmt3(0)).toBe('.000');
        expect(rd.fmt3(0.417)).toBe('.417');
        expect(rd.fmt3(0.667)).toBe('.667');
        expect(rd.fmt3(1)).toBe('1.000');
        expect(rd.fmt3(1.667)).toBe('1.667');
        expect(rd.fmt3(2.5)).toBe('2.500');
    });
});

describe('getStatsLine — the game line rides the HUD transport', () => {
    beforeEach(() => { delete window.RioData; });

    const state = {
        score: { 1: {
            home_team: 2, half_inning: 'Top',
            batter: 'Yoshi', batter_roster_index: 0,
            stats: { 1: { character: { 0: {
                batting: { at_bats: 12, avg: 0.417, slg: 0.667, so_pct: 8 },
                current_game: { batting_line: '2 for 4, HR, 3 RBI' },
            } } } },
        } },
    };

    it('offers the current-game line and the "Game" label on a HUD board', () => {
        const rd = load({ project_rio: { hud_enabled: true } });
        const info = rd.getStatsLine(state, 1, 1);
        expect(info.gameLine).toBe('2 for 4, HR, 3 RBI');
        expect(info.bottomLabel).toBe('Game');
        expect(info.stats.map(s => s.value)).toEqual([12, '.417', '.667', '8.0%']);
    });

    it('falls back to the API caption when the board is not on the HUD', () => {
        const rd = load({ project_rio: { hud_enabled: false } });
        const info = rd.getStatsLine(state, 1, 1);
        expect(info.gameLine).toBe('');
        expect(info.bottomLabel).toBe('Tournament Stats');
    });
});

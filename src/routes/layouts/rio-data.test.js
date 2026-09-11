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
        expect(info.stats.map(s => s.value)).toEqual([12, '.417', '.667', '8%']);
    });

    it('falls back to the API caption when the board is not on the HUD', () => {
        const rd = load({ project_rio: { hud_enabled: false } });
        const info = rd.getStatsLine(state, 1, 1);
        expect(info.gameLine).toBe('');
        expect(info.bottomLabel).toBe('Tournament Stats');
    });
});

/*
 * Precision and width are ONE decision, stated twice: `width` is how many
 * characters a category needs at its widest, and the stat bar divides its band
 * in that ratio (layoutStatCells). Change a format without its width and the
 * cell is sized for a value that no longer exists — nothing throws, the column
 * is just wrong, or the value auto-fits smaller than the three beside it.
 */
describe('getStatsLine — precision and each category\'s width', () => {
    beforeEach(() => { delete window.RioData; });

    const side = (batting, pitching) => ({
        score: { 1: {
            home_team: 2, half_inning: batting ? 'Top' : 'Bottom',
            batter: 'Yoshi', batter_roster_index: 0,
            pitcher: 'Yoshi', pitcher_roster_index: 0,
            stats: { 1: { character: { 0: { batting, pitching } } } },
        } },
    });

    /* Whole percents, one decimal of ERA. Baseball writes ERA to two places;
     * this card is read at a glance, and the dropped digit is what keeps every
     * cell at 30px with nothing auto-fitting. */
    it('writes percentages whole and ERA to one decimal', () => {
        const rd = load({ project_rio: { hud_enabled: true } });
        const bat = rd.getStatsLine(side({ at_bats: 21, avg: 0.429, slg: 0.952, so_pct: 19.04 }, null), 1, 1);
        expect(bat.stats.map(s => s.value)).toEqual([21, '.429', '.952', '19%']);

        const pit = rd.getStatsLine(side(null, { ip: '28.1', era: 6.0, k_pct: 19.5, opp_avg: 0.359 }), 1, 1);
        expect(pit.role).toBe('pitching');
        expect(pit.stats.map(s => s.value)).toEqual(['28.1', '6.0', '20%', '.359']);
    });

    /* Maxima, not typical widths: AB 3 ("132"), a rate 5 ("1.000"), a
     * percentage 4 ("100%"), IP 5 ("128.1"), ERA 4 ("12.0"). */
    it('gives every category its widest width', () => {
        const rd = load({ project_rio: { hud_enabled: true } });
        const bat = rd.getStatsLine(side({ at_bats: 0 }, null), 1, 1);
        expect(bat.stats.map(s => [s.label, s.width])).toEqual(
            [['AB', 3], ['AVG', 5], ['SLG', 5], ['SO%', 4]]);
        const pit = rd.getStatsLine(side(null, {}), 1, 1);
        expect(pit.stats.map(s => [s.label, s.width])).toEqual(
            [['IP', 5], ['ERA', 4], ['K%', 4], ['AVG', 5]]);
    });

    /* The claim `width` makes, checked against the formatter itself: the
     * widest value each category can produce fits its budget. */
    it('never formats a value wider than its category claims', () => {
        const rd = load({ project_rio: { hud_enabled: true } });
        const bat = rd.getStatsLine(side({ at_bats: 132, avg: 1, slg: 1.5, so_pct: 100 }, null), 1, 1);
        const pit = rd.getStatsLine(side(null, { ip: '128.1', era: 12.04, k_pct: 100, opp_avg: 1 }), 1, 1);
        for (const st of [...bat.stats, ...pit.stats]) {
            expect(String(st.value).length, `${st.label} = ${st.value}`).toBeLessThanOrEqual(st.width);
        }
    });
});

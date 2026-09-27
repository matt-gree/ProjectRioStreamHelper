// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountScoreboard } from '../../public/layout/lib/scoreboard-mount.js';

/*
 * HOME BATS LAST, SO HOME IS THE BOTTOM ROW of Scoreboard L's linescore —
 * whichever side the cascade seated it on. The state keys are
 * away_/home_linescore by NAME but hold side 1 / side 2, so a swapped board
 * (home_team = 1) drew home on top until the row was chosen from home_team.
 * Classic labels each row with a name, which has to travel with the numbers.
 */

const THEMES = {
    default: readFileSync('public/design/default/scoreboard-l.svg', 'utf8'),
    classic: readFileSync('public/design/classic/scoreboard-l.svg', 'utf8'),
};

function deepGet(obj, path, def) {
    let cur = obj;
    for (const seg of String(path).split('.')) {
        if (cur == null) return def;
        cur = cur[seg];
    }
    return cur === undefined ? def : cur;
}

function gameState(over = {}) {
    return {
        score: {
            1: {
                game_id: 7,
                player: { 1: { rioName: 'MattGree' }, 2: { rioName: 'Joan' } },
                score_left: 4, score_right: 2,
                inning: 5, half_inning: 'Top',
                away_linescore: [0, 1, 0, 3, 0], home_linescore: [1, 0, 0, 1, 0],
                innings_selected: 9,
                ...over,
            },
        },
    };
}

async function mountWith(pkg, state) {
    globalThis.OverlayBase = {
        BASE_URL: '', deepGet, state, settings: {},
        settingOn: (v, d) => (v == null ? d : !!v),
        readSetting: (type, key, def) => def,
        applyDesignSettings() {}, clearDesignSettings() {},
        brandingLogoUrl: () => '', setBlank() {},
    };
    globalThis.RioData = {
        charIconUrl: () => '', teamLogoUrl: () => '', leagueLogoUrl: () => '',
        captainIconUrl: () => '', getTeamRole: () => 'batting', findCharIndex: () => -1,
        gameMode: () => '', getStatsLine: () => null,
    };
    window.gsap = null;
    globalThis.fetch = vi.fn(async (url) => (
        String(url).endsWith('.svg')
            ? { ok: true, text: async () => THEMES[pkg] }
            : { ok: false, json: async () => ({}) }
    ));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const sb = mountScoreboard({ host, sb: 1, size: 'l' });
    await sb.update(state, { overlays: { global: { designPackage: pkg } } });
    return (n) => host.querySelector(`[data-slot="${n}"]`);
}

const row = (slot, prefix) => [1, 2, 3, 4, 5].map((i) => slot(`${prefix}-${i}`).textContent);

beforeEach(() => { document.body.innerHTML = ''; });

describe('Scoreboard L: home is the bottom row of the linescore', () => {
    for (const pkg of Object.keys(THEMES)) {
        it(`${pkg}: side 1 on top when side 2 is home`, async () => {
            const slot = await mountWith(pkg, gameState());
            expect(row(slot, 'box-away')).toEqual(['0', '1', '0', '3', '0']);
            expect(slot('box-away-r').textContent).toBe('4');
        });

        it(`${pkg}: side 1 on the bottom when side 1 is home`, async () => {
            const slot = await mountWith(pkg, gameState({ home_team: 1 }));
            expect(row(slot, 'box-away')).toEqual(['1', '0', '0', '1', '0']);
            expect(row(slot, 'box-home')).toEqual(['0', '1', '0', '3', '0']);
            expect(slot('box-away-r').textContent).toBe('2');
            expect(slot('box-home-r').textContent).toBe('4');
            if (slot('box-away-name')) {
                expect(slot('box-away-name').textContent).toBe('Joan');
                expect(slot('box-home-name').textContent).toBe('MattGree');
            }
        });
    }
});

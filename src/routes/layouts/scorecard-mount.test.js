// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { footerLine, mountScorecard } from '../../../public/layout/lib/scorecard-mount.js';
import { GLOBAL_DESIGN_DEFAULTS, GLOBAL_DESIGN_KEYS, LAYOUT_SETTINGS } from './designConstants';

/*
 * The vertical Scorecard. Three rules, and every one of them fails in a way a
 * screenshot of the shipped sample does not show:
 *
 *  1. THE COUNT IS 3 · 2 · 2. The mount looped 4 / 3 / 3 while both shipped
 *     themes disagreed with it — classic drew three rows of 3/2/2 (so the extra
 *     iterations bound nothing, silently) and default drew the fourth ball, the
 *     third strike and the third out, which could never come on because each
 *     count resets at its terminal value. A dead dot looks like an unlit one.
 *  2. A LOGO WELL FALLS BACK TO THE CAPTAIN. An empty well is a hole in the
 *     plate, and the states that empty it — a completed record with no MSB
 *     team, a fixture bound before first pitch — are the ordinary ones.
 *  3. EVERY SCORE BLOCK SAYS WHAT INNING IT IS. The rosters block exists
 *     because the full block's inning marker lives inside the situation row: a
 *     card with the diamond dropped could not say the inning at all.
 */

const THEMES = {
    default: readFileSync('public/design/default/scorecard.svg', 'utf8'),
    classic: readFileSync('public/design/classic/scorecard.svg', 'utf8'),
};

function deepGet(obj, path, def) {
    let cur = obj;
    for (const seg of String(path).split('.')) {
        if (cur == null) return def;
        cur = cur[seg];
    }
    return cur === undefined ? def : cur;
}

const ROSTER = ['Mario', 'Luigi', 'Peach', 'Daisy', 'Yoshi', 'Birdo', 'Wario', 'Waluigi', 'DK'];

function side(over = {}) {
    return {
        rioName: 'MattGree',
        rio_captainIndex: 4,
        character: Object.fromEntries(ROSTER.map((name, i) => [i, { name }])),
        ...over,
    };
}

function gameState(over = {}) {
    return {
        score: {
            1: {
                game_id: 7,
                player: { 1: side(), 2: side({ rioName: 'Joan', rio_captainIndex: 0 }) },
                score_left: 4, score_right: 2,
                inning: 5, half_inning: 'Top',
                balls: 3, strikes: 2, outs: 2,
                away_linescore: [0, 1, 0, 3, 0], home_linescore: [1, 0, 0, 1, 0],
                innings_selected: 9,
        date_time_end: '2026-09-08T19:30:00',
        stadium: 'mario_stadium',
                ...over,
            },
        },
    };
}

async function mountWith({ pkg = 'default', state = gameState(), settings = {} } = {}) {
    globalThis.OverlayBase = {
        BASE_URL: '', deepGet,
        state, settings,
        settingOn: (v, d) => (v == null ? d : !!v),
        // The real chain (overlay-base's readSetting): the per-TYPE leaf, then
        // the global. A hand-written stand-in here would let the rail's
        // resolution pass on a rule the overlay does not use.
        readSetting: (type, key, def) => {
            const perType = deepGet(settings, `overlays.${type}.${key}`, null);
            return perType !== null ? perType : deepGet(settings, `overlays.global.${key}`, def);
        },
        applyDesignSettings() {}, clearDesignSettings() {},
        brandingLogoUrl: () => '',
    };
    globalThis.RioData = {
        charIconUrl: (n) => (n ? `/icons/${n}.png` : ''),
        // The asset pack is what decides whether a team logo resolves, so an
        // empty answer here is the real "no logo for this side" — not a stub.
        teamLogoUrl: () => '',
        captainIconUrl: (s, sb, t) => {
            const idx = deepGet(s, `score.${sb}.player.${t}.rio_captainIndex`, null);
            if (idx == null || idx < 0 || idx > 8) return '';
            const name = deepGet(s, `score.${sb}.player.${t}.character.${idx}.name`, '');
            return name ? `/icons/${name}.png` : '';
        },
        getTeamRole: () => 'batting',
        findCharIndex: () => -1,
        gameMode: () => 'Superstar',
    };
    globalThis.fetch = vi.fn(async (url) => (
        String(url).endsWith('.svg')
            ? { ok: true, text: async () => THEMES[pkg] }
            : { ok: false, json: async () => ({}) }
    ));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const sc = mountScorecard({ host, sb: 1 });
    await sc.update(state, { overlays: { global: { designPackage: pkg } }, ...settings });
    return { host, slot: (n) => host.querySelector(`[data-slot="${n}"]`), dispose: () => sc.dispose() };
}

const lit = (el) => el && el.style.fill && el.style.fill !== 'rgba(255,255,255,0.08)';
const shown = (el) => el && el.getAttribute('opacity') !== '0';

beforeEach(() => { document.body.innerHTML = ''; });

describe('the count is 3 · 2 · 2', () => {
    /*
     * A full count: three balls and two strikes, with two away. Every dot the
     * convention keeps is lit, which is what makes the next test's absence
     * meaningful — a mount that bound nothing at all would pass that one.
     */
    it('lights every dot a full count fills', async () => {
        const { slot } = await mountWith();
        for (const name of ['ball-0', 'ball-1', 'ball-2', 'strike-0', 'strike-1', 'out-0', 'out-1']) {
            expect(lit(slot(name)), name).toBe(true);
        }
    });

    // The terminal value of each count ends something before a frame can draw
    // it, so neither shipped package declares a slot for it.
    it('leaves no terminal dot in either shipped package', () => {
        for (const [pkg, svg] of Object.entries(THEMES)) {
            for (const name of ['ball-3', 'strike-2', 'out-2']) {
                expect(svg.includes(`data-slot="${name}"`), `${pkg} ${name}`).toBe(false);
            }
        }
    });

    /*
     * A user package authored against the old 4 / 3 / 3 loop still declares
     * them. Unbound they would sit dark for the whole broadcast, which reads as
     * a dot that never came on rather than a dot that should not be there — and
     * there is nothing on the console that could fix it.
     */
    it('hides a retired dot a package still draws', async () => {
        const legacy = THEMES.default.replace(
            '<circle data-slot="ball-2"',
            '<circle data-slot="ball-3" cx="258" cy="246" r="8"/><circle data-slot="ball-2"',
        );
        THEMES.legacy = legacy;
        const { slot } = await mountWith({ pkg: 'legacy' });
        expect(shown(slot('ball-3'))).toBe(false);
    });
});

describe("a logo well falls back to the side's captain", () => {
    // Side 1 captains from roster slot 4, side 2 from slot 0 — by INDEX, which
    // is what a captain is in a Rio record.
    it.each([['full', 's'], ['rosters', 'r-s'], ['condensed', 'c-s']])(
        'fills both wells in the %s block', async (mainMode, prefix) => {
            const { slot } = await mountWith({ settings: { overlays: { scorecard: { 1: { mainMode } } } } });
            expect(slot(`${prefix}1-logo`).getAttribute('href')).toBe('/icons/Yoshi.png');
            expect(slot(`${prefix}2-logo`).getAttribute('href')).toBe('/icons/Mario.png');
        },
    );

    it('leaves the well empty when the side has no captain either', async () => {
        const state = gameState();
        state.score[1].player[1] = side({ rio_captainIndex: null });
        const { slot } = await mountWith({ state });
        expect(shown(slot('s1-logo'))).toBe(false);
    });
});

describe('every score block says what inning it is', () => {
    const MARKS = {
        full: { num: 'inn-num', up: 'inn-arrow-up', down: 'inn-arrow-down', final: 'final-badge' },
        rosters: { num: 'r-inn-num', up: 'r-inn-arrow-up', down: 'r-inn-arrow-down', final: 'r-final' },
        condensed: { num: 'c-inn-num', up: 'c-inn-arrow-up', down: 'c-inn-arrow-down', final: 'c-final' },
    };

    it.each(Object.entries(MARKS))('draws the live inning in the %s block', async (mainMode, mark) => {
        const { slot } = await mountWith({ settings: { overlays: { scorecard: { 1: { mainMode } } } } });
        expect(slot(mark.num).textContent).toBe('5');
        expect(shown(slot(mark.up))).toBe(true);
        expect(shown(slot(mark.down))).toBe(false);
        expect(shown(slot(mark.final))).toBe(false);
    });

    it.each(Object.entries(MARKS))('swaps the inning for FINAL in the %s block', async (mainMode, mark) => {
        const { slot } = await mountWith({
            state: gameState({ half_inning: 'Final', game_completed: true }),
            settings: { overlays: { scorecard: { 1: { mainMode } } } },
        });
        expect(shown(slot(mark.num))).toBe(false);
        expect(shown(slot(mark.final))).toBe(true);
    });

    // Each package declares all three, or picking a block on that package draws
    // a card with no marker at all.
    it('is authored in both shipped packages', () => {
        for (const [pkg, svg] of Object.entries(THEMES)) {
            for (const mark of Object.values(MARKS)) {
                for (const name of Object.values(mark)) {
                    expect(svg.includes(`data-slot="${name}"`), `${pkg} ${name}`).toBe(true);
                }
            }
        }
    });
});

describe('the rosters block', () => {
    /*
     * It is the full block's rows: same nine icons per side, same plate. A
     * block that drew a shorter band would be a third roster width on a card
     * that already has one.
     */
    it('draws both full rosters', async () => {
        const { slot } = await mountWith({ settings: { overlays: { scorecard: { 1: { mainMode: 'rosters' } } } } });
        for (let t = 1; t <= 2; t++) {
            for (let i = 0; i < 9; i++) {
                expect(slot(`r-s${t}-char-${i}`).getAttribute('href'), `r-s${t}-char-${i}`)
                    .toBe(`/icons/${ROSTER[i]}.png`);
            }
        }
    });

    // The situation row is what it drops, and the diamond is the whole of that
    // row it is meant to lose.
    it('draws no bases or count of its own', () => {
        for (const [pkg, svg] of Object.entries(THEMES)) {
            const block = svg.slice(svg.indexOf('data-slot="el-rosters"'), svg.indexOf('data-slot="el-condensed"'));
            expect(block.length, pkg).toBeGreaterThan(0);
            for (const name of ['base-1', 'runner-1', 'ball-0', 'strike-0', 'out-0']) {
                expect(block.includes(`data-slot="${name}"`), `${pkg} ${name}`).toBe(false);
            }
        }
    });

    // Only one score block is ever up, so the stack gives them the same slot.
    it.each(['full', 'rosters', 'condensed', 'off'])('is the only block up on %s', async (mainMode) => {
        const { slot } = await mountWith({ settings: { overlays: { scorecard: { 1: { mainMode } } } } });
        const up = ['el-main', 'el-rosters', 'el-condensed'].filter(n => shown(slot(n)));
        expect(up).toEqual(mainMode === 'off' ? [] : [{ full: 'el-main', rosters: 'el-rosters', condensed: 'el-condensed' }[mainMode]]);
    });
});

describe('the rosters strip', () => {
    /*
     * The marker alone left ~370 of the strip's 440 units empty, in the one row
     * of this block with no second column to fill. The count is what the
     * situation row had that a rosters card still wants — everything else there
     * (the bases, the runners on them) only means anything beside a diamond.
     */
    it('carries the count beside the inning', async () => {
        const { slot } = await mountWith({ settings: { overlays: { scorecard: { 1: { mainMode: 'rosters' } } } } });
        for (const name of ['r-ball-0', 'r-ball-1', 'r-ball-2', 'r-strike-0', 'r-strike-1', 'r-out-0', 'r-out-1']) {
            expect(lit(slot(name)), name).toBe(true);
        }
        expect(shown(slot('r-count'))).toBe(true);
    });

    // A count is about a pitch that is coming. The badge sits in the middle of
    // where those dots are, so leaving them lit either side of it would be the
    // card's loudest claim that the game is still going.
    it('gives FINAL the strip to itself', async () => {
        const { slot } = await mountWith({
            state: gameState({ half_inning: 'Final', game_completed: true }),
            settings: { overlays: { scorecard: { 1: { mainMode: 'rosters' } } } },
        });
        expect(shown(slot('r-final'))).toBe(true);
        expect(shown(slot('r-count'))).toBe(false);
    });

    // Its own dots, not the full block's: two blocks drawing one slot map would
    // make the last one bound win, silently, on whichever was on air.
    it('draws a count of its own, not the full block\'s', () => {
        for (const [pkg, svg] of Object.entries(THEMES)) {
            const block = svg.slice(svg.indexOf('data-slot="el-rosters"'), svg.indexOf('data-slot="el-condensed"'));
            for (const name of ['r-ball-2', 'r-strike-1', 'r-out-1']) {
                expect(block.includes(`data-slot="${name}"`), `${pkg} ${name}`).toBe(true);
            }
            for (const name of ['r-ball-3', 'r-strike-2', 'r-out-2']) {
                expect(block.includes(`data-slot="${name}"`), `${pkg} ${name}`).toBe(false);
            }
        }
    });
});

describe("the card's outer rail", () => {
    /*
     * Theme chrome that carries no data and marks no boundary, so it is the one
     * piece of the card a producer is most likely to want gone — a scene
     * usually has a colour identity already. Default OFF, which is a change to
     * what every existing source draws and is meant to be.
     */
    it('is off unless the producer asks for it', async () => {
        const { slot } = await mountWith();
        expect(slot('card-rail').style.display).toBe('none');
    });

    /*
     * A GLOBAL with a per-board pin over it, the same resolution as showLogo:
     * the rail is the theme's opinion about its own edge, so it is one decision
     * about the LOOK, taken once on the Design tab, rather than a row on each of
     * the two card panels that happen to draw it.
     */
    it('comes back on the global switch', async () => {
        const { slot } = await mountWith({ settings: { overlays: { global: { showRail: true } } } });
        expect(slot('card-rail').style.display).toBe('');
    });

    it('lets one board pin against the global, either way', async () => {
        const held = await mountWith({ settings: { overlays: { global: { showRail: true }, scorecard: { 1: { showRail: false } } } } });
        expect(held.slot('card-rail').style.display).toBe('none');
        const lit = await mountWith({ settings: { overlays: { scorecard: { 1: { showRail: true } } } } });
        expect(lit.slot('card-rail').style.display).toBe('');
    });

    /*
     * BOTH CARD ELEMENTS, and the switch has to reach each of them through all
     * three gates: the registry offers it, the layout's <meta> declares it, and
     * the mount reads it. The middle one is the gate that fails silently — the
     * stage filters the registry down to what the whitelist names, so a key the
     * mount honours and the layout omits is a setting nobody can reach.
     */
    /*
     * A GLOBAL and no element's own setting — the half that would rot quietly.
     * Left in LAYOUT_SETTINGS too, it would draw a second, orphaned switch on
     * each card panel, reading a different key from the Design tab's and
     * disagreeing with it.
     */
    it('is a global design key, not a per-element one', () => {
        expect(GLOBAL_DESIGN_KEYS).toContain('showRail');
        expect(GLOBAL_DESIGN_DEFAULTS.showRail).toBe(false);
        for (const type of ['scorecard', 'scoreboard']) {
            expect(LAYOUT_SETTINGS[type].map(d => d.key), type).not.toContain('showRail');
        }
    });

    // Both card layouts declare it, which is what lets a per-board pin be
    // authored against the global at all.
    it.each([
        'public/layout/scorecard/scorecard.html',
        'public/layout/scoreboard1/scoreboard.html',
    ])('is declared by %s', (layout) => {
        const meta = readFileSync(layout, 'utf8')
            .match(/<meta name="overlay-settings" content="([^"]*)"/)[1]
            .split(',').map(x => x.trim());
        expect(meta).toContain('showRail');
    });
});

describe('the footer', () => {
    const foot = (settings) => mountWith({ settings: { overlays: { scorecard: { 1: settings } } } });

    /*
     * One composition, one band. The interesting property is that a lone value
     * needs no case of its own — the band is one centred line either way, and a
     * date on its own reads exactly as a stadium on its own does.
     */
    describe('footerLine', () => {
        it('joins what it is given', () => {
            expect(footerLine(['Mario Stadium', 'Sep 8, 2026'])).toBe('Mario Stadium · Sep 8, 2026');
        });
        it('drops a switched-off part without leaving its separator', () => {
            expect(footerLine([false, 'Sep 8, 2026'])).toBe('Sep 8, 2026');
            expect(footerLine(['Mario Stadium', false])).toBe('Mario Stadium');
        });
        // An empty string is what makes the band self-hide, so `off` needs no
        // case in the stack predicate.
        it('is empty with both switched off', () => {
            expect(footerLine([false, false])).toBe('');
        });
    });

    it('ships with the stadium alone — the date is opt-in', async () => {
        const { slot } = await mountWith();
        expect(slot('stadium').textContent).toBe('Mario Stadium');
    });

    it('puts both on the one band', async () => {
        const { slot } = await foot({ showDate: true });
        expect(slot('stadium').textContent).toBe('Mario Stadium · Sep 8, 2026');
    });

    // ONE BAND, in every package. A theme still drawing the second one would put
    // the card back to the 88 units the layout picker was removed for.
    it('is one band in every shipped package', () => {
        for (const [pkg, svg] of Object.entries(THEMES)) {
            expect(svg.includes('data-slot="el-date"'), pkg).toBe(false);
        }
    });

    // A live game has no end time. Falling back to the start is what stops this
    // from being a band that turns up at the final out.
    it('dates a live game from its start', async () => {
        const state = gameState();
        delete state.score[1].date_time_end;
        state.score[1].date_time_start = '2026-09-08T18:00:00';
        const { slot } = await mountWith({
            state, settings: { overlays: { scorecard: { 1: { showStadium: false, showDate: true } } } },
        });
        expect(slot('stadium').textContent).toContain('Sep 8, 2026');
    });
});

describe('turning the rail off recentres the card', () => {
    const vb = (host) => host.querySelector('svg').getAttribute('viewBox');

    /*
     * A hidden rail otherwise leaves its lane behind as dead space on one side
     * only, so the card draws off-centre in a source the producer has already
     * placed. The shift is half the rail's footprint: (card-bg x 14) - (rail x
     * 8) = 6, shared back to the two sides.
     */
    it('shifts the frame by half the lane the rail was standing in', async () => {
        const { host } = await mountWith();
        expect(vb(host)).toBe('3 0 496 766');
    });

    it('restores the theme\'s own framing when it comes back', async () => {
        const { host } = await mountWith({ settings: { overlays: { scorecard: { 1: { showRail: true } } } } });
        expect(vb(host)).toBe('0 0 496 766');
    });
});

describe('the FINAL badge', () => {
    /*
     * Two of the three blocks drew a white 0.14 pill and one drew the accent, so
     * the same badge changed colour when a producer cut between blocks. All
     * three are the Final Badge Color seam now, over this package's accent —
     * which also means the setting the Scoreboard advertises in its whitelist
     * reaches something for the first time in this package.
     */
    it('is one colour on every score block in every shipped package', () => {
        for (const [pkg, svg] of Object.entries(THEMES)) {
            if (pkg === 'legacy') continue;
            const fills = ['final-badge', 'r-final', 'c-final'].map((slot) => {
                const at = svg.indexOf(`data-slot="${slot}"`);
                return svg.slice(at, svg.indexOf('</g>', at)).match(/<rect[^>]*style="fill:([^"]+)"/)[1];
            });
            expect(new Set(fills).size, `${pkg}: ${fills.join(' / ')}`).toBe(1);
            expect(fills[0], pkg).toContain('--final-badge-color');
        }
    });

    it('is reachable from the console on both card elements', () => {
        for (const layout of ['public/layout/scorecard/scorecard.html', 'public/layout/scoreboard1/scoreboard.html']) {
            const meta = readFileSync(layout, 'utf8')
                .match(/<meta name="overlay-settings" content="([^"]*)"/)[1]
                .split(',').map(x => x.trim());
            expect(meta, layout).toContain('finalBadgeColor');
        }
    });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    scheduleRows, plateFor, blankReason, DEFAULTS, RAIL_OPACITY, DONE_DIM,
} from '../../public/layout/lib/schedule-mount.js';

/*
 * The Upcoming Schedule's row selection. The element draws `schedule.queue`,
 * which is a PROJECTION of every running order and which nothing ever removes
 * a fixture from (server/schedule.py) — so what this file pins is the three
 * rules that stand between that ever-growing list and a fixed canvas.
 */

function deepGet(obj, path, def) {
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur == null) return def;
        cur = cur[seg];
    }
    return cur === undefined ? def : cur;
}

beforeEach(() => { globalThis.OverlayBase = { deepGet }; });

const match = (over = {}) => ({
    label: 'Winners Final', stage: 'draft', decided: null,
    format: { bestOf: 5 }, series: { 1: 0, 2: 0 }, scheduledAt: '',
    player: { 1: { rioName: 'One' }, 2: { rioName: 'Two' } },
    ...over,
});

// State as the store holds it: `schedule.queue` and `match.{M}` are nested,
// which is what deepGet walks.
const stateOf = (ids, matches) => ({
    schedule: { queue: ids, title: 'Upcoming Matches' },
    match: matches,
});

describe('scheduleRows', () => {
    it('drops decided matches by default, and keeps them when asked', () => {
        const st = stateOf([1, 2], { 1: match({ decided: 1 }), 2: match() });

        expect(scheduleRows(st, {}).rows.map(r => r.id)).toEqual([2]);
        expect(scheduleRows(st, { showDecided: true }).rows.map(r => r.id))
            .toEqual([1, 2]);
    });

    // The producer's switch is stored by `PUT /api/v1/settings` as a string, so
    // the mount resolves it with settingOn — but the pure function underneath
    // takes a real boolean and must not treat a missing option as "show them".
    it('defaults to hiding the played ones', () => {
        expect(DEFAULTS.showDecided).toBe(false);
        const st = stateOf([1], { 1: match({ decided: 2 }) });
        expect(scheduleRows(st).rows).toHaveLength(0);
    });

    it('caps the board and counts what it folded away', () => {
        const ids = [1, 2, 3, 4, 5];
        const matches = Object.fromEntries(ids.map(i => [i, match()]));
        const r = scheduleRows(stateOf(ids, matches), { maxRows: 3 });
        expect(r.rows.map(x => x.id)).toEqual([1, 2, 3]);
        expect(r.hidden).toBe(2);
    });

    // `hidden` is what the "+N more" line counts, so it must be what was DROPPED
    // BY THE CAP — not what the completed filter removed, which the producer
    // asked for and would read as the board hiding matches it was told to hide.
    it('counts only the cap in the overflow, never the filter', () => {
        const ids = [1, 2, 3];
        const matches = { 1: match({ decided: 1 }), 2: match(), 3: match() };
        const r = scheduleRows(stateOf(ids, matches), { maxRows: 5 });
        expect(r.rows).toHaveLength(2);
        expect(r.hidden).toBe(0);
    });

    // `schedule.queue` is a projection and can name a fixture that has just been
    // deleted; a blank row is the one thing worse than a missing one.
    it('skips a queued id whose match is gone', () => {
        const r = scheduleRows(stateOf([1, 99, 2], { 1: match(), 2: match() }), {});
        expect(r.rows.map(x => x.id)).toEqual([1, 2]);
        expect(r.queued).toBe(3);
        expect(r.known).toBe(2);
    });

    it('reads the queue in order and never sorts live to the top', () => {
        const ids = [1, 2, 3];
        const matches = { 1: match(), 2: match({ stage: 'live' }), 3: match() };
        const r = scheduleRows(stateOf(ids, matches), {});
        expect(r.rows.map(x => x.stage)).toEqual(['upcoming', 'live', 'upcoming']);
    });

    it('a decided match is played even while its stage still says live', () => {
        const st = stateOf([1], { 1: match({ stage: 'live', decided: '2' }) });
        const r = scheduleRows(st, { showDecided: true });
        expect(r.rows[0].stage).toBe('done');
        expect(r.rows[0].status).toBe('FINAL');
    });

    it('never lets maxRows collapse the board to nothing', () => {
        const st = stateOf([1], { 1: match() });
        for (const bad of [0, -3, 'x', null]) {
            expect(scheduleRows(st, { maxRows: bad }).rows).toHaveLength(1);
        }
    });
});

/*
 * UP NEXT is the fallback for a blank display time, not a second status.
 * `scheduledAt` is free text a producer often never fills, and a right-hand
 * column empty on every row reads as unfinished rather than as untimed.
 */
describe('the status column', () => {
    it('marks the first waiting match up next when it has no time', () => {
        const ids = [1, 2];
        const r = scheduleRows(stateOf(ids, { 1: match(), 2: match() }), {});
        expect(r.rows.map(x => x.status)).toEqual(['UP NEXT', '']);
    });

    it('lets a time speak for itself, and does not move UP NEXT down the list', () => {
        // The first waiting row is timed, so nothing is "up next" — the time
        // already says it, and a later untimed row is not the next one.
        const ids = [1, 2];
        const matches = { 1: match({ scheduledAt: '7:15 PM' }), 2: match() };
        const r = scheduleRows(stateOf(ids, matches), {});
        expect(r.rows.map(x => x.status)).toEqual(['7:15 PM', '']);
    });

    it('looks past the live and played rows to find the first waiting one', () => {
        const ids = [1, 2, 3];
        const matches = {
            1: match({ decided: 1 }), 2: match({ stage: 'live' }), 3: match(),
        };
        const r = scheduleRows(stateOf(ids, matches), { showDecided: true });
        expect(r.rows.map(x => x.status)).toEqual(['FINAL', 'LIVE', 'UP NEXT']);
    });
});

/*
 * The plate is the most informative thing a match can say about itself in one
 * small cell, and which of the three it says is a progression, not a choice.
 */
describe('plateFor', () => {
    it('prefers a series score once there is one', () => {
        expect(plateFor(match({ series: { 1: 2, 2: 1 } }))).toBe('2–1');
        expect(plateFor(match({ series: { '1': 0, '2': 3 } }))).toBe('0–3');
    });

    it('falls back to the format while the series is still 0-0', () => {
        expect(plateFor(match())).toBe('Bo5');
        expect(plateFor(match({ format: { bestOf: 7 } }))).toBe('Bo7');
    });

    // "Bo1" is a word for "nothing to say" — every one-off is a Bo1, so the
    // plate would carry the same three characters on every row of a pool-play
    // board and tell a viewer nothing.
    it('says VS for a one-off rather than Bo1', () => {
        expect(plateFor(match({ format: { bestOf: 1 } }))).toBe('VS');
        expect(plateFor(match({ format: {} }))).toBe('VS');
        expect(plateFor({})).toBe('VS');
    });

    /*
     * MIXED CASE, and it is not a style note. The plate draws in the numeral
     * face so that a column of series scores sits on one grid — and a capital O
     * next to a digit in a monospaced face is the exact ambiguity that face
     * exists to remove. `BO5` renders as `B05` at broadcast size.
     */
    it('spells the format the way the Match desk does', () => {
        expect(plateFor(match({ format: { bestOf: 3 } }))).toBe('Bo3');
        expect(plateFor(match({ format: { bestOf: 3 } }))).not.toBe('BO3');
    });
});

/*
 * A blank browser source looks identical whatever emptied it, and these three
 * are fixed three different ways: put something in the running order, repair a
 * queue pointing at deleted fixtures, or turn Decided Matches on.
 */
describe('blankReason', () => {
    it('names the three causes apart', () => {
        expect(blankReason({ queued: 0, known: 0, rows: [] })).toBe('schedule-empty');
        expect(blankReason({ queued: 3, known: 0, rows: [] })).toBe('schedule-no-matches');
        expect(blankReason({ queued: 3, known: 3, rows: [] })).toBe('schedule-all-played');
        expect(blankReason({ queued: 3, known: 3, rows: [{}] })).toBe(null);
    });
});

/*
 * THE STATE CUE IS ONE COLOUR AT THREE STRENGTHS. A mount that picked three
 * colours would be a fourth palette agreeing with neither the package nor the
 * producer's accent — so the rail is authored in the accent and the mount only
 * moves its opacity. The live row must be the only thing on the card at full
 * strength, or the cue says nothing.
 */
describe('the rail', () => {
    it('gives full accent to the live row alone', () => {
        expect(RAIL_OPACITY.live).toBe('1');
        expect(Number(RAIL_OPACITY.upcoming)).toBeLessThan(1);
        expect(Number(RAIL_OPACITY.done)).toBeLessThan(Number(RAIL_OPACITY.upcoming));
    });

    /*
     * A played row is dimmed ONCE, on the clone's own group. The mount must not
     * also dim the rail's own node, or the two multiply — 0.45 x 0.15 is 0.07,
     * which reads as a rendering fault rather than as a result (the same trap
     * `rowOutcome` documents for the matchup cards).
     */
    it('dims a played row on the group and nowhere else', () => {
        const src = readFileSync('public/layout/lib/schedule-mount.js', 'utf8');
        const bind = src.slice(src.indexOf('function bindRow'), src.indexOf('function placeCard'));
        expect(DONE_DIM).toBe('0.45');
        expect(bind).toContain('clone.setAttribute(\'opacity\'');
        expect(bind.match(/DONE_DIM/g)).toHaveLength(1);
    });
});

/*
 * The card's height is data, and BOTH numbers that make it so live in the theme
 * — so a package can change its row height without a code change. A theme that
 * drops one would silently get the mount's own defaults, which are right for
 * the shipped artwork and wrong for anyone else's; these keep the two packages
 * honest about declaring them.
 */
describe('the theme declares the card arithmetic', () => {
    for (const pkg of ['default', 'classic']) {
        it(`${pkg} declares data-compact-h and the row pitch`, () => {
            const svg = readFileSync(`public/design/${pkg}/schedule.svg`, 'utf8');
            const compact = svg.match(/data-slot="card-bg"[^>]*data-compact-h="(\d+)"/);
            const pitch = svg.match(/data-slot="match-template" data-h="(\d+)"/);
            expect(compact, 'card-bg data-compact-h').toBeTruthy();
            expect(pitch, 'match-template data-h').toBeTruthy();

            // The cap is the canvas: the tallest the board gets, overflow line
            // included, still has to sit inside 1080 with room for its shadow.
            const tallest = Number(compact[1]) + 10 * Number(pitch[1]) + 48;
            expect(tallest).toBeLessThan(1040);
        });
    }
});

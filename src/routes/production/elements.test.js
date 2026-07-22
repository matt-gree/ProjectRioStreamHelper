import { describe, it, expect } from 'vitest';
import {
    ELEMENTS, PICKABLE_FEEDS, isPickableFeed,
    quickFaceFor, isPinnable, stageBodyFor,
} from './elements';
import { FEED_OPTION_HOOKS } from './feed-pickers';

/*
 * PICKABLE_FEEDS decides whether the source strip's Push slot can do anything
 * before a pick; FEED_OPTION_HOOKS decides whether there IS a picker. They are
 * the same question asked by two surfaces, so they must not drift: a feed with
 * a picker whose Push is enabled would push nothing, and a feed without one
 * whose Push is disabled could never be fed at all.
 */
describe('pickable feeds', () => {
    it('matches the set of feeds that actually expose a picker', () => {
        expect([...PICKABLE_FEEDS].sort()).toEqual(Object.keys(FEED_OPTION_HOOKS).sort());
    });

    it('names only feeds some registered element declares', () => {
        const feeds = new Set(ELEMENTS.map(e => e.feed).filter(Boolean));
        for (const f of PICKABLE_FEEDS) expect(feeds, f).toContain(f);
    });

    it('classifies the registry: stats picks, game summary pushes wholesale', () => {
        const byId = Object.fromEntries(ELEMENTS.map(e => [e.id, e]));
        expect(isPickableFeed(byId.stats)).toBe(true);
        expect(isPickableFeed(byId.postgamevs)).toBe(false);
        expect(isPickableFeed(byId.scoreboard)).toBe(false); // direct: no feed at all
    });
});

describe('element registry invariants', () => {
    // The phase axis is gone: elements are listed under the OBS scene their
    // source lives in, so a leftover `phase` would be a field nothing reads and
    // the next person would keep it in sync for nothing.
    it('carries no phase — scenes are the grouping axis', () => {
        for (const e of ELEMENTS) expect(e.phase, `${e.id} has no phase`).toBeUndefined();
    });

    it('fed elements declare a canonical container url', () => {
        for (const e of ELEMENTS.filter((x) => x.flavor === 'fed')) {
            expect(e.url).toMatch(/\/layout\//);
        }
    });
});

describe('console contract (production-console-contract skill)', () => {
    const KNOWN_ROWS = new Set(['visibility', 'content', 'push', 'setting']);

    it('every element resolves a quick face or an explicit null — never undefined', () => {
        for (const e of ELEMENTS) {
            const face = quickFaceFor(e);
            expect(face === null || typeof face === 'object', e.id).toBe(true);
        }
    });

    it('the two-row cap is hard: no resolved face exceeds 2 rows', () => {
        for (const e of ELEMENTS) {
            const face = quickFaceFor(e);
            if (face === null) continue;
            expect(face.rows.length, e.id).toBeGreaterThan(0);
            expect(face.rows.length, e.id).toBeLessThanOrEqual(2);
            for (const row of face.rows) expect(KNOWN_ROWS.has(row), `${e.id}: ${row}`).toBe(true);
        }
    });

    it('flavor defaults: direct → visibility toggle, fed → content pick + push', () => {
        expect(quickFaceFor({ flavor: 'direct' })).toEqual({ rows: ['visibility'] });
        expect(quickFaceFor({ flavor: 'fed' })).toEqual({ rows: ['content', 'push'] });
    });

    it('explicit null means not pinnable; an explicit face wins over the default', () => {
        expect(quickFaceFor({ flavor: 'direct', quickFace: null })).toBeNull();
        expect(isPinnable({ flavor: 'direct', quickFace: null })).toBe(false);
        expect(isPinnable({ flavor: 'direct' })).toBe(true);
        const custom = { rows: ['visibility', 'push'] };
        expect(quickFaceFor({ flavor: 'fed', quickFace: custom })).toBe(custom);
    });

    it('fed elements with a content row name their feed picker', () => {
        for (const e of ELEMENTS) {
            const face = quickFaceFor(e);
            if (face?.rows.includes('content')) expect(e.feed, e.id).toBeTruthy();
        }
    });

    it('stage body keys default to the element id and are unique', () => {
        expect(stageBodyFor({ id: 'scoreboard' })).toBe('scoreboard');
        expect(stageBodyFor({ id: 'x', stageBody: 'y' })).toBe('y');
        const keys = ELEMENTS.map(stageBodyFor);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('element URL binding (match)', () => {
    const byId = Object.fromEntries(ELEMENTS.map((e) => [e.id, e]));
    const HOST = 'http://localhost:5260';

    it('every element matches its own canonical url', () => {
        for (const e of ELEMENTS) {
            expect(e.match(HOST + e.url), e.id).toBe(true);
        }
    });

    it('matching survives query params (scoreboard/size/intro variants)', () => {
        expect(byId.scoreboard.match(
            `${HOST}/layout/scoreboard1/scoreboard.html?scoreboard=2&size=m&intro=0`,
        )).toBe(true);
        expect(byId.lowerthird.match(
            `${HOST}/layout/lowerthird/lowerthird.html?intro=0`)).toBe(true);
    });

    it('scoreboard binds the band, not siblings in the same folder', () => {
        expect(byId.scoreboard.match(
            `${HOST}/layout/scoreboard1/stats.html?team=1`)).toBe(false);
        expect(byId.scoreboard.match(
            `${HOST}/layout/scoreboard1/roster.html`)).toBe(false);
    });

    it('schedule is deliberately narrow: bracket player_schedule must not bind', () => {
        expect(byId.schedule.match(
            `${HOST}/layout/bracket/player_schedule.html`)).toBe(false);
        expect(byId.schedule.match(
            `${HOST}/layout/schedule/schedule.html`)).toBe(true);
    });

    it('both post-game feeds bind the shared callout stage', () => {
        const stage = `${HOST}/layout/shared/callout-stage.html`;
        expect(byId.postgamecallout.match(stage)).toBe(true);
        expect(byId.postgamevs.match(stage)).toBe(true);
    });

    it('no element binds a non-PRSH browser source', () => {
        for (const e of ELEMENTS) {
            expect(e.match('https://example.com/some/page.html'), e.id).toBe(false);
        }
    });
});

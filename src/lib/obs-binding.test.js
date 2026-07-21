import { describe, it, expect } from 'vitest';
import { paramsMatch, urlsMatch, bindingForUrl } from './obs-binding';

/*
 * This module answers "is this overlay already a source in OBS, and where?" for
 * BOTH the Setup tab and the Production console. It had no tests while it had
 * one consumer; it has two now, and the second one's whole reason for adopting
 * it is the board discrimination pinned below.
 */

const P = 'http://localhost:5260';

describe('urlsMatch — same overlay', () => {
    it('ignores host and port: the streamer\'s OBS may be on another machine', () => {
        expect(urlsMatch(
            '/layout/scoreboard1/scoreboard.html',
            'http://192.168.1.40:5260/layout/scoreboard1/scoreboard.html',
        )).toBe(true);
    });

    it('ignores incidental params OBS or the producer may add', () => {
        expect(urlsMatch(
            `${P}/layout/lowerthird/lowerthird.html`,
            `${P}/layout/lowerthird/lowerthird.html?intro=0&cachebust=99`,
        )).toBe(true);
    });

    it('tolerates a trailing slash on either side', () => {
        expect(urlsMatch(`${P}/layout/bracket/`, `${P}/layout/bracket`)).toBe(true);
    });

    it('rejects a different overlay in the same folder', () => {
        expect(urlsMatch(
            `${P}/layout/scoreboard1/scoreboard.html`,
            `${P}/layout/scoreboard1/roster.html`,
        )).toBe(false);
    });

    it('rejects junk rather than throwing', () => {
        expect(urlsMatch('', `${P}/layout/x.html`)).toBe(false);
        expect(urlsMatch(`${P}/layout/x.html`, null)).toBe(false);
        expect(urlsMatch(`${P}/layout/x.html`, 'not a url at all')).toBe(false);
    });
});

/*
 * The instance half. `scoreboard` is the only param with a documented default,
 * and that asymmetry is load-bearing: it is what lets a canonical element URL
 * (which never carries ?scoreboard) be compared against a producer's
 * board-qualified source.
 */
describe('paramsMatch — same instance', () => {
    it('treats a missing ?scoreboard as board 1', () => {
        expect(paramsMatch('/layout/scoreboard1/scoreboard.html',
            `${P}/layout/scoreboard1/scoreboard.html?scoreboard=1`)).toBe(true);
    });

    it('separates board 1 from board 2 — the whole point', () => {
        expect(paramsMatch('/layout/scoreboard1/scoreboard.html?scoreboard=2',
            `${P}/layout/scoreboard1/scoreboard.html?scoreboard=1`)).toBe(false);
        expect(paramsMatch('/layout/scoreboard1/scoreboard.html',
            `${P}/layout/scoreboard1/scoreboard.html?scoreboard=2`)).toBe(false);
    });

    it('does not distinguish on a param only one side states', () => {
        // No documented default for size, so a bare URL matches any size — the
        // producer never said, so we must not guess and unbind them.
        expect(paramsMatch('/layout/scoreboard1/scoreboard.html',
            `${P}/layout/scoreboard1/scoreboard.html?size=m`)).toBe(true);
    });

    it('separates team, size, port and bracket-side variants', () => {
        const q = (s) => `${P}/layout/x.html?${s}`;
        expect(paramsMatch(q('team=1'), q('team=2'))).toBe(false);
        expect(paramsMatch(q('size=s'), q('size=l'))).toBe(false);
        expect(paramsMatch(q('port=1'), q('port=3'))).toBe(false);
        expect(paramsMatch(q('winners_only=1'), q('winners_only=0'))).toBe(false);
        expect(paramsMatch(q('losers_only=1'), q('losers_only=0'))).toBe(false);
    });

    it('says nothing about WHICH overlay — that is urlsMatch\'s job', () => {
        expect(paramsMatch(`${P}/layout/a.html?team=1`, `${P}/layout/b.html?team=1`)).toBe(true);
        expect(urlsMatch(`${P}/layout/a.html?team=1`, `${P}/layout/b.html?team=1`)).toBe(false);
    });
});

describe('bindingForUrl', () => {
    const url = '/layout/scoreboard1/scoreboard.html';
    const item = (sourceName, u, enabled = true) => ({ sourceName, url: u, enabled });

    it('reports live when the source is in the program scene', () => {
        const b = bindingForUrl(url, {
            sceneItems: { Main: [item('Board', `${P}${url}`)] },
            programScene: 'Main', previewScene: 'Staging',
        });
        expect(b.state).toBe('live');
        expect(b.sourceName).toBe('Board');
    });

    it('program wins when the same overlay is in both scenes', () => {
        const b = bindingForUrl(url, {
            sceneItems: {
                Staging: [item('Preview copy', `${P}${url}`)],
                Main: [item('Program copy', `${P}${url}`)],
            },
            programScene: 'Main', previewScene: 'Staging',
        });
        expect(b.state).toBe('live');
        expect(b.sourceName).toBe('Program copy');
        expect(b.matches).toHaveLength(2);
    });

    it('reports preview when it is only staged', () => {
        const b = bindingForUrl(url, {
            sceneItems: { Staging: [item('Board', `${P}${url}`)] },
            programScene: 'Main', previewScene: 'Staging',
        });
        expect(b.state).toBe('preview');
    });

    it('is absent when nothing matches, and never returns a bare undefined', () => {
        const b = bindingForUrl(url, {
            sceneItems: { Main: [item('Cam', 'rtmp://camera')] },
            programScene: 'Main',
        });
        expect(b.state).toBe('absent');
        expect(b.matches).toEqual([]);
    });

    it('picks the board it was asked for, not the first source in the scene', () => {
        const b = bindingForUrl(`${url}?scoreboard=2`, {
            sceneItems: {
                Main: [
                    item('Board 1', `${P}${url}?scoreboard=1`),
                    item('Board 2', `${P}${url}?scoreboard=2`),
                ],
            },
            programScene: 'Main',
        });
        expect(b.sourceName).toBe('Board 2');
        expect(b.matches).toHaveLength(1);
    });

    it('survives an untracked scene and a null-url item', () => {
        expect(() => bindingForUrl(url, {
            sceneItems: { Other: [{ sourceName: 'x' }, null] },
        })).not.toThrow();
    });
});

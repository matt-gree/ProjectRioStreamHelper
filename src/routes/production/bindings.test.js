import { describe, it, expect } from 'vitest';
import { boundIn, elementBindings, instanceUrl } from './bindings';
import { ELEMENTS } from './elements';

/*
 * Which OBS source a panel commands. Before board awareness this was a bare
 * `.find()`, so two scoreboard sources in one scene meant the Air toggle drove
 * whichever OBS happened to list first — and the Scorecard's board picker
 * changed settings without changing the source it commanded.
 */

const P = 'http://localhost:5260';
const el = (id) => ELEMENTS.find(e => e.id === id);

const src = (sourceName, url) => ({
    id: sourceName, sourceName, url, enabled: true,
    inputKind: 'browser_source', isGroup: false, isPrsh: true,
});

const board = (n) => src(`Board ${n}`, `${P}/layout/scoreboard1/scoreboard.html?scoreboard=${n}`);

describe('boundIn — instance discrimination', () => {
    it('picks the asked-for board when several of the type are in the scene', () => {
        const items = [board(1), board(2), board(3)];
        expect(boundIn(el('scoreboard'), items, undefined, 2).sourceName).toBe('Board 2');
        expect(boundIn(el('scoreboard'), items, undefined, 3).sourceName).toBe('Board 3');
    });

    it('reads a source with no ?scoreboard as board 1', () => {
        const bare = src('Scoreboard', `${P}/layout/scoreboard1/scoreboard.html`);
        const items = [bare, board(2)];
        expect(boundIn(el('scoreboard'), items, undefined, 1).sourceName).toBe('Scoreboard');
        expect(boundIn(el('scoreboard'), items, undefined, 2).sourceName).toBe('Board 2');
    });

    it('reports nothing rather than the wrong board when the asked-for one is absent', () => {
        expect(boundIn(el('scoreboard'), [board(1), board(2)], undefined, 5)).toBeNull();
    });

    it('leaves non-board elements alone — a Lower Third has no board to get wrong', () => {
        const lt = src('LT', `${P}/layout/lowerthird/lowerthird.html`);
        expect(boundIn(el('lowerthird'), [lt], undefined, 2).sourceName).toBe('LT');
    });

    /*
     * Fed elements bind the SHARED CONTAINER, which is board-agnostic by design
     * — the board rides in the feed payload. Discriminating it by URL board
     * would unbind the container the moment the panel pointed at board 2.
     */
    it('does not board-qualify a fed element\'s container', () => {
        const stage = src('Callout Stage', `${P}/layout/shared/callout-stage.html`);
        expect(boundIn(el('postgamevs'), [stage], undefined, 2).sourceName).toBe('Callout Stage');
    });

    it('still honours the streamer\'s explicit container override', () => {
        const items = [
            src('Callout Stage', `${P}/layout/shared/callout-stage.html`),
            src('Other Callout', `${P}/layout/shared/callout-stage.html`),
        ];
        expect(boundIn(el('postgamevs'), items, 'Other Callout').sourceName).toBe('Other Callout');
    });
});

describe('instanceUrl', () => {
    it('qualifies a board-scoped element and leaves a global one bare', () => {
        expect(instanceUrl(el('scoreboard'), 2))
            .toBe('/layout/scoreboard1/scoreboard.html?scoreboard=2');
        expect(instanceUrl(el('lowerthird'), 2)).toBe('/layout/lowerthird/lowerthird.html');
    });

    it('leaves the URL bare when no board is asked for', () => {
        expect(instanceUrl(el('scoreboard'), null)).toBe('/layout/scoreboard1/scoreboard.html');
    });

    it('marks exactly the elements whose source carries a board', () => {
        const scoped = ELEMENTS.filter(e => e.scope === 'board').map(e => e.id).sort();
        expect(scoped).toEqual(['hitvisualizer', 'scoreboard', 'scorecard']);
        // Fed elements must never be board-scoped — see the two mechanisms note
        // in elements.js.
        for (const e of ELEMENTS.filter(x => x.flavor === 'fed')) {
            expect(e.scope, e.id).not.toBe('board');
        }
    });
});

describe('elementBindings — board carried across scenes', () => {
    const scenes = (program, preview) => [
        { scene: 'Main', where: 'program', items: program },
        { scene: 'Staging', where: 'preview', items: preview },
    ];

    it('resolves the same board in both program and preview', () => {
        const b = elementBindings(
            el('scoreboard'), scenes([board(1), board(2)], [board(1), board(2)]), undefined, 2,
        );
        expect(b.program.item.sourceName).toBe('Board 2');
        expect(b.preview.item.sourceName).toBe('Board 2');
        expect(b.primary.item.sourceName).toBe('Board 2'); // program wins
    });

    it('falls back to preview when the board is only staged there', () => {
        const b = elementBindings(
            el('scoreboard'), scenes([board(1)], [board(1), board(2)]), undefined, 2,
        );
        expect(b.program).toBeNull();
        expect(b.primary.item.sourceName).toBe('Board 2');
        expect(b.primary.where).toBe('preview');
    });
});

/*
 * The retry that keeps existing rigs working: with exactly one source of the
 * type anywhere there is no ambiguity to resolve, so bind it whatever its
 * params say. Strictness is only worth a broken binding once a SECOND source
 * makes the question real — and the count has to be taken across all scenes,
 * or a board-1 source in program wins over the board 2 we asked for in preview.
 */
describe('elementBindings — lone-candidate retry', () => {
    const scenes = (program, preview = []) => [
        { scene: 'Main', where: 'program', items: program },
        { scene: 'Staging', where: 'preview', items: preview },
    ];

    it('binds a lone source of the type even when its board disagrees', () => {
        const b = elementBindings(el('scoreboard'), scenes([board(2)]), undefined, 1);
        expect(b.primary.item.sourceName).toBe('Board 2');
    });

    it('does NOT retry when a second source makes the board question real', () => {
        const b = elementBindings(el('scoreboard'), scenes([board(2), board(3)]), undefined, 1);
        expect(b.primary).toBeNull();
    });

    it('counts candidates across scenes, not within one', () => {
        // One per scene is still two sources, so the ask must be honoured
        // strictly rather than program's board 1 winning.
        const b = elementBindings(el('scoreboard'), scenes([board(1)], [board(2)]), undefined, 2);
        expect(b.program).toBeNull();
        expect(b.primary.item.sourceName).toBe('Board 2');
    });
});

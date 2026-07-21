import { describe, it, expect } from 'vitest';
import {
    elementInstances, instanceId, parseInstanceId, productionInstances, resolveInstance,
} from './instances';
import { ELEMENTS } from './elements';

const scoreboard = ELEMENTS.find(e => e.id === 'scoreboard');
const lowerthird = ELEMENTS.find(e => e.id === 'lowerthird');

const scene = (...urls) => ([{
    scene: 'Program', where: 'program',
    items: urls.map((url, i) => ({ id: i, sourceName: `S${i}`, url, enabled: true, isPrsh: true })),
}]);

describe('instance ids', () => {
    it('qualifies a board-scoped element and leaves a global one alone', () => {
        expect(instanceId(scoreboard, 2)).toBe('scoreboard:2');
        expect(instanceId(lowerthird, 2)).toBe('lowerthird');
    });

    it('does not mistake a desk id for a board instance', () => {
        // 'desk:match' shares the colon; the digits are what discriminate. A
        // desk parsed as an instance would be selected as an element and the
        // stage would fall through to "pick anything in the rack".
        expect(parseInstanceId('desk:match')).toEqual({ elementId: 'desk:match', board: null });
        expect(parseInstanceId('scoreboard:2')).toEqual({ elementId: 'scoreboard', board: 2 });
        expect(parseInstanceId('lowerthird')).toEqual({ elementId: 'lowerthird', board: null });
    });
});

describe('elementInstances', () => {
    it('gives a global element exactly one instance, with no board', () => {
        expect(elementInstances(lowerthird, scene('/layout/lowerthird/lowerthird.html'), [1, 2]))
            .toEqual([{ id: 'lowerthird', element: lowerthird, board: null }]);
    });

    it('unions the boards discovered in OBS with the boards declared in settings', () => {
        // Board 3 is on air but no longer active; board 2 is active with no
        // source yet. Dropping either is a way to lose a row that matters.
        const scenes = scene(
            '/layout/scoreboard1/scoreboard.html?scoreboard=3',
            '/layout/scoreboard1/scoreboard.html?scoreboard=1',
        );
        expect(elementInstances(scoreboard, scenes, [1, 2]).map(i => i.board)).toEqual([1, 2, 3]);
    });

    it('reads a paramless source as board 1, matching how binding compares it', () => {
        const scenes = scene('/layout/scoreboard1/scoreboard.html');
        expect(elementInstances(scoreboard, scenes, []).map(i => i.id)).toEqual(['scoreboard:1']);
    });

    it('still offers board 1 when there is neither a source nor an active board', () => {
        expect(elementInstances(scoreboard, [], []).map(i => i.id)).toEqual(['scoreboard:1']);
    });

    it('ignores sources of a different type when discovering boards', () => {
        const scenes = scene('/layout/lowerthird/lowerthird.html?scoreboard=4');
        expect(elementInstances(scoreboard, scenes, [1]).map(i => i.board)).toEqual([1]);
    });
});

describe('productionInstances', () => {
    it('expands only board-scoped elements, leaving the rest one row each', () => {
        const all = productionInstances([], [1, 2]);
        const boardScoped = ELEMENTS.filter(e => e.scope === 'board');
        expect(all.filter(i => i.element.id === 'scoreboard').map(i => i.id))
            .toEqual(['scoreboard:1', 'scoreboard:2']);
        expect(all.filter(i => i.element.id === 'lowerthird')).toHaveLength(1);
        expect(all).toHaveLength(ELEMENTS.length + boardScoped.length);
    });
});

describe('resolveInstance', () => {
    const instances = productionInstances([], [1, 2]);

    it('upgrades a pin written before instances existed', () => {
        expect(resolveInstance('scoreboard', instances).id).toBe('scoreboard:1');
    });

    it('rescues a selection whose board has since been removed', () => {
        expect(resolveInstance('scoreboard:7', instances).id).toBe('scoreboard:1');
    });

    it('keeps an id that still names a live instance', () => {
        expect(resolveInstance('scoreboard:2', instances).id).toBe('scoreboard:2');
    });

    it('returns null for an id no element answers to', () => {
        expect(resolveInstance('retired-element', instances)).toBeNull();
        expect(resolveInstance(null, instances)).toBeNull();
    });
});

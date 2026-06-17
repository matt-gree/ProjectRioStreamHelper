import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStateStore, useSettingsStore, setSocketRef } from './store';

// Clean baselines captured before any test mutates the singleton stores.
const STATE_INIT = useStateStore.getState();
const SETTINGS_INIT = useSettingsStore.getState();

beforeEach(() => {
    useStateStore.setState(STATE_INIT, true);   // replace → drops data, keeps actions
    useSettingsStore.setState(SETTINGS_INIT, true);
    setSocketRef(null);                          // no emits unless a test opts in
});

const st = () => useStateStore.getState();

describe('state store mutations', () => {
    it('setItem writes a nested value', () => {
        st().setItem('score.1.inning', 5, false);
        expect(st().getItem('score.1.inning')).toBe(5);
    });

    it('getItem returns default when missing', () => {
        expect(st().getItem('does.not.exist', 'fallback')).toBe('fallback');
    });

    it('setItems applies multiple keys in one update', () => {
        st().setItems([
            { key: 'score.1.outs', value: 2 },
            { key: 'score.1.balls', value: 3 },
        ], false);
        expect(st().getItem('score.1.outs')).toBe(2);
        expect(st().getItem('score.1.balls')).toBe(3);
    });

    it('setItem and setItems produce identical nested structure', () => {
        st().setItem('a.b.c', 1, false);
        const viaSetItem = st().getItem('a');
        useStateStore.setState(STATE_INIT, true);
        st().setItems([{ key: 'a.b.c', value: 1 }], false);
        expect(st().getItem('a')).toEqual(viaSetItem);
    });

    it('deleteItem removes a key', () => {
        st().setItem('a.b', 1, false);
        st().deleteItem('a.b', false);
        expect(st().getItem('a.b')).toBeUndefined();
    });

    it('deleteItems removes multiple keys', () => {
        // Nested keys mirror real usage (score.N.*). Top-level keys can't be
        // deleted this way — Zustand's set() merges, so an absent top-level key
        // is re-added; deleting a nested key replaces its present parent.
        st().setItems([
            { key: 'score.1.outs', value: 1 },
            { key: 'score.1.balls', value: 2 },
        ], false);
        st().deleteItems(['score.1.outs', 'score.1.balls'], false);
        expect(st().getItem('score.1.outs')).toBeUndefined();
        expect(st().getItem('score.1.balls')).toBeUndefined();
    });

    it('mergeItems merges a server snapshot', () => {
        st().mergeItems({ score: { 1: { inning: 7 } } });
        expect(st().getItem('score.1.inning')).toBe(7);
    });
});

describe('state store emits', () => {
    it('setItem emits v1.state.set when emit=true', () => {
        const socket = { emit: vi.fn() };
        setSocketRef(socket);
        st().setItem('x', 1, true);
        expect(socket.emit).toHaveBeenCalledWith('v1.state.set', { key: 'x', value: 1 });
    });

    it('setItems emits a single v1.state.set_batch frame', () => {
        const socket = { emit: vi.fn() };
        setSocketRef(socket);
        st().setItems([{ key: 'a', value: 1 }, { key: 'b', value: 2 }], true);
        expect(socket.emit).toHaveBeenCalledTimes(1);
        expect(socket.emit).toHaveBeenCalledWith('v1.state.set_batch', {
            items: [{ key: 'a', value: 1 }, { key: 'b', value: 2 }],
        });
    });

    it('does not emit when emit=false', () => {
        const socket = { emit: vi.fn() };
        setSocketRef(socket);
        st().setItem('x', 1, false);
        expect(socket.emit).not.toHaveBeenCalled();
    });
});

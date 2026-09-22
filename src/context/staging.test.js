import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/notify', () => ({ notifications: { show: vi.fn() } }));

import {
    useStagingStore, stageOrRun, commitPending, comboFromEvent, eventMatchesHotkey,
} from './staging';
import { useSettingsStore } from './store';
import { notifications } from '../lib/notify';

const SETTINGS_INIT = useSettingsStore.getState();
const staging = () => useStagingStore.getState();

beforeEach(() => {
    useSettingsStore.setState(SETTINGS_INIT, true);
    useStagingStore.setState({ pending: {}, order: [] });
    vi.clearAllMocks();
});

const enableConfirm = () =>
    useSettingsStore.getState().setItem('production.confirm.enabled', true, false);

describe('stageOrRun', () => {
    it('runs immediately when confirm mode is off', () => {
        const run = vi.fn();
        stageOrRun({ key: 'k', label: 'thing', value: 1, run });
        expect(run).toHaveBeenCalledOnce();
        expect(staging().order).toEqual([]);
    });

    it('toasts (not throws) when an immediate run rejects', async () => {
        stageOrRun({ key: 'k', label: 'thing', value: 1, run: () => Promise.reject(new Error('boom')) });
        await Promise.resolve(); await Promise.resolve(); // flush the catch
        expect(notifications.show).toHaveBeenCalledWith(
            expect.objectContaining({ color: 'red' }));
    });

    it('stages instead of running when confirm mode is on', () => {
        enableConfirm();
        const run = vi.fn();
        stageOrRun({ key: 'k', label: 'thing', value: 1, run });
        expect(run).not.toHaveBeenCalled();
        expect(staging().pending.k.value).toBe(1);
    });

    it('re-staging the same key replaces the entry but keeps its slot in order', () => {
        enableConfirm();
        stageOrRun({ key: 'a', label: 'A', value: 1, run: vi.fn() });
        stageOrRun({ key: 'b', label: 'B', value: 2, run: vi.fn() });
        stageOrRun({ key: 'a', label: 'A2', value: 3, run: vi.fn() });
        expect(staging().order).toEqual(['a', 'b']);
        expect(staging().pending.a.value).toBe(3);
    });

    it('staging back to the live value drops the pending entry', () => {
        enableConfirm();
        stageOrRun({ key: 'vis', label: 'Show X', value: true, liveValue: false, run: vi.fn() });
        expect(staging().order).toEqual(['vis']);
        stageOrRun({ key: 'vis', label: 'Hide X', value: false, liveValue: false, run: vi.fn() });
        expect(staging().order).toEqual([]);
    });
});

describe('commit', () => {
    it('executes entries in first-staged order and clears the buffer', async () => {
        enableConfirm();
        const calls = [];
        stageOrRun({ key: 'a', label: 'A', value: 1, run: () => calls.push('a') });
        stageOrRun({ key: 'b', label: 'B', value: 2, run: () => calls.push('b') });
        stageOrRun({ key: 'a', label: 'A2', value: 3, run: () => calls.push('a2') });
        const { ran, errors } = await staging().commit();
        expect(calls).toEqual(['a2', 'b']);
        expect(ran).toBe(2);
        expect(errors).toEqual([]);
        expect(staging().order).toEqual([]);
    });

    it('a failing entry does not block the rest and is reported', async () => {
        enableConfirm();
        const ok = vi.fn();
        stageOrRun({ key: 'bad', label: 'Bad', value: 1, run: () => { throw new Error('nope'); } });
        stageOrRun({ key: 'good', label: 'Good', value: 2, run: ok });
        const { ran, errors } = await staging().commit();
        expect(ok).toHaveBeenCalledOnce();
        expect(ran).toBe(1);
        expect(errors).toEqual(['Bad: nope']);
    });

    it('commitPending is quiet when nothing is staged', async () => {
        await commitPending();
        expect(notifications.show).not.toHaveBeenCalled();
    });
});

describe('discard', () => {
    it('discard removes one entry; discardAll empties the buffer', () => {
        enableConfirm();
        stageOrRun({ key: 'a', label: 'A', value: 1, run: vi.fn() });
        stageOrRun({ key: 'b', label: 'B', value: 2, run: vi.fn() });
        staging().discard('a');
        expect(staging().order).toEqual(['b']);
        staging().discardAll();
        expect(staging().order).toEqual([]);
    });
});

describe('hotkeys', () => {
    const ev = (key, mods = {}) => ({
        key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
    });

    it('builds combos in Ctrl/Meta/Alt/Shift order, uppercasing single chars', () => {
        expect(comboFromEvent(ev('F9'))).toBe('F9');
        expect(comboFromEvent(ev('l', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+L');
        expect(comboFromEvent(ev(' ', { metaKey: true }))).toBe('Meta+Space');
    });

    it('a bare modifier press is not a combo', () => {
        expect(comboFromEvent(ev('Shift', { shiftKey: true }))).toBeNull();
    });

    it('matching is case-insensitive and modifier-exact', () => {
        expect(eventMatchesHotkey(ev('F9'), 'f9')).toBe(true);
        expect(eventMatchesHotkey(ev('F9', { ctrlKey: true }), 'F9')).toBe(false);
        expect(eventMatchesHotkey(ev('Enter', { ctrlKey: true }), 'Ctrl+Enter')).toBe(true);
        expect(eventMatchesHotkey(ev('Enter'), '')).toBe(false);
    });
});

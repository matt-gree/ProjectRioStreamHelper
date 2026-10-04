import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { useObsStore } from '../../../context/obs';
import { Stage } from './index';
import { LookRow, withLookVariant } from './look';
import { ELEMENTS } from '../elements';
import { variantLabelFor } from '../sources/instances';

/*
 * LOOKS on the console: a named variation of one element's settings, worn by a
 * source. The panel is the same panel; the Look row says which one it edits.
 */

// usePersistentState needs a working localStorage (see rack.test.jsx).
const store = new Map();
const fakeLocalStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};

beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', fakeLocalStorage);
    useSettingsStore.setState({ overlays: {}, scoreboards: { active: [1] }, production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
    useObsStore.setState({ status: 'disconnected', sceneItems: {}, scenes: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = (selection = 'statsbar~t1') =>
    render(<TooltipProvider><Stage selection={selection} /></TooltipProvider>);
const statsbar = () => useSettingsStore.getState().overlays?.statsbar ?? {};
const lookSelect = () => screen.getByRole('combobox', { name: 'Look' });

describe('the Look row', () => {
    it('starts on Main, and New look makes one and wears it', () => {
        ui();
        expect(lookSelect()).toHaveValue('');
        fireEvent.click(screen.getByRole('button', { name: /New look/ }));
        const [[id, look]] = Object.entries(statsbar().looks);
        expect(look).toEqual({ name: 'Look 1', values: {} });
        // A catalog row (OBS closed) remembers the pick in the browser.
        expect(lookSelect()).toHaveValue(id);
    });

    // Every setting on the panel edits the look, and Main is left alone.
    it('writes settings to the look, marks them, and hands one back to Main', () => {
        useSettingsStore.setState({
            overlays: { statsbar: { showRoster: false, looks: { kb: { name: 'Break', values: {} } } } },
        });
        ui();
        fireEvent.change(lookSelect(), { target: { value: 'kb' } });
        fireEvent.click(screen.getByText('Roster'));
        expect(statsbar().looks.kb.values.showRoster).toBe(true);
        expect(statsbar().showRoster).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: 'Use Main for Roster' }));
        expect(statsbar().looks.kb.values.showRoster ?? null).toBeNull();
        expect(screen.queryByRole('button', { name: 'Use Main for Roster' })).not.toBeInTheDocument();
    });

    // Stored ids are resolved at read time: one naming a deleted look is Main,
    // because Main is what that source draws.
    it('reads a remembered look back, and a dead one as Main', () => {
        useSettingsStore.setState({
            overlays: { statsbar: { looks: { kb: { name: 'Break', values: { showRoster: true } } } } },
        });
        store.set('prsh.ui.production.looks', JSON.stringify({ 'statsbar~t1': 'kb' }));
        ui();
        expect(lookSelect()).toHaveValue('kb');
        cleanup();
        store.set('prsh.ui.production.looks', JSON.stringify({ 'statsbar~t1': 'kgone' }));
        ui();
        expect(lookSelect()).toHaveValue('');
    });

    it('deletes a look in two steps, and the source goes back to Main', () => {
        useSettingsStore.setState({
            overlays: { statsbar: { looks: { kb: { name: 'Break', values: {} } } } },
        });
        ui();
        fireEvent.change(lookSelect(), { target: { value: 'kb' } });
        fireEvent.click(screen.getByRole('button', { name: 'Delete Break' }));
        expect(statsbar().looks.kb).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(statsbar().looks?.kb).toBeUndefined();
        expect(lookSelect()).toHaveValue('');
    });
});

/*
 * On a real source the look rides its URL (`?look=`), so wearing one re-points
 * the OBS input, and the panel follows the source to its new placement id.
 */
describe('a source in OBS', () => {
    const STATSBAR = ELEMENTS.find(e => e.id === 'statsbar');
    const URL_BASE = 'http://localhost:5260/layout/scoreboard1/statsbar.html?scoreboard=1&team=1';
    const placement = (url = URL_BASE) => ({
        element: STATSBAR, board: 1, scene: 'Game', variant: 't1',
        item: { sourceName: 'Stat Bar 1', url },
    });

    it('re-points the source at the look, and selects it there', async () => {
        useSettingsStore.setState({
            overlays: { statsbar: { looks: { kb: { name: 'Break', values: {} } } } },
        });
        const repointBrowserSource = vi.fn(() => Promise.resolve({ sourceName: 'Stat Bar 1' }));
        useObsStore.setState({ repointBrowserSource });
        const onSelect = vi.fn();
        render(<TooltipProvider><LookRow element={STATSBAR} placement={placement()} onSelect={onSelect} /></TooltipProvider>);
        fireEvent.change(lookSelect(), { target: { value: 'kb' } });
        await waitFor(() => expect(repointBrowserSource).toHaveBeenCalledWith({
            sourceName: 'Stat Bar 1', url: `${URL_BASE}&look=kb`,
        }));
        await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.stringContaining('kkb')));
    });

    it('sets only the look axis of a variant, and a look adds no variant label', () => {
        expect(withLookVariant('t1', 'kb')).toBe('t1.kkb');
        expect(withLookVariant('t1.kkb', null)).toBe('t1');
        // The name is the producer's, in settings — the rack adds it.
        expect(variantLabelFor(STATSBAR, 'kkb', 'numeric')).toBeNull();
    });
});

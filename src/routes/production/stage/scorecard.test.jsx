import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
import { Stage } from './index';

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
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(<TooltipProvider><Stage selection="scorecard" /></TooltipProvider>);

// The scorecard's bands are flipped DURING a broadcast, which is why they moved
// out of Setup and onto the console. These pin the two things that would break
// silently: writing to the per-board namespace, and honouring confirm mode.
describe('Scorecard stage', () => {
    it('offers every live band switch declared for the layout', () => {
        ui();
        for (const def of LAYOUT_SETTINGS.scorecard.filter(d => d.type === 'switch')) {
            expect(screen.getByText(def.label), def.key).toBeInTheDocument();
        }
    });

    it('leaves the text fields to Setup — the kit has no text row', () => {
        ui();
        for (const def of LAYOUT_SETTINGS.scorecard.filter(d => d.type === 'text')) {
            expect(screen.queryByText(def.label), def.key).not.toBeInTheDocument();
        }
    });

    it('writes per board, so two scorecard sources stay independent', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui();
        // The board picker only renders with more than one active board.
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
        // Clicking a toggle row's label flips its switch (default true → false).
        fireEvent.click(screen.getByText('Box Score'));
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[2]?.showBoxScore).toBe(false);
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[1]).toBeUndefined();
    });

    it('stages a band instead of cutting it live when confirm mode is on', () => {
        useSettingsStore.setState({ production: { confirm: { enabled: true } } });
        ui();
        fireEvent.click(screen.getByText('Stadium'));
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[1]).toBeUndefined();
        expect(useStagingStore.getState().pending['settings:overlays.scorecard.1.showStadium']).toBeTruthy();
    });
});

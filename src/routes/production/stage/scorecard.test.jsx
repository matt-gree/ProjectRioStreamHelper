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

// The selection carries the board (../instances), so "the Scorecard stage for
// board 2" is a selection, not a dropdown inside the panel.
const ui = (selection = 'scorecard:1') =>
    render(<TooltipProvider><Stage selection={selection} /></TooltipProvider>);

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

    it('surfaces the authored text fields too — nothing lands on Setup only', () => {
        ui();
        for (const def of LAYOUT_SETTINGS.scorecard.filter(d => d.type === 'text')) {
            expect(screen.getByText(def.label), def.key).toBeInTheDocument();
        }
    });

    /*
     * The panel reads down the card: top bars, score block, lower bars. The
     * header title and the phase text used to sit in the catch-all Style
     * section, a scroll below the switch each one belongs to — with a sentence
     * in the panel explaining where they had gone.
     */
    it('groups the bands down the card, with each bar’s text beside its switch', () => {
        ui();
        const groups = [...document.querySelectorAll('[data-setting-group]')]
            .map(e => e.dataset.settingGroup);
        expect(groups).toEqual(['Top bars', 'Score block', 'Lower bars']);
        const top = document.querySelector('[data-setting-group="Top bars"]');
        expect(top).toHaveTextContent('Header Bar');
        expect(top).toHaveTextContent('Header Title');
        expect(screen.queryByText('Style')).not.toBeInTheDocument();
    });

    // The headline decision stays flat above the groups — it is also the rail
    // card's one quick-face row, and the card has no room for a group eyebrow.
    it('keeps the score block mode out of the groups', () => {
        ui();
        for (const g of document.querySelectorAll('[data-setting-group]')) {
            expect(g).not.toHaveTextContent('Score Block');
        }
        expect(screen.getByText('Score Block')).toBeInTheDocument();
    });

    it('writes an authored text field to the per-board namespace', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('scorecard:2');
        const input = screen.getByPlaceholderText('Project Rio'); // titleText placeholder
        fireEvent.change(input, { target: { value: 'Finals' } });
        fireEvent.blur(input); // kit text rows debounce; blur commits now
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[2]?.titleText).toBe('Finals');
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[1]).toBeUndefined();
    });

    it('writes per board, so two scorecard sources stay independent', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('scorecard:2');
        // Clicking a toggle row's label flips its switch (default true → false).
        fireEvent.click(screen.getByText('Box Score'));
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[2]?.showBoxScore).toBe(false);
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[1]).toBeUndefined();
    });

    it('has no board picker — the board is which panel you are on', () => {
        // Two active boards used to render a dropdown here, which is the thing
        // that let the panel's rows and its header strip point at different
        // boards. Two rack rows replaced it.
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('scorecard:2');
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('resolves a selection stored before instances existed', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui('scorecard');
        fireEvent.click(screen.getByText('Box Score'));
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[1]?.showBoxScore).toBe(false);
    });

    it('stages a band instead of cutting it live when confirm mode is on', () => {
        useSettingsStore.setState({ production: { confirm: { enabled: true } } });
        ui();
        fireEvent.click(screen.getByText('Stadium'));
        expect(useSettingsStore.getState()?.overlays?.scorecard?.[1]).toBeUndefined();
        expect(useStagingStore.getState().pending['settings:overlays.scorecard.1.showStadium']).toBeTruthy();
    });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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

    /*
     * A paired field draws no label of its own — the chip beside it names the
     * band — so its label lives on as the input's ACCESSIBLE name. By name is
     * how it must stay findable: the placeholder is the only other clue, and
     * that disappears the moment the field holds a value.
     */
    it('surfaces the authored text fields too — nothing lands on Setup only', () => {
        ui();
        for (const def of LAYOUT_SETTINGS.scorecard.filter(d => d.type === 'text')) {
            expect(screen.getByLabelText(def.label), def.key).toBeInTheDocument();
        }
    });

    /*
     * The panel reads down the card: top bars, score block, lower bars. The
     * header title and the phase text used to sit in the catch-all Style
     * section, a scroll below the switch each one belongs to — with a sentence
     * in the panel explaining where they had gone. They are now on the SAME ROW
     * as that bar's toggle, which is what lets the toggle be a chip like every
     * other band toggle without stranding the text it draws.
     */
    it('groups the bands down the card, with each bar’s text beside its toggle', () => {
        ui();
        const groups = [...document.querySelectorAll('[data-setting-group]')]
            .map(e => e.dataset.settingGroup);
        // The middle block is the score-block mode, ungrouped: it is one control
        // standing in for a whole region, so it takes the region's PLACE without
        // taking an eyebrow.
        expect(groups).toEqual(['Top bars', '', 'Lower bars']);
        const top = document.querySelector('[data-setting-group="Top bars"]');
        expect(within(top).getByRole('button', { name: 'Header Bar' })).toBeInTheDocument();
        expect(within(top).getByLabelText('Header Title')).toBeInTheDocument();
        expect(screen.queryByText('Style')).not.toBeInTheDocument();
    });

    // The pair is one row: the bar's toggle and the text it draws, together.
    it('puts a bar’s toggle and its text field on the same row', () => {
        ui();
        const chip = screen.getByRole('button', { name: 'Bracket Phase' });
        const field = screen.getByLabelText('Phase Text');
        expect(chip.parentElement).toBe(field.closest('div').parentElement);
    });

    /*
     * Game Mode is the only Top bar with no title field, and it rendered at its
     * own content width beside two toggles sized to the label column — one
     * region, two chip widths. A toggle with no field is still a bar in the
     * list, so it takes the same column.
     */
    it('gives every toggle in a paired region the same width', () => {
        ui();
        const width = (name) => screen.getByRole('button', { name }).className;
        expect(width('Game Mode')).toBe(width('Header Bar'));
        expect(width('Game Mode')).toBe(width('Bracket Phase'));
        // Regions with no pairs still pack: a strip chip is not column-sized.
        expect(width('Box Score')).not.toBe(width('Game Mode'));
    });

    /*
     * The score block's only control is the mode, and it reads in card order —
     * after the top bars, before the lower ones. It used to be hoisted flat
     * above the groups because the block was a REGION back then (mode + Rosters
     * + Bases); once the switches went, hoisting it left the panel's one
     * segmented control sitting outside the order it describes.
     */
    it('places the score block mode between the top and lower bars', () => {
        ui();
        const rows = [...document.querySelectorAll('[data-setting-group]')];
        expect(within(rows[1]).getByText('Score Block')).toBeInTheDocument();
        // ...and it is the whole block: no Rosters/Bases switches beside it.
        expect(screen.queryByText('Rosters')).not.toBeInTheDocument();
        expect(screen.queryByText('Bases / Diamond')).not.toBeInTheDocument();
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
        // A band toggle is a chip; clicking it flips it (default true → false).
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

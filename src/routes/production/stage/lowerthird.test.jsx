import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
import { Stage } from './index';

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
    useStateStore.setState({
        match: {},
        lowerthird: {
            slots: {
                1: { type: 'message', enabled: true, title: 'Winners Final' },
                3: { type: 'clock', enabled: true, clock: { mode: 'countdown', durationSec: 300 } },
            },
        },
    });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(<TooltipProvider><Stage selection="lowerthird" /></TooltipProvider>);

/*
 * The stage is a band ribbon over one editor: the ribbon is the master (every
 * slot has a segment, because a segment is how a slot is reached) and the
 * panel beneath is the detail for whichever segment is selected. Reorder lives
 * on the ribbon, so the producer moves a slot on the picture of the band
 * rather than in a list beside it.
 */
describe('Lower third stage', () => {
    const band = () => within(screen.getByRole('tablist', { name: 'Band preview' }));

    it('gives every slot a segment, including the empty ones', () => {
        ui();
        expect(band().getAllByRole('tab')).toHaveLength(5);
        // An empty slot still has to be reachable or it could never be filled.
        expect(band().getByRole('tab', { name: 'Slot 2 — empty' })).toBeInTheDocument();
    });

    it('carries on-air state on the segment rather than by presence', () => {
        ui();
        expect(band().getByRole('tab', { name: 'Slot 1 — Message' })).toBeInTheDocument();
        expect(band().getByRole('tab', { name: 'Slot 3 — Clock' })).toBeInTheDocument();
    });

    it('edits the selected slot, and selecting swaps which one', async () => {
        const user = userEvent.setup();
        ui();
        // Slot 1 leads, so its fields are open with no expand step.
        expect(screen.getByDisplayValue('Winners Final')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();

        await user.click(band().getByRole('tab', { name: 'Slot 3 — Clock' }));

        // The clock's countdown transport is momentary and lives with its fields.
        expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
        expect(screen.queryByDisplayValue('Winners Final')).not.toBeInTheDocument();
    });

    it('marks the selected segment for assistive tech', async () => {
        const user = userEvent.setup();
        ui();
        expect(band().getByRole('tab', { name: 'Slot 1 — Message' })).toHaveAttribute('aria-selected', 'true');
        await user.click(band().getByRole('tab', { name: 'Slot 3 — Clock' }));
        expect(band().getByRole('tab', { name: 'Slot 3 — Clock' })).toHaveAttribute('aria-selected', 'true');
    });

    it('reorders along the band from the ribbon, not up and down a list', () => {
        ui();
        expect(screen.getByLabelText('Move slot 1 right')).toBeInTheDocument();
        expect(screen.queryByLabelText('Move slot 1 down')).not.toBeInTheDocument();
    });

    // Controller ports are a live-game idea; the break band is between games.
    it('offers no per-port colour controls', () => {
        expect(LAYOUT_SETTINGS.lowerthird ?? []).toEqual([]);
    });

    /*
     * Fields were bare inputs whose only description was a placeholder — which
     * the value erases. A producer returning to a filled band saw an unlabelled
     * box with their caption in it and no way to know what it fed. A field's
     * name has to survive the field being filled in.
     */
    it('names every field, and the name outlives the value', () => {
        ui();
        const title = screen.getByLabelText('Title');
        expect(title).toHaveValue('Winners Final');
        expect(screen.getByLabelText('Subtitle')).toBeInTheDocument();
    });

    /*
     * Show/hide belongs on the ribbon segment, not in the editor: the ribbon
     * already carries the state (lit / dimmed), and a control on the far side
     * of the page from its own result is a control you have to go and check.
     * It is also not "on air" — the band's OBS source is what goes on air; a
     * slot only decides whether it is in the band.
     */
    it('hides and shows a slot from its own ribbon segment', async () => {
        const user = userEvent.setup();
        ui();
        expect(screen.queryByText('On air')).not.toBeInTheDocument();

        await user.click(band().getByLabelText('Hide slot 1'));
        expect(useStateStore.getState().lowerthird.slots[1].enabled).toBe(false);
        expect(band().getByLabelText('Show slot 1')).toBeInTheDocument();
    });

    // An empty slot has nothing to show, so its eye is inert rather than absent
    // — the segment keeps one shape whatever it holds.
    it('leaves the eye disabled on an empty slot', () => {
        ui();
        expect(band().getByLabelText('Slot 2 is empty')).toBeDisabled();
    });

    /*
     * The taller ribbon has to earn its height. A type name alone reads the
     * same on every band; what a producer glances at mid-break is the CONTENT.
     */
    it('says what each segment is carrying, not just its type', () => {
        ui();
        expect(band().getByText('Winners Final')).toBeInTheDocument();  // message title
        expect(band().getByText('Countdown')).toBeInTheDocument();      // clock mode
        expect(band().getAllByText('Pick a type')).toHaveLength(3);     // slots 2, 4, 5
    });
});

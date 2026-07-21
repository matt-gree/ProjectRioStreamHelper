import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
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
 * The band's five slots are five columns in the order they render on air, with
 * every editor open. A producer mid-break should never have to remember which
 * collapsed row holds the countdown, so these pin that the fields are reachable
 * without an expand step — the regression an accordion would reintroduce.
 */
describe('Lower third stage', () => {
    it('shows one card per band slot', () => {
        ui();
        expect(screen.getAllByLabelText(/Slot \d content type/)).toHaveLength(5);
    });

    it('renders an authored slot’s fields without an expand step', () => {
        ui();
        expect(screen.getByDisplayValue('Winners Final')).toBeInTheDocument();
    });

    it('renders clock transport for a running-capable slot', () => {
        ui();
        // Countdown length + the momentary transport, both live on the card.
        expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    });

    it('offers reorder along the band, not up and down a list', () => {
        ui();
        expect(screen.getByLabelText('Move slot 1 right')).toBeInTheDocument();
        expect(screen.queryByLabelText('Move slot 1 down')).not.toBeInTheDocument();
    });
});

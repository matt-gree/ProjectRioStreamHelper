import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useStateStore } from '../../context/store';
import MatchDesk from './desks/match';
import CaptureDesk from './desks/capture';
import BracketDesk from './desks/bracket';

// Desks are content workflows, not OBS ones: they must be fully usable with
// OBS disconnected. Both fetch on mount (game modes / nothing), so stub it.
beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true, json: () => Promise.resolve({}),
    })));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

describe('Match desk', () => {
    it('renders its empty state with a way to create the first fixture', () => {
        ui(<MatchDesk />);
        expect(screen.getByText(/No matches yet/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /New match/ })).toBeInTheDocument();
    });

    /*
     * The console opens on the Match desk and the accordion auto-expands the
     * newest match, so this is the FIRST thing a user with any fixture sees at
     * launch. Testing only the empty state above missed a ReferenceError in the
     * expanded body that whitescreened the app on startup — render a real match.
     */
    it('renders an expanded fixture body — the default view at launch', () => {
        useStateStore.setState({
            match: {
                1: {
                    label: 'Winners Final', stage: 'live',
                    format: { bestOf: 3 }, series: { 1: 1, 2: 0 },
                },
            },
        });
        ui(<MatchDesk />);
        expect(screen.queryByText(/No matches yet/)).not.toBeInTheDocument();
        // The expanded body's start.gg control — the icon that was undefined.
        expect(screen.getByRole('button', { name: /start\.gg/ })).toBeInTheDocument();
    });
});

describe('Capture desk', () => {
    it('offers capture and explains why there is nothing to capture yet', () => {
        ui(<CaptureDesk />);
        expect(screen.getByRole('button', { name: /Capture finished game/ })).toBeInTheDocument();
        expect(screen.getByText(/No game id on this board yet/)).toBeInTheDocument();
    });

    it('hides Clear until something is captured', () => {
        ui(<CaptureDesk />);
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });
});

describe('Bracket desk', () => {
    beforeEach(() => useStateStore.setState({ bracket: {} }));

    it('points at the Competition tab when no event is loaded', async () => {
        ui(<BracketDesk />);
        // /startgg/phases resolves to {} → no phase groups to offer.
        await waitFor(() =>
            expect(screen.getByText(/No start.gg event loaded/)).toBeInTheDocument());
    });

    it('names the loaded phase and enables the re-pull', async () => {
        useStateStore.setState({ bracket: { phaseName: 'Winners Pool A', phaseGroupId: 77 } });
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ name: 'Winners', phaseGroups: [{ id: 77 }] }]),
        })));
        ui(<BracketDesk />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Refresh/ })).toBeEnabled());
        expect(screen.getByText('Winners Pool A')).toBeInTheDocument();
    });

    it('re-pulls the phase that is already on screen', async () => {
        useStateStore.setState({ bracket: { phaseName: 'Winners', phaseGroupId: 77 } });
        const fetchMock = vi.fn((url) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(url.includes('/phases')
                ? [{ name: 'Winners', phaseGroups: [{ id: 77 }] }] : {}),
        }));
        vi.stubGlobal('fetch', fetchMock);
        ui(<BracketDesk />);
        await waitFor(() => expect(screen.getByRole('button', { name: /Refresh/ })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/startgg/load-bracket?phase_group_id=77', { method: 'POST' }));
    });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { ELEMENTS } from '../elements';
import BracketStage from './bracket';

/*
 * THE PHASE LIVES ON THE SOURCE THAT DRAWS IT.
 *
 * It used to live on a Bracket desk — a permanent rack row holding a picker that
 * both of its consumers (this stage, and the lower-third's bracket slot) already
 * rendered from the same shared hook. The desk was a third copy of one control,
 * for a workflow that only matters when something is on air to draw it.
 *
 * The objection to moving it was reachability: with OBS connected the rack lists
 * only sources that are really in a scene. It does not hold — the rack lists
 * every SCENE's sources (../placements), so a bracket source anywhere in OBS
 * gets a row, and with OBS closed the catalog tier lists every element outright.
 */

const element = ELEMENTS.find(e => e.id === 'bracket');

beforeEach(() => {
    useSettingsStore.setState({ production: {} });
    useStateStore.setState({ bracket: {} });
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('/phases')
            ? [{ name: 'Winners', phaseGroups: [{ id: 77 }] }]
            : {}),
    })));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(
    <TooltipProvider><BracketStage element={element} /></TooltipProvider>,
);

describe('Bracket stage', () => {
    it('chooses the phase here, rather than pointing at a desk', async () => {
        ui();
        await waitFor(() => expect(screen.getByText('Phase')).toBeInTheDocument());
        expect(screen.queryByText(/Bracket desk/)).not.toBeInTheDocument();
    });

    /*
     * The re-pull is the control with a live tempo — start.gg advances all night
     * and the drawn phase goes stale — so it is the reason this surface is worth
     * pinning at all. Disabled until there is a phase to re-pull.
     */
    it('re-pulls the loaded phase from start.gg', async () => {
        useStateStore.setState({ bracket: { phaseName: 'Winners', phaseGroupId: 77 } });
        ui();
        await waitFor(() => expect(screen.getByRole('button', { name: /Refresh/ })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            '/api/v1/startgg/load-bracket?phase_group_id=77', { method: 'POST' },
        ));
    });

    it('offers no re-pull with nothing loaded', async () => {
        ui();
        await waitFor(() => expect(screen.getByText('Phase')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Refresh/ })).toBeDisabled();
    });

    /*
     * ONE loaded phase, app-wide — the panel says so rather than letting a
     * producer read a per-source control into it and wonder why the other
     * bracket source changed too.
     */
    it('says the phase is shared by every bracket source', async () => {
        useStateStore.setState({ bracket: { phaseName: 'Winners', phaseGroupId: 77 } });
        ui();
        await waitFor(() =>
            expect(screen.getByText(/Every bracket source draws this phase/)).toBeInTheDocument());
    });

    // No event loaded at all: the picker has nothing to offer, and the way out
    // is a different tab — which is the one thing this surface cannot do itself.
    it('points at the Competition tab when no event is loaded', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
            ok: true, json: () => Promise.resolve([]),
        })));
        ui();
        await waitFor(() =>
            expect(screen.getByText(/No start.gg event loaded/)).toBeInTheDocument());
    });
});

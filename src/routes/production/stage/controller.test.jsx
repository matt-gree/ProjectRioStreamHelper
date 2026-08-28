import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '../../../components/ui/tooltip';
import ControllerStage from './controller';

/*
 * The controller stage owns what is true of this element ON THE BROADCAST — the
 * two per-side follow URLs, and a read-only line about the reader.
 *
 * The gc-overlay SUBPROCESS moved to the Connections tab: start/stop used to
 * live here, which meant the reader could only be started from a panel that
 * only exists once an OBS source for it has been added. These tests pin that
 * there is no second control here — a Start button on this panel is the
 * duplication the move existed to end.
 */

const element = { id: 'controller', name: 'Controller', url: '/layout/controller/controller.html', width: 512, height: 256 };

const mockFetch = (status) => vi.fn((url) => {
    if (url === '/api/v1/controller/status') return Promise.resolve({ json: () => Promise.resolve(status) });
    return Promise.resolve({ json: () => Promise.resolve({}) });
});

const ui = () => render(
    <MemoryRouter>
        <TooltipProvider><ControllerStage element={element} /></TooltipProvider>
    </MemoryRouter>,
);

describe('ControllerStage', () => {
    beforeEach(() => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    // With no submodule and no configured path the status endpoint reports
    // available: false. That is now the ONLY thing that makes this panel empty —
    // there is no platform gate, so a producer on any OS reaches this note and
    // learns there is something to install.
    it('shows the not-installed note when gc-overlay is absent, and points at Connections', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: false }));
        ui();
        expect(await screen.findByText(/isn.t installed/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /connections/i })).toHaveAttribute('href', '/connections');
    });

    it('never offers a second Start control — the lifecycle lives on Connections', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: true, running: false, port: 8069 }));
        ui();
        await screen.findByText(/Reader stopped/i);
        expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /connections/i })).toBeInTheDocument();
    });

    it('reports the reader running, with its port', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: true, running: true, port: 8071 }));
        ui();
        expect(await screen.findByText(/Reader running on port 8071/)).toBeInTheDocument();
    });

    /*
     * Per-side follow is the recommended pair and must not depend on the
     * subprocess running — it's a PRSH-served layout, so the URL is copyable
     * while a producer builds the scene and the reader comes up later.
     */
    it('always offers the two per-side follow URLs, reader or no reader', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: true, running: false, port: 8069 }));
        ui();
        expect(await screen.findByText('Side 1')).toBeInTheDocument();
        expect(screen.getByText('Side 2')).toBeInTheDocument();
        const copies = screen.getAllByRole('button', { name: /copy/i });
        expect(copies).toHaveLength(2);
        expect(copies.filter(b => b.disabled)).toHaveLength(0);
    });

    it('copies the per-side URL host-qualified from the browser origin', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: true, running: true, port: 8069 }));
        ui();
        const side1 = await screen.findByText('Side 1');
        const row = side1.closest('div');
        fireEvent.click(row.querySelector('button'));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            `${window.location.origin}/layout/controller/controller.html?team=1`,
        ));
    });
});

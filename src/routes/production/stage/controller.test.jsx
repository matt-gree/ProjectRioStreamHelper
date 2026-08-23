import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import ControllerStage from './controller';

/*
 * The controller stage owns what only this element has: the gc-overlay
 * subprocess lifecycle and the source URLs to copy, lifted out of Setup. The
 * rack row's show/hide is the direct-element floor and lives elsewhere.
 */

const element = { id: 'controller', name: 'Controller', url: '/layout/controller/controller.html', width: 512, height: 256 };

const mockFetch = (status) => vi.fn((url) => {
    if (url === '/api/v1/controller/status') return Promise.resolve({ json: () => Promise.resolve(status) });
    if (url === '/api/v1/controller/start') return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    if (url === '/api/v1/controller/stop') return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
    return Promise.resolve({ json: () => Promise.resolve({}) });
});

const ui = () => render(
    <TooltipProvider><ControllerStage element={element} /></TooltipProvider>,
);

describe('ControllerStage', () => {
    beforeEach(() => {
        // window.location.origin is jsdom's http://localhost:3000 by default.
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    });
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

    // Off-Darwin (or no submodule) the status endpoint reports available: false.
    it('shows the not-available note when gc-overlay is absent', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: false }));
        ui();
        expect(await screen.findByText(/isn.t available here/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
    });

    it('offers Start when available and stopped, and calls the start endpoint', async () => {
        const fetch = mockFetch({ available: true, running: false, port: 8069 });
        vi.stubGlobal('fetch', fetch);
        ui();
        const start = await screen.findByRole('button', { name: /^start$/i });
        fireEvent.click(start);
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/controller/start', { method: 'POST' }));
    });

    /*
     * Per-side follow is the recommended pair and must not depend on the
     * subprocess running — it's a PRSH-served layout. Per-port URLs are fixed to
     * a controller index and only work while gc-overlay runs.
     */
    it('always offers the two per-side follow URLs; per-port only while running', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: true, running: false, port: 8069 }));
        ui();
        expect(await screen.findByText('Side 1')).toBeInTheDocument();
        expect(screen.getByText('Side 2')).toBeInTheDocument();
        // Per-port copy buttons are present but disabled until running.
        const copies = screen.getAllByRole('button', { name: /copy/i });
        // 2 per-side (enabled) + 4 per-port (disabled) = 6.
        expect(copies).toHaveLength(6);
        expect(copies.filter(b => b.disabled)).toHaveLength(4);
    });

    it('copies the per-side URL host-qualified from the browser origin', async () => {
        vi.stubGlobal('fetch', mockFetch({ available: true, running: true, port: 8069 }));
        ui();
        const side1 = await screen.findByText('Side 1');
        // The row's copy button sits beside the label.
        const row = side1.closest('div');
        fireEvent.click(row.querySelector('button'));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            `${window.location.origin}/layout/controller/controller.html?team=1`,
        ));
    });
});

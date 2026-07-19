import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import Production from './production';

const store = new Map();
beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true, json: () => Promise.resolve({}),
    })));
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: {} });
    useStateStore.setState({ match: {}, score: {}, postgame: {}, bracket: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(<TooltipProvider><Production /></TooltipProvider>);

/*
 * Whole-page mount — the launch path.
 *
 * The console is the default route and opens on the Match desk, whose
 * accordion auto-expands the newest fixture. That means a user with any match
 * lands directly in the expanded fixture body on startup; a ReferenceError
 * there whitescreens the app before anything else renders. Per-component tests
 * missed exactly that, because they only covered the empty state.
 *
 * These mount the real page against both shapes of user data.
 */
describe('Production page mounts', () => {
    it('on a fresh install (no matches, no OBS)', () => {
        ui();
        // 'Match' twice by design: the rack row and the stage panel header —
        // the console deliberately shows the selected thing on both surfaces.
        expect(screen.getAllByText('Match').length).toBeGreaterThan(0);
        expect(screen.getByText(/No matches yet/)).toBeInTheDocument();
    });

    it('with an existing fixture — the expanded desk a returning user lands on', () => {
        useStateStore.setState({
            match: {
                1: {
                    label: 'Winners Final', stage: 'live',
                    format: { bestOf: 3 }, series: { 1: 1, 2: 0 },
                },
            },
        });
        ui();
        expect(screen.queryByText(/No matches yet/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /start\.gg/ })).toBeInTheDocument();
    });

    it('with confirm mode armed and a change staged', () => {
        useSettingsStore.setState({ production: { confirm: { enabled: true } } });
        useStagingStore.setState({
            pending: { 'state:a': { key: 'state:a', label: 'Scorecard 1: Box Score', value: false, run: () => {} } },
            order: ['state:a'],
        });
        ui();
        expect(screen.getByText('1 staged change')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Go Live/ })).toBeInTheDocument();
    });

    it('in every phase, since the phase switch swaps what the stage shows', () => {
        useStateStore.setState({ match: { 1: { label: 'Semis', format: { bestOf: 3 } } } });
        const { rerender } = ui();
        for (const label of ['Live', 'Post-game', 'Break', 'Draft']) {
            const tab = screen.getByText(label);
            tab.click();
            rerender(<TooltipProvider><Production /></TooltipProvider>);
        }
        // Reaching here without a render throw is the assertion; the Bracket
        // desk row is present in every phase, so it proves the rack survived.
        expect(screen.getAllByText('Bracket').length).toBeGreaterThan(0);
    });
});

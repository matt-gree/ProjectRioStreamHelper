import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { useStagingStore } from '../../context/staging';
import Production from './production';
import { withContainers } from '../../test/containers';

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
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: withContainers() });
    useStateStore.setState({ match: {}, score: {}, postgame: {}, bracket: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useObsStore.setState({
        status: 'disconnected', studioMode: false, programScene: null,
        previewScene: null, sceneItems: {}, scenes: [], mirroredScenes: [],
    });
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
        expect(screen.getByRole('button', { name: /Load a set/ })).toBeInTheDocument();
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

    /*
     * Connected to OBS, with sources in more than one scene — the shape the
     * console is actually flown in, and the one the whole page has to survive
     * now that scenes are the grouping axis.
     */
    it('with OBS connected and overlays across two scenes', () => {
        useStateStore.setState({ match: { 1: { label: 'Semis', format: { bestOf: 3 } } } });
        const item = (id, sourceName, url, enabled) => ({
            id, sourceName, url, enabled,
            inputKind: 'browser_source', isGroup: false, isPrsh: true,
        });
        useObsStore.setState({
            status: 'connected', programScene: 'Game', scenes: ['Game', 'Break'],
            mirroredScenes: ['Game', 'Break'],
            sceneItems: {
                Game: [item(1, 'Scoreboard', 'http://x/layout/scoreboard1/scoreboard.html', true)],
                Break: [item(9, 'Lower Third', 'http://x/layout/lowerthird/lowerthird.html', false)],
            },
        });
        ui();
        expect(screen.getByText('PROGRAM · Game')).toBeInTheDocument();
        // Scoped to the rack — 'Break' is also an option in the top bar's
        // program-scene dropdown.
        expect(document.querySelector('[data-rack-section="Break"]')).toBeTruthy();
        // The desk tier is permanent, so it survives whatever the scenes do.
        expect(screen.getAllByText('Match').length).toBeGreaterThan(0);
    });

    // The phase selector is gone: OBS's scene list is the producer stating the
    // shape of their show, where phase was PRSH guessing at it.
    it('has no phase selector', () => {
        ui();
        for (const label of ['Draft', 'Post-game']) {
            expect(screen.queryByText(label), `${label} phase tab is gone`).not.toBeInTheDocument();
        }
    });
});

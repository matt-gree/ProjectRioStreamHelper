import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

/*
 * A router, because the console links out of itself — the connection pill
 * points an unconfigured producer at the Connections tab, and `<Link>` outside
 * a Router throws rather than degrading. The real app always mounts this inside
 * HashRouter (components/App.jsx), so the router is part of the launch path
 * this file exists to cover, not scaffolding for the assertions.
 */
const ui = () => render(
    <MemoryRouter><TooltipProvider><Production /></TooltipProvider></MemoryRouter>,
);

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


/*
 * THE BAND'S ERROR LINE CARRIES WHAT THE PILL CANNOT — the address, or the
 * rejection — and nothing else. The pill an inch to its left already says the
 * connection failed, and the line used to say it again at length; before that
 * it said the bare word "Error", which is String() of the empty-reason 1006
 * that OBS-not-running raises. The way to the fix is the PILL, which is a link
 * in every state — the readout is the way to its own settings.
 */
describe('the OBS error line', () => {
    const errored = (error) => {
        useSettingsStore.setState({ obs: { ever_connected: true } });
        useObsStore.setState({ status: 'error', error });
    };

    it('draws the address, with no second link beside it', () => {
        errored('Nothing listening at 127.0.0.1:4455.');
        ui();
        expect(screen.getByText('Nothing listening at 127.0.0.1:4455.')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Connections tab/ })).not.toBeInTheDocument();
    });

    it('makes the status readout itself the way to the Connections tab', () => {
        errored('Password rejected.');
        ui();
        expect(screen.getByRole('link', { name: /OBS connection error/ }))
            .toHaveAttribute('href', '/connections');
    });

    it('is a link when connected too — the address is changed from the same page', () => {
        useSettingsStore.setState({ obs: { ever_connected: true } });
        useObsStore.setState({ status: 'connected', error: null, obsVersion: '5.3.0' });
        ui();
        expect(screen.getByRole('link', { name: /OBS connected/ }))
            .toHaveAttribute('href', '/connections');
    });

    /*
     * A failure before the first success is not an error — it is a machine
     * nobody has set up, and that face carries its own verb and no message.
     */
    it('is silent before the first successful connection', () => {
        useSettingsStore.setState({ obs: { ever_connected: false } });
        useObsStore.setState({ status: 'error', error: 'Nothing listening at 127.0.0.1:4455.' });
        ui();
        expect(screen.queryByText(/Nothing listening/)).not.toBeInTheDocument();
        expect(screen.getByText('OBS not set up')).toBeInTheDocument();
    });
});

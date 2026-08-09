import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { SocketContext } from '../../context/socket';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { GamesSection } from './games';

/*
 * Games — the board's pool/playback surface, split by tempo.
 *
 * These tests are about the SPLIT, not about re-testing the filter fields that
 * came over from PoolBrowser unchanged: what stays on the panel (mode, cadence,
 * transport, counts), what only exists behind the dialog (the filter and the
 * game tables), and which writes are immediate vs staged.
 */

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
const ui = (node) => render(
    <SocketContext value={{ socket }}>
        <TooltipProvider>{node}</TooltipProvider>
    </SocketContext>,
);

// The section fetches rotation status and game modes on mount.
const jsonOk = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => {
        if (String(url).includes('/rotation/') && !String(url).includes('/pool')) {
            return jsonOk({ active: false });
        }
        return jsonOk({});
    }));
    useStagingStore.setState({ pending: {}, order: [] });
    useSettingsStore.setState({ production: {}, scoreboards: { active: [1], binding: {} } });
    useStateStore.setState({ score: {}, scoreboards: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const bind = (playback = {}, pool = {}) => useSettingsStore.setState({
    production: {},
    scoreboards: { active: [1], binding: { 1: { playback, pool } } },
});

const section = (props = {}) => (
    <GamesSection
        sb={1} transport="api" readout="One game — nothing in its pool yet."
        badge={null} poolCount={0} gameModes={[]} {...props}
    />
);

describe('GamesSection', () => {
    it('states the readout and offers the playback choice', () => {
        ui(section());
        expect(screen.getByText(/One game — nothing in its pool yet/)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'One game' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Rotating' })).toBeInTheDocument();
    });

    /*
     * A HUD board's game is whatever Project Rio is playing: no pool, no playback
     * choice, no way in. The readout is the whole surface, because every control
     * below it would have nothing to act on (server/bindings.py derives this).
     */
    it('draws nothing but the readout on a HUD board', () => {
        ui(section({ transport: 'hud', readout: 'One game — the local HUD feed.' }));
        expect(screen.getByText(/the local HUD feed/)).toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: 'Rotating' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Find a game/ })).not.toBeInTheDocument();
    });

    /*
     * Mode is server-backed, so the click has to wait for the settings PUT to echo
     * back. Echoing it locally is what stops the segmented reading as locked while
     * the server is off fetching games.
     */
    it('moves the mode control on click, before the server echoes it back', () => {
        ui(section());
        fireEvent.click(screen.getByRole('radio', { name: 'Rotating' }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/scoreboards/1/binding?kind=rotate', { method: 'PUT' });
        // The rotating rows appear now, not on the round-trip.
        expect(screen.getByLabelText('Each game')).toBeInTheDocument();
    });

    it('shows the cadence and transport only while rotating', () => {
        ui(section());
        expect(screen.queryByLabelText('Each game')).not.toBeInTheDocument();
        cleanup();
        bind({ mode: 'rotate', interval: 45 });
        ui(section());
        expect(screen.getByLabelText('Each game')).toHaveValue(45);
        expect(screen.getByRole('button', { name: /Rotate/ })).toBeInTheDocument();
    });

    // The re-check cadence is only a number when the toggle is on — an interval
    // field beside an off switch is a setting that does nothing.
    it('reveals the re-check interval only when keeping the pool current', () => {
        bind({ mode: 'rotate' }, { refresh_interval: 0 });
        ui(section());
        expect(screen.queryByLabelText('Re-check')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('switch'));
        expect(fetch).toHaveBeenCalledWith('/api/v1/rotation/1/pool', expect.objectContaining({
            method: 'PUT', body: JSON.stringify({ refresh_interval: 60 }),
        }));
    });

    it('counts the pool, and says none rather than zero', () => {
        bind({ mode: 'rotate' }, { excluded: [7, 8] });
        ui(section({ poolCount: 0 }));
        expect(screen.getByText('none')).toBeInTheDocument();
        expect(screen.getByText('· 2 off')).toBeInTheDocument();
    });

    /*
     * Transport is momentary — the same rule as Take and post-game capture. A
     * producer pressing Rotate means now, not on the next confirm, so it must not
     * route through the staging gateway even with confirm mode on.
     */
    it('starts rotating immediately, even in confirm mode', async () => {
        useSettingsStore.setState({
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], binding: { 1: { playback: { mode: 'rotate' } } } },
        });
        ui(section());
        fireEvent.click(screen.getByRole('button', { name: /Rotate/ }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/rotation/1/start', { method: 'POST' }));
        expect(useStagingStore.getState().order).toEqual([]);
    });

    /*
     * THE TEMPO SPLIT. The filter is three chip fields, a date range and a limit,
     * and the results are a scrolling table — a browsing task, so it is one click
     * away rather than always open on a 278px-adjacent panel. What is on the panel
     * is what a producer watches during a show.
     */
    it('keeps the filter and the game table behind the dialog', () => {
        bind({ mode: 'rotate' });
        ui(section());
        // ParticipantPicker's placeholder is the trigger's own label, not an
        // input placeholder — it is a combobox button.
        expect(screen.queryByRole('button', { name: 'Filter by player' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Edit the pool…' }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filter by player' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Game modes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Find games/ })).toBeInTheDocument();
    });

    it('names the dialog for the job the board is doing', () => {
        ui(section());
        fireEvent.click(screen.getByRole('button', { name: 'Find a game…' }));
        expect(screen.getByRole('heading', { name: 'Find a game' })).toBeInTheDocument();
    });

    /*
     * Putting a game on the board is the one thing in the dialog that reaches air,
     * so it stages. Everything else there is a read (search, refresh) or pool prep
     * (the filter, an exclusion), which is why the rest writes straight through.
     */
    it('stages the game it puts on the board', async () => {
        useSettingsStore.setState({
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], binding: {} },
            ongoing_games: { poll_interval: 10 },
        });
        vi.stubGlobal('fetch', vi.fn((url) => {
            if (String(url).includes('/game-pool/ongoing') && !String(url).includes('refresh')) {
                return jsonOk([{ game_id: 42, away_user: 'Alice', home_user: 'Bob', away_score: 3, home_score: 2 }]);
            }
            if (String(url).includes('/rotation/1')) return jsonOk({ active: false });
            return jsonOk({});
        }));
        ui(section());
        fireEvent.click(screen.getByRole('button', { name: 'Find a game…' }));
        const put = await screen.findByRole('button', { name: 'Put on board' });
        fireEvent.click(put);

        const { order, pending } = useStagingStore.getState();
        expect(order).toEqual(['board:1:game']);
        expect(pending['board:1:game'].label).toBe('Board 1: load Alice vs Bob');
        // Staged, so nothing was assigned yet.
        expect(fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/game-pool/assign'), expect.anything(),
        );
    });
});

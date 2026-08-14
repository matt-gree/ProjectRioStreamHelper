import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { SocketContext } from '../../context/socket';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { GamesSection } from './games';

/*
 * Games — the board's pool/playback surface.
 *
 * These tests are about WHAT IS ON THE PANEL. The mode is the subject and each
 * half brings its own surface: the live game list you pick from, or the filter,
 * the timing and the transport with the status line that says why a pool is
 * empty. Only the rotating pool's MEMBER LIST is behind a dialog, and only
 * because it is a long table you visit to prune.
 *
 * An intermediate version hid the single-game list behind "Find a game…" and put
 * the pool status inside that dialog; several of these tests exist to keep that
 * from coming back.
 */

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
const ui = (node) => render(
    <SocketContext value={{ socket }}>
        <TooltipProvider>{node}</TooltipProvider>
    </SocketContext>,
);

// The section fetches rotation status on mount; the finder fetches live games.
const jsonOk = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

const stubFetch = (games = []) => vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url);
    if (u.includes('/game-pool/ongoing') && !u.includes('refresh')) return jsonOk(games);
    if (u.includes('/rotation/') && !u.includes('/pool')) return jsonOk({ active: false });
    return jsonOk({});
}));

beforeEach(() => {
    stubFetch();
    useStagingStore.setState({ pending: {}, order: [] });
    useSettingsStore.setState({
        production: {}, ongoing_games: { poll_interval: 10 },
        scoreboards: { active: [1], binding: {} },
    });
    useStateStore.setState({ score: {}, scoreboards: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const bind = (playback = {}, pool = {}) => useSettingsStore.setState({
    production: {}, ongoing_games: { poll_interval: 10 },
    scoreboards: { active: [1], binding: { 1: { playback, pool } } },
});

const section = (props = {}) => (
    <GamesSection sb={1} transport="api" gameModes={[]} {...props} />
);

describe('GamesSection', () => {
    it('offers the playback choice as its subject', () => {
        ui(section());
        expect(screen.getByRole('radio', { name: 'One game' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Rotating' })).toBeInTheDocument();
    });

    /*
     * A HUD board's game is whatever Project Rio is playing: no pool, no playback
     * choice, no way in. The region collapses to its header, which the board desk
     * draws (the transport badge and the playback sentence — desks.test.jsx pins
     * that); everything here would be a control with nothing to act on
     * (server/bindings.py derives this).
     */
    it('draws nothing at all on a HUD board', () => {
        const { container } = ui(section({ transport: 'hud' }));
        expect(container).toBeEmptyDOMElement();
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
        // The rotating surface appears now, not on the round-trip.
        expect(screen.getByLabelText('Seconds per game')).toBeInTheDocument();
    });
});

/*
 * ONE GAME — the finder is inline. Picking the game a single-playback board shows
 * is the most frequent thing done to an API board, and the Live tab is a handful
 * of rows of what is being played right now.
 */
describe('One game', () => {
    it('lists the live games on the panel, with no dialog to open', async () => {
        stubFetch([{ game_id: 42, away_user: 'Alice', home_user: 'Bob', away_score: 3, home_score: 2 }]);
        ui(section());
        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Put on board' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Find a game/ })).not.toBeInTheDocument();
    });

    /*
     * NOTHING HERE FETCHES ON A TIMER. Both tabs used to re-query the Rio API on
     * the ongoing-poll cadence while visible, with a "Refreshing in 4s" countdown
     * beside the list — a repeating fetch under a producer who had only selected a
     * board desk, and a countdown that implied the loaded game's score came from
     * this list. It doesn't: a board following a live game is re-applied
     * server-side (OngoingGamePool._reapply_single_live), and the only automatic
     * fetching left is the one a producer asks for — a rotating pool's "Keep pool
     * current". One fetch when the picker opens, then only the button.
     */
    it('fetches once when it opens and never on a timer', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            stubFetch([{ game_id: 42, away_user: 'Alice', home_user: 'Bob', away_score: 3, home_score: 2 }]);
            ui(section());
            await screen.findByText('Alice');
            const ongoingCalls = () => fetch.mock.calls
                .filter(([u]) => String(u).includes('/game-pool/ongoing')).length;
            const opened = ongoingCalls();
            expect(opened).toBeGreaterThan(0);
            // Well past the 10s poll_interval the countdown used to run on.
            await vi.advanceTimersByTimeAsync(45_000);
            expect(ongoingCalls()).toBe(opened);
            expect(screen.queryByText(/Refreshing in/)).not.toBeInTheDocument();
            // The producer's own refresh still works.
            fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
            await waitFor(() => expect(ongoingCalls()).toBeGreaterThan(opened));
        } finally {
            vi.useRealTimers();
        }
    });

    /*
     * The completed filter — three chip fields, a limit and an opt-in date range —
     * is the one part of this surface that is a sit-down task, and the tab is what
     * keeps it off a glance surface: nothing appears until a producer asks for it.
     */
    it('keeps the completed filter on its own tab', () => {
        ui(section());
        // ParticipantPicker's placeholder is the trigger's own label, not an
        // input placeholder — it is a combobox button.
        expect(screen.queryByRole('button', { name: 'Filter by player' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Completed' }));
        expect(screen.getByRole('button', { name: 'Filter by player' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Game modes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Find games/ })).toBeInTheDocument();
    });

    /*
     * Putting a game on the board is the one act on this surface that reaches air,
     * so it stages. Everything else is a read (search, refresh) or pool prep (the
     * filter, an exclusion), which is why the rest writes straight through.
     */
    it('stages the game it puts on the board', async () => {
        useSettingsStore.setState({
            production: { confirm: { enabled: true } },
            ongoing_games: { poll_interval: 10 },
            scoreboards: { active: [1], binding: {} },
        });
        stubFetch([{ game_id: 42, away_user: 'Alice', home_user: 'Bob', away_score: 3, home_score: 2 }]);
        ui(section());
        fireEvent.click(await screen.findByRole('button', { name: 'Put on board' }));

        const { order, pending } = useStagingStore.getState();
        expect(order).toEqual(['board:1:game']);
        expect(pending['board:1:game'].label).toBe('Board 1: load Alice vs Bob');
        // Staged, so nothing was assigned yet.
        expect(fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/game-pool/assign'), expect.anything(),
        );
    });
});

/*
 * THE MODE FILTER IS A SEARCH, NOT A SETTING.
 *
 * A pool of completed games is mostly seasons that have ended, so an active-only
 * list of modes could not offer the one a producer is most likely to want. The
 * catalogue arrives in two tiers (../gamemodes) — active first, ended under
 * their own heading — and the field takes typed text on top of that, because the
 * value goes to Project Rio as a `tag` search param and a mode the catalogue
 * hasn't caught up with must still be searchable.
 */
describe('Game-mode filter', () => {
    const tiered = [
        { value: 'S14 Superstars Off', label: 'S14 Superstars Off', group: 'Active' },
        { value: 'S13 Superstars Off', label: 'S13 Superstars Off', group: 'Ended' },
    ];

    it('offers ended seasons under the active ones', () => {
        bind({ mode: 'rotate' });
        ui(section({ gameModes: tiered }));
        fireEvent.click(screen.getByRole('button', { name: 'Game modes' }));
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Ended')).toBeInTheDocument();
        const options = screen.getAllByRole('option').map(o => o.textContent);
        expect(options).toEqual(['S14 Superstars Off', 'S13 Superstars Off']);
    });

    it('takes a mode neither list names', () => {
        bind({ mode: 'rotate' });
        ui(section({ gameModes: tiered }));
        fireEvent.click(screen.getByRole('button', { name: 'Game modes' }));
        fireEvent.change(screen.getByPlaceholderText('Search or type a mode…'), {
            target: { value: 'Pooper League S2' },
        });
        fireEvent.click(screen.getByText('Use "Pooper League S2"'));
        expect(fetch).toHaveBeenCalledWith('/api/v1/rotation/1/pool', expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('Pooper League S2'),
        }));
    });
});

describe('Rotating', () => {
    it('puts the scope, the filter and the timing on the panel', () => {
        bind({ mode: 'rotate', interval: 45 });
        ui(section());
        expect(screen.getByRole('radio', { name: 'Live + Completed' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filter by player' })).toBeInTheDocument();
        expect(screen.getByLabelText('Seconds per game')).toHaveValue(45);
        expect(screen.getByRole('button', { name: 'Start rotating' })).toBeInTheDocument();
    });

    /*
     * The re-check interval stays VISIBLE and disabled rather than appearing and
     * disappearing under the switch — a control that vanishes moves everything
     * below it, and the number is worth reading while off ("it would re-check
     * every 60s if I turned this on").
     */
    it('keeps the re-check interval visible while the toggle is off', () => {
        bind({ mode: 'rotate' }, { refresh_interval: 0 });
        ui(section());
        expect(screen.getByLabelText('Re-check interval')).toBeDisabled();
        fireEvent.click(screen.getByRole('switch', { name: 'Keep pool current' }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/rotation/1/pool', expect.objectContaining({
            method: 'PUT', body: JSON.stringify({ refresh_interval: 60 }),
        }));
    });

    /*
     * THE STATUS LINE IS THE REASON THIS BLOCK IS ON THE PANEL. The board's own
     * readout says the pool is empty; only this says why — no filter yet, filters
     * edited since the last Find, or an unreachable API.
     */
    it('says why the pool is empty, on the panel', () => {
        bind({ mode: 'rotate' });
        ui(section());
        expect(screen.getByText(/Add a game mode, player, or opponent/)).toBeInTheDocument();
    });

    it('warns that the pool is stale once the filter changes', async () => {
        bind({ mode: 'rotate' }, { scope: 'both' });
        ui(section());
        fireEvent.click(screen.getByRole('radio', { name: 'Live Only' }));
        expect(await screen.findByText(/Filters changed — Find games to refresh the pool/))
            .toBeInTheDocument();
    });

    /*
     * Transport is momentary — the same rule as Take and post-game capture. A
     * producer pressing Start means now, not on the next confirm, so it must not
     * route through the staging gateway even with confirm mode on.
     */
    it('starts rotating immediately, even in confirm mode', async () => {
        useSettingsStore.setState({
            production: { confirm: { enabled: true } },
            ongoing_games: { poll_interval: 10 },
            scoreboards: { active: [1], binding: { 1: { playback: { mode: 'rotate' } } } },
        });
        ui(section());
        fireEvent.click(screen.getByRole('button', { name: 'Start rotating' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/rotation/1/start', { method: 'POST' }));
        expect(useStagingStore.getState().order).toEqual([]);
    });

    // The member table is the one dialog: a long list you visit to prune, not to
    // watch. Its counts ride on the button that opens it.
    it('opens the member list, and counts it on the button', async () => {
        bind({ mode: 'rotate' }, { excluded: [7, 8] });
        useStateStore.setState({
            score: {},
            scoreboards: {
                rotation: {
                    1: {
                        game_ids: [11],
                        cached_games: [{ game_id: 11, away_user: 'Carol', home_user: 'Dave' }],
                    },
                },
            },
        });
        ui(section());
        const open = screen.getByRole('button', { name: /Pool games/ });
        expect(open).toHaveTextContent('1 · 2 off');
        fireEvent.click(open);
        expect(await screen.findByRole('heading', { name: 'Pool games' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Exclude/ })).toBeInTheDocument();
    });

    /*
     * Opening the member list refreshes it — but nothing here fires a Rio API
     * search on mount. Selecting a board desk must not cost a search.
     */
    it('does not search on mount, only when the member list is opened', async () => {
        bind({ mode: 'rotate' });
        ui(section());
        const previews = () => fetch.mock.calls.filter(c => String(c[0]).includes('/preview'));
        expect(previews()).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: /Pool games/ }));
        await waitFor(() => expect(previews()).toHaveLength(1));
    });
});

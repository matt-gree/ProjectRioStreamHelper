import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { SocketContext } from '../../context/socket';
import { useStagingStore } from '../../context/staging';
import MatchDesk from './desks/match';
import CaptureDesk from './desks/capture';
import BracketDesk from './desks/bracket';
import BoardDesk, { matchBindLine, sideReasonLine } from './desks/board';

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

/*
 * The board desk subscribes to the server's pushed stats-fetch status
 * (v1.stats.fetch_status) rather than polling for it, so it needs a socket in
 * context. A double is enough — nothing here asserts on the wire.
 */
const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
const ui = (node) => render(
    <SocketContext value={{ socket }}>
        <TooltipProvider>{node}</TooltipProvider>
    </SocketContext>,
);

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
        // The Fixture column's start.gg control — the icon that was undefined.
        expect(screen.getByRole('button', { name: /Load a set/ })).toBeInTheDocument();
    });

    /*
     * A rotating board has no fixed sides to project a fixture onto, so the
     * server rejects the bind with a 409. The chip must look unavailable
     * instead of letting the producer click into that error — and the rule the
     * UI mirrors is the server's exact one: board 1 under the HUD toggle is
     * single by construction whatever its stored playback mode says.
     */
    it('makes a rotating board unpickable rather than erroring on click', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            scoreboards: {
                active: [1, 2],
                binding: { 2: { playback: { mode: 'rotate' } } },
            },
        });
        useStateStore.setState({ score: {}, match: { 1: { stage: 'draft', format: { bestOf: 1 } } } });
        ui(<MatchDesk />);
        expect(screen.getByRole('radio', { name: /Board 1/ })).not.toHaveAttribute('aria-disabled');
        expect(screen.getByRole('radio', { name: /Board 2/ })).toHaveAttribute('aria-disabled', 'true');
    });

    it('keeps the HUD board pickable even with a stale rotate mode stored', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            scoreboards: {
                active: [1],
                binding: { 1: { playback: { mode: 'rotate' } } },
            },
        });
        useStateStore.setState({ score: {}, match: { 1: { stage: 'draft', format: { bestOf: 1 } } } });
        ui(<MatchDesk />);
        expect(screen.getByRole('radio', { name: /Board 1/ })).not.toHaveAttribute('aria-disabled');
    });
});

/*
 * The board desk is the console's answer to "what is this board carrying, why
 * does it look like that, and how do I fix it". The middle question is the one
 * nothing could answer before: the server runs the whole manual > match > pin >
 * back_to_back cascade and mirrors the deciding layer to score.{N}.side_reason
 * so a surface can SAY it, and until this desk the only frontend reference to
 * that key was the reset that cleared it.
 */
describe('Board desk', () => {
    beforeEach(() => {
        useStagingStore.setState({ pending: {}, order: [] });
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({ score: {}, match: {} });
    });

    it('states the live game, the bound match, and why the sides are that way', () => {
        useStateStore.setState({
            score: {
                1: {
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                    score_left: 3, score_right: 2, inning: 5, half_inning: 'Top',
                    match: 2, side_reason: 'pin',
                },
            },
            match: { 2: { label: 'Winners R2', series: { 1: 1, 2: 0 } } },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('Alice 3–2 Bob')).toBeInTheDocument();
        expect(screen.getByText('Match 2 · Winners R2 · 1–0')).toBeInTheDocument();
        expect(screen.getByText('Alice on the left — pinned in Settings')).toBeInTheDocument();
    });

    it('has a sentence for every layer of the cascade, and none for raw feed order', () => {
        expect(sideReasonLine('manual', 'Alice')).toBe('Alice on the left — set by hand for this game');
        expect(sideReasonLine('match', 'Alice')).toBe('Alice on the left — from the bound match');
        expect(sideReasonLine('pin', 'Alice')).toBe('Alice on the left — pinned in Settings');
        expect(sideReasonLine('back_to_back', 'Alice')).toBe('Alice on the left — where they were last game');
        // Raw feed order is not a decision, so there is nothing to explain.
        expect(sideReasonLine('', 'Alice')).toBeNull();
        expect(sideReasonLine(undefined, 'Alice')).toBeNull();
        // An unbound board says nothing about a match rather than "Match null".
        expect(matchBindLine(null, null)).toBeNull();
    });

    /*
     * The lineup is what the deleted roster EDITOR was actually used for — a
     * producer checking the board against the game — so it came back as a
     * readout. Nothing here is clickable; the captain is the one cell that reads
     * differently, because that is the fact the panel is asked for.
     */
    it('shows each side’s lineup and marks the captain', () => {
        const chars = (names) => Object.fromEntries(
            names.map((name, i) => [i, { name, is_starred: i === 2 }]),
        );
        useStateStore.setState({
            score: {
                1: {
                    player: {
                        1: {
                            rioName: 'rjb', msb_team: 'Bowser Blue Shells', rio_captainIndex: 1,
                            character: chars(['Dry Bones(G)', 'Bowser', 'Bro(F)']),
                        },
                        2: {
                            rioName: 'MattGree', msb_team: 'Birdo Bows', rio_captainIndex: 0,
                            character: chars(['Toad(P)', 'DK']),
                        },
                    },
                },
            },
            match: {},
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('Bowser Blue Shells')).toBeInTheDocument();
        expect(screen.getByText('Birdo Bows')).toBeInTheDocument();
        expect(screen.getByText('Dry Bones(G)')).toBeInTheDocument();
        expect(screen.getByText('Toad(P)')).toBeInTheDocument();
        // Captain and superstar are stated on the cell, not spelled out in a row.
        expect(screen.getByTitle('Bowser · captain')).toBeInTheDocument();
        expect(screen.getByTitle('Bro(F) · superstar')).toBeInTheDocument();
    });

    // Nine "Slot n" placeholders on a board with no game is nine rows of
    // nothing, so the grid collapses instead of reserving space for a lineup
    // the feed has not sent.
    it('draws no lineup at all until the feed has sent characters', () => {
        useStateStore.setState({ score: { 1: { player: {} } }, match: {} });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByText('—')).not.toBeInTheDocument();
    });

    /*
     * Home is a per-side chip, not a Left/Right picker: it is a choice between
     * two sides, so the side that has it cannot be clicked off — only the other
     * side can take it.
     */
    it('moves home to the other side, and will not turn it off', () => {
        useStateStore.setState({ score: { 1: { home_team: 2, player: {} } }, match: {} });
        ui(<BoardDesk board={1} />);
        const left = screen.getByRole('button', { name: 'Left side bats last' });
        const right = screen.getByRole('button', { name: 'Right side bats last' });
        expect(right).toHaveAttribute('aria-pressed', 'true');
        expect(left).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(left);
        expect(useStateStore.getState().score[1].home_team).toBe(1);
    });

    it('ignores a click on the side that is already home', () => {
        useStateStore.setState({ score: { 1: { home_team: 2, player: {} } }, match: {} });
        ui(<BoardDesk board={1} />);
        fireEvent.click(screen.getByRole('button', { name: 'Right side bats last' }));
        expect(useStagingStore.getState().order).toEqual([]);
        expect(useStateStore.getState().score[1].home_team).toBe(2);
    });

    it('warns when the live players do not match the bound fixture', () => {
        useStateStore.setState({
            score: { 1: { match: 2, match_conflict: true, player: {} } },
            match: { 2: {} },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText(/don’t match the bound fixture/)).toBeInTheDocument();
    });

    /*
     * Transport is DERIVED — board 1 carries the HUD iff the global toggle is on
     * — so it is a readout with no picker, and the HUD-only recovery (re-read the
     * file) appears with it.
     */
    it('reads transport out rather than offering it, and offers the HUD re-read', () => {
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('HUD')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Re-read HUD file/ })).toBeInTheDocument();
    });

    it('is an API board with no re-read once the HUD is off', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('API')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Re-read HUD/ })).not.toBeInTheDocument();
        expect(screen.getByText(/Set on the Match tab/)).toBeInTheDocument();
    });

    // Corrections are broadcast-visible, so they go through the staging gateway;
    // with confirm mode on nothing reaches State until Go Live.
    it('stages a correction instead of writing it live in confirm mode', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({ score: { 1: { score_left: 1, score_right: 0, player: {} } }, match: {} });
        ui(<BoardDesk board={1} />);
        fireEvent.change(screen.getByLabelText('Score, left side'), { target: { value: '4' } });
        expect(useStagingStore.getState().pending['board:1:score_left']?.value).toBe(4);
        expect(useStateStore.getState().score[1].score_left).toBe(1);
    });

    // Momentary by contract: re-reading the HUD file is a recovery action, like
    // Take and capture, and must not wait behind a confirm.
    it('re-reads the HUD file immediately, staging or not', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={1} />);
        fireEvent.click(screen.getByRole('button', { name: /Re-read HUD file/ }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/rio/refresh', { method: 'POST' });
        expect(useStagingStore.getState().order).toEqual([]);
    });

    // The rig always keeps one board, so the last one's Remove is unavailable
    // rather than an error the producer has to discover.
    it('will not remove the last board', () => {
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: /Remove board/ })).toBeDisabled();
    });

    it('removes a board once the rig has more than one', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1, 2], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={2} />);
        expect(screen.getByRole('button', { name: /Remove board/ })).not.toBeDisabled();
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

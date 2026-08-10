import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { SocketContext } from '../../context/socket';
import { useStagingStore } from '../../context/staging';
import MatchDesk from './desks/match';
import CaptureDesk from './desks/capture';
import BracketDesk from './desks/bracket';
import BoardDesk, { matchBindLine, playbackLine, sideReasonLine } from './desks/board';

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

    /*
     * The four verbs the Match tab's panel had and the desk didn't. Retire is not
     * among them: it looped every bound board unbinding each, and a match can only
     * hold one board now, so it IS the bound chip — see the binding test below.
     */
    const oneMatch = (over = {}) => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: { active: [1], binding: {} },
        });
        useStateStore.setState({
            score: {},
            match: { 1: { stage: 'live', format: { bestOf: 3 }, series: { 1: 0, 2: 0 }, ...over } },
        });
    };

    it('flips the fixture sides, and says so rather than showing a bare icon', () => {
        oneMatch();
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: 'Flip sides on match 1' }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/match/1/flip', expect.objectContaining({ method: 'POST' }));
    });

    /*
     * `decided` (the record) and "someone is at the win count" (arithmetic on the
     * series) are different facts, and the verb offered depends on which you have.
     * They used to be one function, so the header badged "Side N wins" off either —
     * claiming a series the server had not recorded, and offering nothing to fix
     * it.
     */
    it('offers Decide when the series is at the number but nothing recorded it', () => {
        oneMatch({ series: { 1: 2, 2: 0 } });
        ui(<MatchDesk />);
        expect(screen.queryByText('Side 1 wins')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Decide: Side 1' }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/match/1/decide', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ side: 1 }),
        }));
    });

    it('badges a decided series and offers Reopen instead', () => {
        oneMatch({ series: { 1: 2, 2: 0 }, decided: 1 });
        ui(<MatchDesk />);
        expect(screen.getByText('Side 1 wins')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Decide/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/match/1/decide', expect.objectContaining({
            method: 'POST', body: JSON.stringify({ side: null }),
        }));
    });

    // A series a producer has corrected back below the number is neither decided
    // nor clinched — no verb, because there is nothing to record or undo.
    it('offers no series verb on a match nobody has won', () => {
        oneMatch();
        ui(<MatchDesk />);
        expect(screen.queryByRole('button', { name: /Decide/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
    });

    /*
     * MOVING A MATCH IS ONE ACTION, hence one staged entry. This used to fire a
     * separate `bind:{other}` unbind per sibling board before the bind, so with
     * confirm mode on the producer got two chips and could discard either one —
     * commit the bind without the unbind and the match sits on two boards, which
     * is two boards claiming one game and a state nothing can draw. The steal is
     * `bind_board`'s on the server now (server/api/v1/match.py).
     */
    it('moves a bound match with one staged change, not a bind plus an unbind', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1, 2], binding: {} },
        });
        useStateStore.setState({
            score: { 1: { match: 1 } },
            match: { 1: { stage: 'draft', format: { bestOf: 1 } } },
        });
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('radio', { name: /Board 2/ }));

        const { order, pending } = useStagingStore.getState();
        expect(order).toEqual(['bind:2']);
        expect(pending['bind:2'].value).toBe(1);
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

    /*
     * The superstar mark is drawn on EVERY filled slot, hollow when off. Nine
     * hollow stars say "star skills are on and nobody is starred yet"; a cell
     * with no mark at all says nothing, which is what made the first version of
     * this grid look like the indicator had been dropped.
     */
    it('marks every character’s superstar state, not only the starred ones', () => {
        useStateStore.setState({
            score: {
                1: {
                    player: {
                        1: {
                            character: {
                                0: { name: 'Bowser' },
                                1: { name: 'Boo', is_starred: true },
                                2: { name: 'Yoshi' },
                            },
                        },
                        2: {},
                    },
                },
            },
            match: {},
        });
        const { container } = ui(<BoardDesk board={1} />);
        // Three characters, three marks — one lit, two hollow. The empty slots
        // get none: a star on nothing is noise.
        expect(container.querySelectorAll('[data-star]')).toHaveLength(3);
        expect(container.querySelectorAll('[data-star="off"]')).toHaveLength(2);
        // The lit one prefers the game's own superstar art.
        expect(screen.getAllByAltText('Superstar')).toHaveLength(1);
    });

    /*
     * PRSH ships no MSB images, so every icon is a user-supplied file that may
     * be absent — and an image tag pointed at a file that isn't there is a
     * torn-page box that breaks the grid and reads as a bug. The lit star falls
     * back to a filled vector that says the same thing.
     */
    it('still shows a lit star when superstar.png is missing from the pack', () => {
        useStateStore.setState({
            score: { 1: { player: { 1: { character: { 0: { name: 'Boo', is_starred: true } } }, 2: {} } } },
            match: {},
        });
        const { container } = ui(<BoardDesk board={1} />);
        fireEvent.error(screen.getByAltText('Superstar'));
        expect(screen.queryByAltText('Superstar')).not.toBeInTheDocument();
        expect(container.querySelector('svg[data-star="on"]')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Superstar' })).toBeInTheDocument();
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

    /*
     * Transport and playback are two axes, not one three-way choice. The badge
     * says where games come from (derived); the sentence says how this board
     * shows them (chosen). Flattening them the way the Match tab did makes
     * "HUD + rotate" expressible when it is not a real state — board 1 under the
     * HUD toggle is single by construction whatever its stored mode says.
     */
    it('states playback separately from transport, and never HUD + rotating', () => {
        expect(playbackLine({ transport: 'hud', mode: 'rotate', poolCount: 6 }))
            .toBe('One game — the local HUD feed.');
        expect(playbackLine({ transport: 'api', mode: 'rotate', running: true, poolCount: 6 }))
            .toBe('Rotating — 6 in pool.');
        expect(playbackLine({ transport: 'api', mode: 'rotate', running: false, poolCount: 6 }))
            .toBe('Rotating (paused) — 6 in pool.');
        expect(playbackLine({ transport: 'api', mode: 'single', gameId: 'g7' }))
            .toBe('One game, pinned.');
        expect(playbackLine({ transport: 'api', mode: 'single', poolCount: 4 }))
            .toBe('One game — following the newest of 4 in pool.');
        expect(playbackLine({ transport: 'api', mode: 'single', poolCount: 0 }))
            .toBe('One game — nothing in its pool yet.');
        // Rotation on with an empty pool is a real state (nothing has matched the
        // filters yet); "0 in pool" reads like a count that failed.
        expect(playbackLine({ transport: 'api', mode: 'rotate', running: true, poolCount: 0 }))
            .toBe('Rotating — nothing in its pool yet.');
    });

    it('reads a rotating board’s playback out on the panel, not just the rack row', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: {
                active: [1],
                aliases: {},
                binding: { 1: { playback: { mode: 'rotate', running: true } } },
            },
        });
        useStateStore.setState({
            score: { 1: { player: {} } },
            scoreboards: { rotation: { 1: { game_ids: [11, 12, 13] } } },
            match: {},
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText(/Rotating — 3 in pool\./)).toBeInTheDocument();
    });

    /*
     * The two axes on one row: the DERIVED transport as a badge, the CHOSEN
     * playback as a control. An API board also gets the playback picker and the
     * way into its games — which used to be a sentence pointing at another tab.
     */
    it('is an API board with no re-read once the HUD is off', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('API')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Re-read HUD/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/Match tab/)).not.toBeInTheDocument();
        // The playback choice, and the live game list it opens onto — both on the
        // panel, not behind a button (see games.test.jsx).
        expect(screen.getByRole('radio', { name: 'One game' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Live' })).toBeInTheDocument();
    });

    // A HUD board's game is whatever Project Rio is playing, so it has no pool
    // and no playback choice — controls with nothing to act on.
    it('offers no playback controls on a HUD board', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('HUD')).toBeInTheDocument();
        expect(screen.getByText(/Disable HUD in Settings to rebind/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Find a game/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: 'Rotating' })).not.toBeInTheDocument();
    });

    /*
     * The two axes ride the GAMES header rule, not a row of their own — one line
     * of state beside the eyebrow that names it. A HUD board's whole Games region
     * IS that header (GamesSection renders nothing), which is why the badge and
     * the sentence have to live on the desk rather than inside it.
     */
    it('states the transport and the playback on the Games header rule', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: {
                active: [1], aliases: {},
                binding: { 1: { playback: { mode: 'rotate', running: true } } },
            },
        });
        useStateStore.setState({
            score: { 1: { player: {} } },
            scoreboards: { rotation: { 1: { game_ids: [11, 12] } } },
            match: {},
        });
        ui(<BoardDesk board={1} />);
        const header = screen.getByText('Games').parentElement;
        expect(header).toHaveTextContent('API');
        expect(header).toHaveTextContent('Rotating — 2 in pool.');
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

    /*
     * The panel owns the board's PROPERTIES; whether the board exists is rig
     * membership, which lives in the rack's BOARDS section next to the + that
     * creates one (rack.test.jsx covers it). Remove was here, four scrolls down
     * inside the row it deletes, and could not be found.
     */
    it('renames the board but does not offer to remove it', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1, 2], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={2} />);
        expect(screen.getByLabelText('Name')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
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

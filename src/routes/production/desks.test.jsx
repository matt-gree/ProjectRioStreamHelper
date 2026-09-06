import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { SocketContext } from '../../context/socket';
import { useStagingStore } from '../../context/staging';
import MatchDesk from './desks/match';
import BoardDesk, { boardTypeTag, playbackLine, sideReasonPhrase } from './desks/board';
import { boardLifecycle } from './boards';

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
    /*
     * WHERE A FIXTURE ENTERS AN ORDER is the order's own heading, the rack's
     * section-header idiom. A desk-level New match can only mean the first order,
     * so on a winners/losers rig every fixture arrived in Winners and had to be
     * moved with the membership icon inside its own body — the producer knew
     * which order they wanted before they clicked, and the UI had nowhere to say
     * it.
     */
    const twoOrders = () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: { active: [1], binding: {} },
        });
        useStateStore.setState({
            score: {},
            match: { 1: { stage: 'draft', format: { bestOf: 1 } } },
            schedule: {
                queues: [
                    { id: 'winners', title: 'Winners', matches: [1] },
                    { id: 'losers', title: 'Losers', matches: [] },
                ],
            },
        });
    };

    /*
     * THE ORDERS OUTLIVE THE FIXTURES IN THEM. "No matches yet" was an early
     * branch returning a sentence and a button INSTEAD of the desk, so an empty
     * rig collapsed both running orders: nothing to create into, rename, reorder
     * or delete, no New running order, and nothing saying they still existed.
     * Emptiness belongs to the list of fixtures, not to the desk's structure.
     */
    it('keeps the running orders when there are no matches at all', () => {
        twoOrders();
        useStateStore.setState({
            score: {},
            match: {},
            schedule: {
                queues: [
                    { id: 'winners', title: 'Winners', matches: [] },
                    { id: 'losers', title: 'Losers', matches: [] },
                ],
            },
        });
        ui(<MatchDesk />);
        expect(screen.getByText(/No matches yet/)).toBeInTheDocument();
        expect(screen.getByLabelText('Title of the winners running order')).toBeInTheDocument();
        expect(screen.getByLabelText('Title of the losers running order')).toBeInTheDocument();
        // Each order can still be created into, and a third can still be added.
        expect(screen.getByRole('button', { name: 'New match in the Losers running order' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: /New running order/ })).toBeInTheDocument();
    });

    it('creates a fixture into the running order whose heading was clicked', () => {
        twoOrders();
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: 'New match in the Losers running order' }));
        expect(fetch).toHaveBeenCalledWith(
            '/api/v1/match?queue=losers',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    // …and with several orders there is no order-less New match to fall into the
    // first one by default. The headings carry it.
    it('drops the ambiguous desk-level New match once there are several orders', () => {
        twoOrders();
        ui(<MatchDesk />);
        expect(screen.queryByRole('button', { name: /^New match$/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'New match in the Winners running order' }))
            .toBeInTheDocument();
    });

    it('keeps the plain New match on a single-order rig, and sends no order', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: { active: [1], binding: {} },
        });
        useStateStore.setState({
            score: {},
            match: { 1: { stage: 'draft', format: { bestOf: 1 } } },
            schedule: { queues: [{ id: 'main', title: '', matches: [1] }] },
        });
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: /New match/ }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/match', expect.objectContaining({ method: 'POST' }));
    });

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
                    game_id: 'G1',
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                    score_left: 3, score_right: 2, inning: 5, half_inning: 'Top',
                    match: 2, side_reason: 'pin',
                },
            },
            match: {
                2: { label: 'Winners R2', series: { 1: 1, 2: 0 }, format: { bestOf: 3 } },
            },
        });
        ui(<BoardDesk board={1} />);
        // The game row is a SLOT now, in the fixture slot's shape — chip, side,
        // score, side — so the three parts are their own cells.
        expect(screen.getByText('LIVE')).toBeInTheDocument();
        expect(screen.getByText('3–2')).toBeInTheDocument();
        expect(screen.getByText('Top 5')).toBeInTheDocument();
        expect(screen.getByText('Sides pinned in the Address Book')).toBeInTheDocument();
        // The fixture is a SLOT with the match in it, not a sentence about one:
        // its id, both participants, the series between them, the round after.
        expect(screen.getByText('M2')).toBeInTheDocument();
        expect(screen.getByText('Winners R2')).toBeInTheDocument();
        expect(screen.getByText('1–0')).toBeInTheDocument();
    });

    /*
     * THE EMPTY STATES ARE SHAPES, NOT SENTENCES ABOUT ABSENCE. "No match on this
     * board" described the hole where a fixture goes; the slot IS that hole, and
     * when something is waiting it holds a ghost of the fixture the take would put
     * in it — so a producer reads what they are about to air in the place it will
     * appear, rather than off the face of a button.
     */
    it('shows the waiting fixture in the empty slot, with the take beside it', () => {
        useStateStore.setState({
            score: { 1: {} },
            match: { 5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } } },
            schedule: { queue: [5], queues: [{ id: 'main', title: 'Main', matches: [5] }] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('UP NEXT')).toBeInTheDocument();
        expect(screen.getByText('Cara vs Dev')).toBeInTheDocument();
        // The button no longer has to carry the name — the slot it acts on does.
        expect(screen.getByRole('button', { name: /Put on board/ }))
            .toHaveAttribute('title', expect.stringContaining('Cara vs Dev'));
        expect(screen.queryByText('No match on this board')).not.toBeInTheDocument();
    });

    /*
     * UNBIND FROM THE BOARD'S SIDE. It used to live only on the Match desk's lit
     * bind chip, which asked a producer looking at the wrong fixture ON THIS BOARD
     * to go find the match holding it. Both routes are the same staged write under
     * the SAME key, so confirm mode can never hold two entries disagreeing about
     * what one board carries.
     */
    it('takes a bound match off the board, staged under the shared bind key', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: { 2: { label: 'Winners R2', series: { 1: 1, 2: 0 } } },
        });
        ui(<BoardDesk board={1} />);
        fireEvent.click(screen.getByRole('button', { name: 'Take match 2 off board 1' }));
        expect(useStagingStore.getState().order).toEqual(['bind:1']);
        expect(useStagingStore.getState().pending['bind:1'].value).toBeNull();
        expect(fetch).not.toHaveBeenCalledWith(
            '/api/v1/scoreboards/1/match', expect.anything(),
        );
    });

    /*
     * THE END OF A MATCH. `decided` is the fixture's finished test, never `stage`
     * — a Bo3 sits at stage `post` BETWEEN GAMES and is still the current fixture.
     * A decided fixture stays bound (only a new game between different players
     * auto-retires one), so both end-of-match moves have to be here: hand the
     * board on, or clear it. Taking the next needs no unbind first — `bind_board`
     * overwrites the board's match.
     */
    it('marks a decided fixture final and offers the handover in place', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: {
                2: {
                    stage: 'post', decided: 1, series: { 1: 2, 2: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [2, 5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('FINAL')).toBeInTheDocument();
        expect(screen.getByText('UP NEXT')).toBeInTheDocument();
        expect(screen.getByText('Cara vs Dev')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Put on board/ })).toBeInTheDocument();
        // Clearing the board stays available beside the handover.
        expect(screen.getByRole('button', { name: 'Take match 2 off board 1' })).toBeInTheDocument();
    });

    // Mid-series: the game is over, the FIXTURE is not — so no FINAL, no handover,
    // and the slot says why nothing cleared itself.
    it('says a fixture at post is between games, not finished', () => {
        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: {
                2: {
                    stage: 'post', series: { 1: 1, 2: 0 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [2, 5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('between games')).toBeInTheDocument();
        expect(screen.queryByText('FINAL')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Put on board/ })).not.toBeInTheDocument();
    });

    /*
     * A ROTATING BOARD CANNOT HOLD A FIXTURE — a match encodes both sides of one
     * fixture and a board cycling a pool has no fixed sides to project onto. The
     * server 409s both bind routes; the panel must not offer a take that is going
     * to be rejected, and must say why rather than just going quiet.
     */
    it('offers no take on a rotating board, and says why', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: {
                active: [1], aliases: {},
                binding: { 1: { playback: { mode: 'rotate' } } },
            },
        });
        useStateStore.setState({
            score: { 1: {} },
            match: { 5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } } },
            schedule: { queue: [5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText(/a match needs a single-game board/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Put on board/ })).not.toBeInTheDocument();
        expect(screen.queryByText('Cara vs Dev')).not.toBeInTheDocument();
    });

    /*
     * …but a board switched to rotate while already holding a match still shows
     * it, with the unbind — because that is precisely how a producer gets out of
     * the state, and hiding the fixture would strand it there.
     */
    it('still shows a match a rotating board is already holding, with its unbind', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: {
                active: [1], aliases: {},
                binding: { 1: { playback: { mode: 'rotate' } } },
            },
        });
        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: { 2: { label: 'Winners R2', series: { 1: 1, 2: 0 } } },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('M2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Take match 2 off board 1' })).toBeInTheDocument();
    });

    /*
     * `default_match()` is `{"bestOf": 1}` and a Bo1 night is what almost every
     * night is, where the series cell reads 0–0 all match and then 1–0 once the
     * capture lands — a number saying nothing the game row above does not, in the
     * widest cell of the slot.
     */
    it('prints the series only when there is a series', () => {
        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: { 2: { series: { 1: 1, 2: 0 }, player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } } } },
        });
        const { unmount } = ui(<BoardDesk board={1} />);
        expect(screen.queryByText('1–0')).not.toBeInTheDocument();
        expect(screen.getByText('vs')).toBeInTheDocument();
        unmount();

        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: {
                2: {
                    series: { 1: 1, 2: 0 }, format: { bestOf: 3 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('1–0')).toBeInTheDocument();
    });

    it('names where fixtures come from when nothing is waiting either', () => {
        useStateStore.setState({ score: { 1: {} }, match: {}, schedule: { queue: [] } });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('NO MATCH')).toBeInTheDocument();
        expect(screen.getByText(/add one on the Match desk/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Put on board/ })).not.toBeInTheDocument();
    });

    it('has a phrase for every layer of the cascade, and none for raw feed order', () => {
        expect(sideReasonPhrase('manual')).toBe('set by hand');
        expect(sideReasonPhrase('match')).toBe('from the bound match');
        expect(sideReasonPhrase('pin')).toBe('pinned in the Address Book');
        expect(sideReasonPhrase('back_to_back')).toBe('as they were last game');
        // Raw feed order is not a decision, so there is nothing to explain.
        expect(sideReasonPhrase('')).toBeNull();
        expect(sideReasonPhrase(undefined)).toBeNull();
    });

    /*
     * `manual` is the top layer of the cascade and was the only one with no way
     * out — it cleared on a new game, or if a second swap happened to land on
     * what the pin already wanted. Neither is something a producer can ASK for,
     * so a swap made before a fixture was bound outranked that fixture all game.
     */
    it('offers the way out of a hand-set orientation, and only then', () => {
        const auto = { name: 'Use auto' };
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { player: {}, side_reason: 'pin' } }, match: {},
        });
        const { unmount } = ui(<BoardDesk board={1} />);
        expect(screen.queryByRole('button', auto)).not.toBeInTheDocument();
        unmount();

        useStateStore.setState({
            score: { 1: { player: {}, side_reason: 'manual' } }, match: {},
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('Sides set by hand')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', auto));
        expect(fetch).toHaveBeenCalledWith('/api/v1/rio/swap/release', { method: 'POST' });
    });

    /*
     * The override is a server flag over the HUD feed. An API board's swap is a
     * plain state write that never sets it, so there is nothing there to release
     * — and a button that posts to a board the route cannot reach is worse than
     * no button.
     */
    it('does not offer the release on an API board', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { player: {}, side_reason: 'manual' } }, match: {},
        });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByRole('button', { name: 'Use auto' })).not.toBeInTheDocument();
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
     * Home is a per-side chip, not a two-way picker: it is a choice between two
     * sides, so the side that has it cannot be clicked off — only the other side
     * can take it.
     */
    it('moves home to the other side, and will not turn it off', () => {
        useStateStore.setState({ score: { 1: { home_team: 2, player: {} } }, match: {} });
        ui(<BoardDesk board={1} />);
        const one = screen.getByRole('button', { name: 'side 1 bats last' });
        const two = screen.getByRole('button', { name: 'side 2 bats last' });
        expect(two).toHaveAttribute('aria-pressed', 'true');
        expect(one).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(one);
        expect(useStateStore.getState().score[1].home_team).toBe(1);
    });

    it('ignores a click on the side that is already home', () => {
        useStateStore.setState({ score: { 1: { home_team: 2, player: {} } }, match: {} });
        ui(<BoardDesk board={1} />);
        fireEvent.click(screen.getByRole('button', { name: 'side 2 bats last' }));
        expect(useStagingStore.getState().order).toEqual([]);
        expect(useStateStore.getState().score[1].home_team).toBe(2);
    });

    /*
     * The desk is the surface the vocabulary setting exists for: its columns are
     * where a wrong word costs the most, because a producer checking a
     * mislabelled board is comparing the panel against a screen.
     *
     * Note what does NOT move — `score_left` / `score_right` are state keys the
     * feed writes, and renaming a key is a migration, not a label change.
     */
    it('says the sides in the vocabulary the producer picked', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: { side_labels: 'tb' },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { home_team: 2, score_left: 1, score_right: 0, player: {}, side_reason: 'pin' } },
            match: {},
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: 'the top side bats last' })).toBeInTheDocument();
        expect(screen.getByLabelText('Score — Bottom')).toBeInTheDocument();
        expect(screen.getByText('Sides pinned in the Address Book')).toBeInTheDocument();
    });

    it('warns when the live players do not match the bound fixture', () => {
        useStateStore.setState({
            score: { 1: { match: 2, match_conflict: true, player: {} } },
            match: { 2: {} },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText(/don’t match the bound match/)).toBeInTheDocument();
    });

    /*
     * Transport is DERIVED — board 1 carries the HUD iff the global toggle is on
     * — so it is a readout with no picker, and the HUD-only recovery (re-read the
     * file) appears with it.
     */
    it('reads transport out rather than offering it, and offers the HUD re-read', () => {
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('HUD')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Re-read HUD/ })).toBeInTheDocument();
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
        // A pinned game still being played tracks the ongoing feed on its own,
        // server-side. The line says so because the panel's game list — which a
        // producer refreshes by hand — is NOT what keeps the board current, and
        // a visible countdown down there used to imply it was.
        expect(playbackLine({ transport: 'api', mode: 'single', gameId: 'g7', live: true }))
            .toBe('One game, pinned — following it live.');
        expect(playbackLine({ transport: 'api', mode: 'single', poolCount: 4 }))
            .toBe('One game — following the newest of 4 in pool.');
        expect(playbackLine({ transport: 'api', mode: 'single', poolCount: 0 }))
            .toBe('One game — nothing in its pool yet.');
        // Rotation on with an empty pool is a real state (nothing has matched the
        // filters yet); "0 in pool" reads like a count that failed.
        expect(playbackLine({ transport: 'api', mode: 'rotate', running: true, poolCount: 0 }))
            .toBe('Rotating — nothing in its pool yet.');
    });

    /*
     * The same two axes compressed to what a rack row can hold. Three tags, not
     * four: HUD + rotate is not a real state, so the pair collapses with nothing
     * lost. ROTATING, never "rotator" — a Rotator is the standalone layout group
     * (the results ticker), and one shared word on the app's most-read surface is
     * how the two get conflated.
     */
    it('compresses transport and playback into one type tag', () => {
        expect(boardTypeTag({ transport: 'hud', mode: 'single' })).toBe('HUD');
        expect(boardTypeTag({ transport: 'hud', mode: 'rotate' })).toBe('HUD');
        expect(boardTypeTag({ transport: 'api', mode: 'single' })).toBe('API');
        expect(boardTypeTag({ transport: 'api', mode: undefined })).toBe('API');
        expect(boardTypeTag({ transport: 'api', mode: 'rotate' })).toBe('ROTATING');
    });

    /*
     * THE COUNTDOWN IS THE BOARD'S, NOT THE GAME LIST'S. It reads the server's
     * cadence (every `v1.game_pool.ongoing_update` is a poll that just re-applied
     * this board's game) and fetches nothing itself, and it renders only under the
     * condition the server actually polls in: a single-mode board with a pinned
     * game still being played.
     */
    it('counts down to the live refresh only while the board is following one', () => {
        const single = (score) => {
            useSettingsStore.setState({
                project_rio: { hud_enabled: false },
                production: {},
                scoreboards: {
                    active: [1], aliases: {},
                    binding: { 1: { playback: { mode: 'single', gameId: 42 } } },
                },
            });
            useStateStore.setState({ score, match: {} });
        };

        single({ 1: { game_completed: false, player: { 1: { rioName: 'Alice' } } } });
        const { unmount } = ui(<BoardDesk board={1} />);
        expect(screen.getByText(/Refreshing in \d+s/)).toBeInTheDocument();
        unmount();

        // A finished game is not re-applied by the server, so a countdown here
        // would be timing something that never arrives.
        single({ 1: { game_completed: true, player: { 1: { rioName: 'Alice' } } } });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByText(/Refreshing in/)).not.toBeInTheDocument();
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
    /*
     * THE POOL IS WHAT EARNS A REGION. A HUD board has one possible game, from
     * one file — so "Games" carried a badge, a sentence, a re-read and the mode
     * across four lines and a divider, and its body (../games) was empty. All of
     * it is on the Game-state rule now and the region is gone.
     */
    it('has no Games region on a HUD board — the feed is on the game-state rule', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByText('Games')).not.toBeInTheDocument();
        expect(screen.queryByText('One game — the local HUD feed.')).not.toBeInTheDocument();
        // What survived, on the Game state header.
        const header = screen.getByText('Game state').parentElement;
        expect(header).toHaveTextContent('HUD');
        expect(within(header).getByRole('button', { name: /Re-read HUD/ })).toBeInTheDocument();
        expect(within(header).getByLabelText('Game mode')).toBeInTheDocument();
        // How to rebind is a tooltip on the badge, not a sentence on the panel.
        expect(screen.queryByText(/Turn off Follow local HUD/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Find a game/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('radio', { name: 'Rotating' })).not.toBeInTheDocument();
    });

    /*
     * The two axes ride the GAMES header rule, not a row of their own — one line
     * of state beside the eyebrow that names it. A HUD board's whole Games region
     * IS that header (GamesSection renders nothing), which is why the badge and
     * the sentence have to live on the desk rather than inside it.
     */
    it('states the playback on the Games header rule, and the transport above it', () => {
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
        const games = screen.getByText('Games').parentElement;
        expect(games).toHaveTextContent('Rotating — 2 in pool.');
        // The transport is a fact about the GAME, so it rides the game's rule —
        // an API board keeps its Games region because a pool is a real surface.
        expect(games).not.toHaveTextContent('API');
        expect(screen.getByText('Game state').parentElement).toHaveTextContent('API');
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
        fireEvent.change(screen.getByLabelText('Score — Side 1'), { target: { value: '4' } });
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
        fireEvent.click(screen.getByRole('button', { name: /Re-read HUD/ }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/rio/refresh', { method: 'POST' });
        expect(useStagingStore.getState().order).toEqual([]);
    });

    /*
     * THE SELECTOR MUST BE ABLE TO SAY WHAT THE BOARD HOLDS.
     *
     * The ACTIVE list is right for picking and wrong as the only vocabulary — a
     * board's mode comes from the game it is carrying, and a rotating pool of
     * completed games is mostly ended seasons that list no longer names. The
     * Combobox falls back to its placeholder for a value outside `data`, so
     * those boards read "Select game mode" while their stats_tag was perfectly
     * good and every stats fetch was running against it.
     *
     * Two answers, both pinned below: the catalogue arrives in two tiers so an
     * ended mode is PICKABLE, and whatever the board is holding is folded in on
     * top so it is SHOWABLE even before either list names it.
     */
    it('offers ended modes under the active ones', async () => {
        vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(
                String(url).includes('scope=all')
                    ? { 'S14 Superstars Off': 1, 'S13 Superstars Off': 2 }
                    : { 'S14 Superstars Off': 1 },
            ),
        })));
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({ score: { 1: {} }, match: {} });
        ui(<BoardDesk board={1} />);
        fireEvent.click(await screen.findByText('Select game mode'));
        await waitFor(() => expect(screen.getByText('Ended')).toBeInTheDocument());
        expect(screen.getByText('Active')).toBeInTheDocument();
        // Active first: the modes in use stay where they were, the rest are
        // reachable underneath rather than absent.
        const options = screen.getAllByRole('option').map(o => o.textContent);
        expect(options).toEqual(['S14 Superstars Off', 'S13 Superstars Off']);
    });

    it('shows a mode neither list names yet', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
            ok: true, json: () => Promise.resolve({ 'S14 Superstars Off': 1 }),
        })));

        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: {
                active: [1], aliases: {},
                binding: { 1: { stats_tag: 'S13 Superstars Off' } },
            },
        });
        useStateStore.setState({ score: { 1: { game_mode: 'S13 Superstars Off' } }, match: {} });
        ui(<BoardDesk board={1} />);
        await waitFor(() => expect(screen.getByText('S13 Superstars Off')).toBeInTheDocument());
        expect(screen.queryByText('Select game mode')).not.toBeInTheDocument();
    });

    /*
     * The override callout prints the mode name ONCE. A season name is half the
     * panel's width on its own, and a sentence that named it twice ("This game is
     * X — your pick is overriding it" beside a "Use X" button) wrapped to three
     * lines under the picker.
     */
    it('calls out an overridden live mode without spending two lines on its name', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: {},
            scoreboards: {
                active: [1], aliases: {},
                binding: { 1: { stats_tag: 'S14 Superstars Off', stats_tag_manual: true } },
            },
        });
        useStateStore.setState({
            score: { 1: { game_mode: 'SLICE 2026 Superstars Off' } }, match: {},
        });
        ui(<BoardDesk board={1} />);
        const hand_back = screen.getByRole('button', { name: 'Use live' });
        expect(hand_back).toHaveAttribute(
            'title', expect.stringContaining('SLICE 2026 Superstars Off'),
        );
        // NOT NAMED ON THE PANEL AT ALL. The amber ring says a hand is on the
        // picker and the button says how to hand it back; the live mode's name is
        // long enough to wrap a header on its own and did no work there that the
        // button's tooltip does not.
        expect(screen.queryByText('SLICE 2026 Superstars Off')).not.toBeInTheDocument();
        expect(screen.queryByText(/Overriding/)).not.toBeInTheDocument();
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

/*
 * POST-GAME IS A REGION ON THE BOARD, NOT A DESK.
 *
 * It was a desk, and its first control gave it away: a "Board" picker, on a
 * console whose rack has already asked which board you are looking at. Every
 * key it reads is board-scoped (`postgame.{N}.*`, matched to that board's
 * `score.{N}.game_id`), which is the same thing that makes Games and the
 * running order regions rather than desks.
 *
 * It is also mostly a readout now — the stat file Project Rio writes at the
 * final out fires the capture on its own (server/postgame_watch.py), so the
 * button is the recovery path and the panel says which of the two filled it.
 */
describe('Board desk — post-game', () => {
    beforeEach(() => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1, 2], aliases: {}, binding: {} },
        });
        useStateStore.setState({ score: {}, match: {}, postgame: {} });
    });

    it('offers capture on the board itself, with no second board picker', () => {
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: /Capture finished game/ })).toBeInTheDocument();
        // The rack picked the board; `Board` here would be asking twice. (`Name`
        // is the rename field, and stays.)
        expect(screen.queryByLabelText('Board')).not.toBeInTheDocument();
    });

    it('reads its own board, not the first one with a capture', () => {
        useStateStore.setState({
            score: { 1: {}, 2: {} },
            match: {},
            postgame: {
                1: { present: true, player: { 1: { rioName: 'Alice', score: 5 }, 2: { rioName: 'Bob', score: 2 } } },
            },
        });
        ui(<BoardDesk board={2} />);
        expect(screen.getByText('Nothing captured')).toBeInTheDocument();
        expect(screen.queryByText(/Alice/)).not.toBeInTheDocument();
    });

    // Which layer filled it in, the same "say who decided this" idiom as
    // side_reason — a box score that appeared on its own is not a producer
    // wondering whether they pressed something.
    it('says when the capture happened on its own', () => {
        useStateStore.setState({
            score: { 1: {} },
            match: {},
            postgame: {
                1: {
                    present: true, capturedBy: 'auto', sourceFile: 'decoded.Game_7.json',
                    meta: { winnerSide: 1 },
                    player: { 1: { rioName: 'Alice', score: 5 }, 2: { rioName: 'Bob', score: 2 } },
                },
            },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('AUTO')).toBeInTheDocument();
        expect(screen.getByText(/Captured on its own when the game ended/)).toBeInTheDocument();
        // Still recoverable by hand — the button becomes a re-capture.
        expect(screen.getByRole('button', { name: /Re-capture/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('badges a hand capture differently, and hides Clear until there is one', () => {
        ui(<BoardDesk board={1} />);
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

        cleanup();
        useStateStore.setState({
            score: { 1: {} },
            match: {},
            postgame: {
                1: {
                    present: true, capturedBy: 'manual', sourceFile: 'decoded.Game_7.json',
                    player: { 1: { rioName: 'Alice', score: 5 }, 2: { rioName: 'Bob', score: 2 } },
                },
            },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('CAPTURED')).toBeInTheDocument();
    });

    // With auto-capture on, "nothing here yet" is a WAIT, not an instruction —
    // the producer does not have to do anything for the common case.
    it('says what it is waiting for', () => {
        useStateStore.setState({ score: { 1: { game_id: '4242' } }, match: {}, postgame: {} });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText(/Waiting on the stat file for game 4242/)).toBeInTheDocument();

        cleanup();
        useStateStore.setState({ score: { 1: {} }, match: {}, postgame: {} });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText(/No game id on this board yet/)).toBeInTheDocument();
    });

    it('captures immediately, staging or not — it is a recovery action', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={1} />);
        fireEvent.click(screen.getByRole('button', { name: /Capture finished game/ }));
        expect(fetch).toHaveBeenCalledWith(
            '/api/v1/postgame/capture?scoreboard=1', { method: 'POST' },
        );
        expect(useStagingStore.getState().order).toEqual([]);
    });
});


/*
 * THE BOARD'S GAME LIFECYCLE — derived from state that already existed, and the
 * reason a stale board used to be indistinguishable from a live one.
 */
describe('board lifecycle', () => {
    // `postgame` is named explicitly because zustand's setState MERGES at the top
    // level: a capture left by an earlier test survives into the next one, and a
    // capture for this board's game id now decides the lifecycle (../boards).
    const board = (score, postgame = {}) => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: { 1: { playback: { mode: 'single' } } } },
        });
        useStateStore.setState({ score, postgame, match: {} });
    };

    it('reads empty, live, final and stranded off the keys each transport writes', () => {
        expect(boardLifecycle({})).toBe('empty');
        expect(boardLifecycle({ gameId: 'G1' })).toBe('live');
        // HUD: pyrio's end-of-game rule, per frame.
        expect(boardLifecycle({ gameId: 'G1', gameOver: true })).toBe('final');
        // API: a completed-game record.
        expect(boardLifecycle({ gameId: 'G1', gameCompleted: true })).toBe('final');
        // API: the server stopped polling a game that never finished cleanly.
        expect(boardLifecycle({ gameId: 'G1', liveFollowing: false })).toBe('stranded');
    });

    /*
     * THE HUD FEED HAS NO FINAL FRAME. Project Rio stops writing and its last
     * frame stands, so `game_over` never arrives and a finished local game read
     * `live` forever — the board sat on "8–8, Bot 6" with the real result
     * captured directly underneath, saying LIVE, and the turnover bar that exists
     * for that exact moment never appeared.
     *
     * The stat file IS the end-of-game signal for a local board; the server
     * already builds auto-capture on it (server/postgame_watch.py).
     */
    it('takes a capture for this game as the game being over', () => {
        expect(boardLifecycle({ gameId: 'G1', captured: true })).toBe('final');
        // It outranks `stranded` too: a parsed final box score is stronger
        // evidence than the server having stopped polling.
        expect(boardLifecycle({ gameId: 'G1', captured: true, liveFollowing: false })).toBe('final');
        expect(boardLifecycle({ gameId: 'G1', captured: false })).toBe('live');
    });

    it('reads a finished HUD game as final off its capture alone', () => {
        board(
            { 1: { game_id: 'G1', inning: 6, half_inning: 'Bottom', player: { 1: { rioName: 'rjb' } } } },
            { 1: { present: true, gameId: 'G1', capturedBy: 'auto', player: {} } },
        );
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('FINAL')).toBeInTheDocument();
        expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
        // ...which is what raises the bar the moment actually calls for.
        expect(screen.getByRole('button', { name: /Clear game state/ })).toBeInTheDocument();
    });

    /*
     * The capture has to be THIS game's. Nothing clears `postgame.{N}` when a new
     * game starts, so a bare `present` would mark game 2 of a Bo3 final the
     * instant it kicked off, on game 1's box score.
     */
    it('does not let a previous game’s capture end the one on the board', () => {
        board(
            { 1: { game_id: 'G2', inning: 2, player: { 1: { rioName: 'rjb' } } } },
            { 1: { present: true, gameId: 'G1', capturedBy: 'auto', player: {} } },
        );
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('LIVE')).toBeInTheDocument();
    });

    it('treats an absent live_following as still following', () => {
        // State written before the flag existed must behave the way the board
        // already was, not report every old game as abandoned.
        expect(boardLifecycle({ gameId: 'G1', liveFollowing: undefined })).toBe('live');
    });

    it('needs a game before it can call one over', () => {
        // A latched flag on an empty board would announce a finished game that
        // is not there.
        expect(boardLifecycle({ gameOver: true })).toBe('empty');
    });

    it('says where the game got to, and “over” is somewhere a game gets to', () => {
        board({ 1: { game_id: 'G1', inning: 9, half_inning: 'Top', game_over: true, score_left: 6, score_right: 14, player: { 1: { rioName: 'rjb' }, 2: { rioName: 'MattGree' } } } });
        ui(<BoardDesk board={1} />);
        // "Top 9" alone was useless as an answer to "is this still going", so it
        // used to be REPLACED by the word Final — which cost the finished game
        // the inning it finished in. The chip answers the question; the meta goes
        // back to being the meta.
        expect(screen.getByText('FINAL')).toBeInTheDocument();
        expect(screen.getByText('Top 9')).toBeInTheDocument();
    });

    it('offers the clear rather than taking it, and says what the fixture will do', () => {
        board({ 1: { game_id: 'G1', game_over: true, match: 4, player: { 1: { rioName: 'rjb' } } } });
        useStateStore.setState({
            score: useStateStore.getState().score,
            match: { 4: { player: { 1: {}, 2: {} }, series: { 1: 0, 2: 0 }, format: { bestOf: 3 } } },
        });
        ui(<BoardDesk board={1} />);

        // The sentence describing the state is gone — the chip on the game row
        // says it, and the bar spends its width on the three presses instead.
        expect(screen.getByText('FINAL')).toBeInTheDocument();
        expect(screen.getByText(/Nothing captured for M4 yet/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear game state/ })).toBeInTheDocument();
    });

    it('distinguishes a game the feed LOST from one that finished', () => {
        // A quit or a crash is not a clean finish, and it is the case where a
        // producer may still want to capture by hand.
        board({ 1: { game_id: 'G1', live_following: false, player: { 1: { rioName: 'rjb' } } } });
        ui(<BoardDesk board={1} />);
        // A quit is ENDED, a clean finish is FINAL — we know it is not coming
        // back, not that it finished. Both still raise the turnover bar, because
        // a stranded game is exactly where a hand capture is wanted.
        expect(screen.getByText('ENDED')).toBeInTheDocument();
        expect(screen.queryByText('FINAL')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear game state/ })).toBeInTheDocument();
    });

    /*
     * ONE VERB, ONE NAME, ONE BUTTON. The region's hatch and the bar's press are
     * the same `resetGame`; naming them the same thing showed that both were on
     * screen at the end of every game. The bar owns the press while it is part of
     * a sequence.
     */
    it('keeps one clear on the panel when the turnover bar takes it over', () => {
        board({ 1: { game_id: 'G1', game_over: true, player: { 1: { rioName: 'rjb' } } } });
        ui(<BoardDesk board={1} />);
        const clears = screen.getAllByRole('button', { name: /Clear game state/ });
        expect(clears).toHaveLength(1);
        // It is the bar's — the Capture beside it is the giveaway.
        expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument();
    });

    /*
     * THE BO1 GAP. The take lived in the fixture slot behind `decided`, which is
     * the right gate for a Bo3 and the wrong one for the night almost every night
     * is: the game ends, the match is over in every sense that matters, and the
     * producer's next press was hidden behind a condition not yet met BECAUSE the
     * capture that decides the series had not been made.
     */
    it('offers the next fixture on a finished game the match has not caught up with', () => {
        board({ 1: { game_id: 'G1', game_over: true, match: 4, player: { 1: { rioName: 'rjb' } } } });
        useStateStore.setState({
            score: useStateStore.getState().score,
            match: {
                4: { stage: 'live', player: { 1: {}, 2: {} }, format: { bestOf: 1 } },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [4, 5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: /Put on board/ })).toBeInTheDocument();
    });

    /*
     * ...and exactly one take on the panel. A decided fixture offers its own, in
     * the slot it is finishing in, and keeps offering it after the board is
     * cleared — so the bar stands down rather than printing a second.
     */
    it('does not print a second take when the fixture is already offering one', () => {
        board({ 1: { game_id: 'G1', game_over: true, match: 4, player: { 1: { rioName: 'rjb' } } } });
        useStateStore.setState({
            score: useStateStore.getState().score,
            match: {
                4: { stage: 'post', decided: 1, player: { 1: {}, 2: {} } },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [4, 5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getAllByRole('button', { name: /Put on board/ })).toHaveLength(1);
    });

    /*
     * Capture is what ADVANCES the match and credits the series, so it is the
     * first of the three presses. Once it has happened the bar shows the receipt
     * and offers nothing — the stat file usually fires it on its own.
     */
    it('shows the capture receipt in place of the capture', () => {
        board(
            { 1: { game_id: 'G1', game_over: true, player: { 1: { rioName: 'rjb' } } } },
            {
                1: {
                    present: true, gameId: 'G1', capturedBy: 'auto',
                    player: { 1: { rioName: 'rjb', score: 6 }, 2: { rioName: 'MattGree', score: 14 } },
                },
            },
        );
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('Captured automatically.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Capture' })).not.toBeInTheDocument();
        // The box score itself is printed once, by the post-game region below.
        expect(screen.getAllByText('AUTO')).toHaveLength(1);
    });

    // A capture from an EARLIER game is not this game's receipt, so the press
    // stays on offer (../postgame reads the capture's own gameId to tell them
    // apart).
    it('still offers the capture when the box score is a previous game’s', () => {
        board(
            { 1: { game_id: 'G2', game_over: true, player: { 1: { rioName: 'rjb' } } } },
            { 1: { present: true, gameId: 'G1', capturedBy: 'auto', player: {} } },
        );
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument();
    });

    it('says nothing at all while a game is in progress', () => {
        board({ 1: { game_id: 'G1', inning: 4, half_inning: 'Bottom', player: { 1: { rioName: 'rjb' } } } });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('LIVE')).toBeInTheDocument();
        expect(screen.getByText('Bot 4')).toBeInTheDocument();
        // No turnover bar: nothing to capture, nothing to hand over.
        expect(screen.queryByRole('button', { name: 'Capture' })).not.toBeInTheDocument();
        // And exactly ONE clear on the panel — the region's own hatch, which is
        // what the bar stands in for once the game is over.
        expect(screen.getAllByRole('button', { name: /Clear game state/ })).toHaveLength(1);
    });
});


/*
 * THE STAT FILE A CAPTURE READS — and the producer's way past the automatic
 * match when something went wrong in the game.
 */
describe('post-game stat file', () => {
    const board = (score, postgame) => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: { 1: { playback: { mode: 'single' } } } },
        });
        useStateStore.setState({ score, postgame, match: {} });
    };

    it('says when the box score is a different game from the one on the board', () => {
        // Nothing clears postgame.{N} on a new game, so after game 1 of a Bo3
        // the region kept reporting game 1 while game 2 played — and could not
        // have known better, because it never read the capture's own gameId.
        board(
            { 1: { game_id: 'G2', player: { 1: { rioName: 'rjb' } } } },
            { 1: { present: true, gameId: 'G1', sourceFile: 'decoded.Game_G1.json' } },
        );
        ui(<BoardDesk board={1} />);
        expect(screen.getByText(/from game G1; the board is on G2/)).toBeInTheDocument();
    });

    it('stays quiet when the capture is the board’s own game', () => {
        board(
            { 1: { game_id: 'G1', player: { 1: { rioName: 'rjb' } } } },
            { 1: { present: true, gameId: 'G1', sourceFile: 'decoded.Game_G1.json' } },
        );
        ui(<BoardDesk board={1} />);
        expect(screen.queryByText(/the board is on/)).not.toBeInTheDocument();
    });

    it('reads the stat folder only when the picker is opened', async () => {
        // A recovery path that stats and parses a directory on every mount
        // charges every producer for the one who needs it.
        board({ 1: { game_id: 'G1', player: { 1: { rioName: 'rjb' } } } }, {});
        ui(<BoardDesk board={1} />);

        const calls = () => global.fetch.mock.calls.filter(
            ([u]) => String(u).includes('/postgame/files'));
        expect(calls()).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: /Pick a file/ }));
        await waitFor(() => expect(calls()).toHaveLength(1));
    });

    it('captures the chosen file by name, past the game-id match', async () => {
        board({ 1: { game_id: 'G1', player: { 1: { rioName: 'rjb' } } } }, {});
        global.fetch.mockImplementation((url) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(
                String(url).includes('/postgame/files')
                    ? { files: [{ file: 'decoded.Game_999.json', awayPlayer: 'rjb', homePlayer: 'MattGree', awayScore: 6, homeScore: 14, gameId: '999' }] }
                    : { success: true, sourceFile: 'decoded.Game_999.json' },
            ),
        }));
        ui(<BoardDesk board={1} />);

        fireEvent.click(screen.getByRole('button', { name: /Pick a file/ }));
        // The row names who played and the score — a filename is a GameID, and
        // no producer knows which game that is.
        const row = await screen.findByText('MattGree');
        fireEvent.click(row.closest('button'));

        await waitFor(() => {
            const posted = global.fetch.mock.calls.find(
                ([u, o]) => o?.method === 'POST' && String(u).includes('/postgame/capture'));
            expect(posted).toBeTruthy();
            expect(String(posted[0])).toContain('file=decoded.Game_999.json');
        });
    });

    it('does not send a file when the plain Capture button is pressed', async () => {
        // The click event would otherwise arrive as the filename.
        board({ 1: { game_id: 'G1', player: { 1: { rioName: 'rjb' } } } }, {});
        ui(<BoardDesk board={1} />);

        fireEvent.click(screen.getByRole('button', { name: /Capture finished game/ }));
        await waitFor(() => {
            const posted = global.fetch.mock.calls.find(
                ([u, o]) => o?.method === 'POST' && String(u).includes('/postgame/capture'));
            expect(posted).toBeTruthy();
            expect(String(posted[0])).not.toContain('file=');
        });
    });
});

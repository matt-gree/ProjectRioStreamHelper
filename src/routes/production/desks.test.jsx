import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { SocketContext } from '../../context/socket';
import { useStagingStore } from '../../context/staging';
import MatchDesk from './match/desk';
import BoardDesk from './board/desk';
import { boardTypeTag } from './board/data';
import { sideReasonStatus } from './board/sides';
import { boardLifecycle } from './board/boards';

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
     * THE COLD START ON THIS DESK — every fixture played, which is what a producer
     * opens the app to the morning after a night. The desk used to answer it with a
     * collapsed "1 played" fold, a finished card, and a small outline New match at
     * the very bottom of the panel: nothing on screen was the next thing to do, so
     * nothing looked like it.
     */
    it('leads with the press when the whole night has been played', () => {
        useStateStore.setState({
            match: {
                1: {
                    decided: 1, stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            schedule: { queue: [1] },
        });
        ui(<MatchDesk />);
        expect(screen.getByText(/Every match has been played/)).toBeInTheDocument();
        // ONE New match, not two: the footer stands down while the lead carries
        // the verb, or the desk offers the same press twice in one panel.
        expect(screen.getAllByRole('button', { name: /New match/ })).toHaveLength(1);
    });

    /*
     * CLEARING COMES BEFORE ADDING. A finished night's loud button was
     * "New match" — a forward press stepping over the obvious question, whose
     * outcome is tonight's fixture buried under last night's. The clear is the
     * primary now, and it lands on the empty state where New match is.
     */
    it('makes clearing the played night the prominent press, not adding to it', () => {
        useStateStore.setState({
            match: {
                1: {
                    decided: 1, stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            schedule: { queue: [1] },
        });
        ui(<MatchDesk />);
        expect(screen.getByRole('button', { name: /Clear played/ }))
            .toHaveAttribute('data-variant', 'default');
        expect(screen.getByRole('button', { name: /New match/ }))
            .toHaveAttribute('data-variant', 'ghost');
    });

    // ...and the state it lands on has adding as its only press, so the two steps
    // chain rather than competing.
    it('makes adding the prominent press once there is nothing to clear', () => {
        // Stated, not inherited: the store is shared across this file's tests, so
        // an empty desk has to be asked for.
        useStateStore.setState({ match: {}, score: {}, schedule: { queue: [] } });
        ui(<MatchDesk />);
        expect(screen.getByRole('button', { name: /New match/ }))
            .toHaveAttribute('data-variant', 'default');
        expect(screen.queryByRole('button', { name: /Clear played/ })).not.toBeInTheDocument();
    });

    /*
     * MID-NIGHT THERE IS NO BULK CLEAR. The night strip is down while a fixture is
     * still waiting, so the only removals on screen are the per-row ones — and the
     * decided row is the one wearing a labelled button.
     */
    it('leaves the night running without a bulk clear over it', () => {
        useStateStore.setState({
            match: {
                1: {
                    decided: 1, stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                2: {
                    stage: 'draft', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } },
                },
            },
            schedule: { queue: [1, 2] },
        });
        ui(<MatchDesk />);
        expect(screen.queryByText(/Every match has been played/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Clear played/ })).not.toBeInTheDocument();
        // One labelled clear — the decided fixture's. The draft one keeps its icon.
        const labelled = screen.getAllByRole('button', { name: /Clear match/ })
            .filter(b => /Clear/.test(b.textContent));
        expect(labelled).toHaveLength(1);
    });

    /*
     * IT NAMES THE BOARD IT WILL BLANK. A decided fixture stays bound, so clearing
     * a played run can unbind a board that is on air — and the popover is the last
     * thing between the producer and that.
     */
    it('names the board a clear would unbind, and deletes each match it listed', async () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { game_id: 'G1', match: 1 } },
            match: {
                1: {
                    decided: 1, stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            schedule: { queue: [1] },
        });
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: /Clear played/ }));
        expect(await screen.findByText(/Board 1 still holds one/)).toBeInTheDocument();

        // Exact name: the row clears are "Clear match N" and the trigger is
        // "Clear played", so only the popover's confirm is bare "Clear".
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        await waitFor(() => {
            expect(global.fetch.mock.calls.some(
                ([url, opt]) => /\/match\/1$/.test(String(url)) && opt?.method === 'DELETE',
            )).toBe(true);
        });
    });

    /*
     * A DECIDED FIXTURE HAS NO STAGE QUESTION. The badge exists to say why a
     * fixture is not coming up; on a finished one the answer is "because it is
     * finished", which the emerald result badge beside it has already given in the
     * producer's words rather than the state key's — and the popover's one verb
     * writes `stage = draft`, which changes nothing about whether a decided match
     * is offered.
     */
    it('drops the stage badge from a fixture that is already decided', () => {
        useStateStore.setState({
            match: {
                1: {
                    decided: 1, stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            schedule: { queue: [1] },
        });
        ui(<MatchDesk />);
        expect(screen.getByText(/Side 1 wins/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /lifecycle/ })).not.toBeInTheDocument();
        // Reopen is the only move a finished fixture has, and now the only one shown.
        expect(screen.getByRole('button', { name: /Reopen/ })).toBeInTheDocument();
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
     * A DOUBLEHEADER DOES NOT OWE ANYONE A WINNER. 1-1 is complete, not stuck, so
     * the desk offers no verb to invent one — not `Decide: Side N` (nobody is at
     * the win count) and not a pick between the two (there is nothing to settle).
     * The only correction is to the series itself, on the steppers.
     */
    it('offers no way to name a winner on a split — it is complete without one', () => {
        oneMatch({
            format: { bestOf: 2 },
            series: { 1: 1, 2: 1 },
            player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
        });
        ui(<MatchDesk />);
        expect(screen.getByText('Split')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Decide/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
    });

    /*
     * A SPLIT IS FINISHED, so it draws none of the verbs that move a fixture on.
     * `Ready next game` and the lifecycle badge both answer "why is this not
     * coming up?", and on a split the answer is the badge beside them.
     */
    it('treats a split as finished: no winner badge, no stage question, no next game', () => {
        oneMatch({ stage: 'post', format: { bestOf: 2 }, series: { 1: 1, 2: 1 } });
        ui(<MatchDesk />);
        expect(screen.queryByText(/wins$/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Ready next game' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /lifecycle/ })).not.toBeInTheDocument();
    });

    /*
     * A SERIES NEVER HOLDS MORE GAMES THAN ITS FORMAT ALLOWS. The steppers are
     * the only surface that writes the series by hand, and uncapped they let a
     * doubleheader be typed to 2-1 — three games in a two-game fixture, on a
     * count a bound board puts on air.
     */
    it('stops the steppers at the number of games the format holds', () => {
        oneMatch({ format: { bestOf: 2 }, series: { 1: 1, 2: 1 } });
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: 'Side 1 +1 game' }));
        expect(fetch).not.toHaveBeenCalledWith('/api/v1/match/1', expect.anything());
        expect(screen.getByRole('button', { name: 'Side 1 +1 game' })).toBeDisabled();
        // Room on one side is room for that side alone.
        expect(screen.getByRole('button', { name: 'Side 2 -1 game' })).not.toBeDisabled();
    });

    /*
     * NEVER CLAMP DOWN. Lowering `bestOf` under a longer series leaves both sides
     * over the ceiling, and a clamping `+` would answer a press meant to ADD a
     * game by deleting two. Out of room is a press that does nothing.
     */
    it('leaves an over-full series alone rather than clamping it to the new format', () => {
        oneMatch({ format: { bestOf: 1 }, series: { 1: 2, 2: 1 } });
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: 'Side 1 +1 game' }));
        expect(fetch).not.toHaveBeenCalledWith('/api/v1/match/1', expect.anything());
        // The correction out of it is still open.
        fireEvent.click(screen.getByRole('button', { name: 'Side 1 -1 game' }));
        expect(fetch).toHaveBeenCalledWith('/api/v1/match/1', expect.objectContaining({
            method: 'PUT', body: JSON.stringify({ series: { 1: 1 } }),
        }));
    });

    // A sweep is not a split: both games played, but one side took them.
    it('decides a swept doubleheader in one press', () => {
        oneMatch({ format: { bestOf: 2 }, series: { 1: 2, 2: 0 } });
        ui(<MatchDesk />);
        expect(screen.queryByText('Split')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Decide: Side 1' })).toBeInTheDocument();
    });

    /*
     * THE TWO HALVES OF THE ROW MUST READ THE SAME SERIES. The stepper writes into
     * the staging buffer under confirm mode while the clinch arithmetic read live
     * state, so bumping a side to the win count turned the score amber and offered
     * no Decide until the bump was committed — two commits for one intent, with
     * the button invisible in between.
     */
    it('offers Decide off a STAGED stepper bump, before it is confirmed', () => {
        useStagingStore.setState({ pending: {}, order: [] });
        oneMatch({ format: { bestOf: 1 } });
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], binding: {} },
        });
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: 'Side 1 +1 game' }));
        expect(fetch).not.toHaveBeenCalledWith('/api/v1/match/1', expect.anything());
        expect(screen.getByRole('button', { name: /Decide: Side 1/ })).toBeInTheDocument();
        useStagingStore.setState({ pending: {}, order: [] });
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
        expect(screen.getByText('PINNED')).toBeInTheDocument();
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
     * ONE ROW, TWO CLOCKS — AND THE NAMES ARE THE SHARED SUBJECT.
     *
     * The game and the fixture were two full-width bars, stacked, each spending
     * its width on the SAME TWO NAMES with ~400px of dead air in the middle. They
     * were the same two strings from the same key: the Match projector writes
     * `match.{M}`'s participants into `score.{N}.player.{T}.rioName`
     * (`_FEED_SHARED_KEYS`), so the second bar was reprinting the first's copy.
     */
    it('draws both clocks on one row, naming the players once', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: {
                1: {
                    game_id: 'G1', inning: 5, half_inning: 'Top', match: 2,
                    score_left: 3, score_right: 2,
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            match: {
                2: {
                    label: 'Winners R2', stage: 'live',
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
        });
        ui(<BoardDesk board={1} />);
        // Both clocks are still fully readable — the game's stage, score and
        // inning, the fixture's id, round and unlink.
        expect(screen.getByText('LIVE')).toBeInTheDocument();
        expect(screen.getByText('3–2')).toBeInTheDocument();
        expect(screen.getByText('Top 5')).toBeInTheDocument();
        expect(screen.getByText('M2')).toBeInTheDocument();
        expect(screen.getByText('Winners R2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Take match 2 off board 1' })).toBeInTheDocument();
        // ...and the fixture's half of the row carries NO names: the two it
        // would print are the two the game half is already printing, from the
        // key the projector copied them into.
        expect(screen.getByText('M2').parentElement).not.toHaveTextContent('Alice');
        expect(screen.getByText('M2').parentElement).not.toHaveTextContent('Bob');
    });

    /*
     * ...AND IT SPLITS AGAIN THE MOMENT THEY STOP AGREEING, which is the whole
     * reason the merge is conditional. A live feed can overwrite those names with
     * different players — what `match_conflict` is raised for — and there the
     * DIFFERENCE is the content: one merged row could only show one pair, which
     * is the one thing a producer resolving a conflict must not be handed.
     */
    it('splits back into two bars when the game and the fixture disagree', () => {
        useStateStore.setState({
            score: {
                1: {
                    game_id: 'G1', match: 2, match_conflict: true,
                    player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } },
                },
            },
            match: {
                2: { player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } } },
            },
        });
        ui(<BoardDesk board={1} />);
        // Both pairs on screen: the game's on air, and the fixture's own bar
        // naming the two it was authored with.
        const fixture = screen.getByText('M2').parentElement;
        expect(fixture).toHaveTextContent('Alice');
        expect(fixture).toHaveTextContent('Bob');
        expect(fixture).not.toHaveTextContent('Cara');
    });

    /*
     * A fixture bound with NO participants yet is a real state the conflict gate
     * says nothing about, and splitting there is right: "Side 1 vs Side 2" under
     * a live game is how a producer sees they bound an empty draft.
     */
    it('splits for an empty draft bound over a live game', () => {
        useStateStore.setState({
            score: {
                1: {
                    game_id: 'G1', match: 2,
                    player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } },
                },
            },
            match: { 2: { player: {} } },
        });
        ui(<BoardDesk board={1} />);
        const fixture = screen.getByText('M2').parentElement;
        expect(fixture).toHaveTextContent('Side 1');
        expect(fixture).toHaveTextContent('Side 2');
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
        // DECIDED, not FINAL: the game chip on the same row spends FINAL on a
        // game that reached its last out, and a captured Bo1 is both at once.
        expect(screen.getByText('DECIDED')).toBeInTheDocument();
        expect(screen.getByText('UP NEXT')).toBeInTheDocument();
        expect(screen.getByText('Cara vs Dev')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Put on board/ })).toBeInTheDocument();
        // Clearing the board stays available beside the handover.
        expect(screen.getByRole('button', { name: 'Take match 2 off board 1' })).toBeInTheDocument();
    });

    // Mid-series: the game is over, the FIXTURE is not — so no result badge, no
    // handover, and the slot says why nothing cleared itself.
    it('says a fixture at post is between games, not finished', () => {
        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: {
                2: {
                    stage: 'post', format: { bestOf: 3 }, series: { 1: 1, 2: 0 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [2, 5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('between games')).toBeInTheDocument();
        expect(screen.queryByText('DECIDED')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Put on board/ })).not.toBeInTheDocument();
    });

    /*
     * A DOUBLEHEADER IS `bestOf: 2` — two Bo1s under one fixture, and the one
     * format that can be COMPLETE AND UNDECIDED. A 1-1 split has no winner, so
     * `decided` stays null forever; a take stood down on `!decided` would strand
     * the board for the rest of the night on a fixture with no games left.
     */
    it('holds the take between the two games of a doubleheader', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { game_id: 'G1', game_over: true, match: 2 } },
            postgame: {},
            match: {
                2: {
                    stage: 'post', format: { bestOf: 2 }, series: { 1: 1, 2: 0 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [2, 5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByRole('button', { name: /Put on board/ })).not.toBeInTheDocument();
        expect(screen.getByText(/GAME 2\s+OF 2/)).toBeInTheDocument();
    });

    it('calls a split doubleheader SPLIT, and hands the board on', () => {
        useStateStore.setState({
            score: { 1: { game_id: 'G1', game_over: true, match: 2 } },
            postgame: {},
            match: {
                2: {
                    stage: 'post', format: { bestOf: 2 }, series: { 1: 1, 2: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [2, 5] },
        });
        ui(<BoardDesk board={1} />);
        // Finished, and nobody took it — so the badge must not name a winner.
        expect(screen.getByText('SPLIT')).toBeInTheDocument();
        expect(screen.queryByText('DECIDED')).not.toBeInTheDocument();
        // ...and the fixture is out of games, so the handover is on offer — once.
        expect(screen.getAllByRole('button', { name: /Put on board/ })).toHaveLength(1);
        // The clear takes the finished fixture off with it, exactly as a decided
        // one does: there is no further game for it to put on this board.
        expect(screen.getByRole('button', { name: 'Clear & unbind M2' })).toBeInTheDocument();
    });

    /*
     * ...AND A Bo1 IS NEVER BETWEEN GAMES, because there is no next game to be
     * between. `default_match()` is `{bestOf: 1}` and nearly every night is one,
     * so a phrase gated only on `stage === 'post'` turned up on boards it could
     * not describe — which is what happens whenever a capture fails to credit a
     * winner (a quit game reports none) and leaves a Bo1 at post, undecided.
     * The FORMAT is what says another game can follow, so the format gates it.
     */
    it('never says between games on a Bo1', () => {
        useStateStore.setState({
            score: { 1: { match: 2 } },
            match: {
                2: {
                    stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            schedule: { queue: [2] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByText('between games')).not.toBeInTheDocument();
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
        // The eyebrow names the reason; the rule itself is its expansion, so the
        // panel states it without spending a line of prose on it.
        expect(screen.getByText('ROTATING')).toBeInTheDocument();
        expect(screen.getByTitle(/A rotating board can’t hold a match/)).toBeInTheDocument();
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
        expect(screen.getByTitle(/Author a fixture on the Match desk/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Put on board/ })).not.toBeInTheDocument();
    });

    /*
     * A BADGE, NOT A SENTENCE. Every other fact on that header rule is one (HUD,
     * the mode, the game's own stage an inch above), and four of the five words
     * in "Sides from the bound match" were the same on every board. The label is
     * the layer; the sentence moves to the title, which is where a producer who
     * has not met the cascade can still find it.
     */
    it('has a badge for every layer of the cascade, and none for raw feed order', () => {
        expect(sideReasonStatus('manual').label).toBe('BY HAND');
        expect(sideReasonStatus('match').label).toBe('FROM MATCH');
        expect(sideReasonStatus('pin').label).toBe('PINNED');
        expect(sideReasonStatus('back_to_back').label).toBe('LAST GAME');
        // Every one of them explains itself on hover — a two-word badge that
        // cannot be expanded is a riddle.
        for (const r of ['manual', 'match', 'pin', 'back_to_back']) {
            expect(sideReasonStatus(r).title).toMatch(/^Sides /);
        }
        // Raw feed order is not a decision, so there is nothing to explain.
        expect(sideReasonStatus('')).toBeNull();
        expect(sideReasonStatus(undefined)).toBeNull();
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
        expect(screen.getByText('BY HAND')).toBeInTheDocument();
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
        // The cascade layer is a badge; the side VOCABULARY is what this test is
        // about and it never appears in one — "pinned in the Address Book" names
        // a place, not a side.
        expect(screen.getByText('PINNED')).toBeInTheDocument();
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
     * THE REGION'S RULE CARRIES THE CONTROL, NOT A SENTENCE ABOUT IT.
     *
     * `playbackLine` wrote this rule's subject — "Rotating — nothing in its pool
     * yet", "One game, pinned — following it live" — and every clause of it was
     * drawn again within a few rows: the mode by the segmented directly beneath
     * it (now on the rule itself), the pool count by the rotator's own status
     * line, "paused" by the Start button, "following it live" by the refresh
     * countdown beside it. The control states the choice AND changes it, which
     * is one row for what was two.
     */
    it('puts the playback control on the Games rule, and no prose about it', () => {
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
            scoreboards: { rotation: { 1: { game_ids: [11, 12, 13] } } },
            match: {},
        });
        ui(<BoardDesk board={1} />);
        const games = screen.getByText('Games').parentElement;
        expect(within(games).getByRole('radio', { name: 'Rotating' }))
            .toHaveAttribute('aria-checked', 'true');
        expect(screen.queryByText(/in pool/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Rotating —/)).not.toBeInTheDocument();
        expect(screen.queryByText(/pinned/)).not.toBeInTheDocument();
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

    /*
     * WHAT IS IN THE POOL IS THE ROTATOR'S OWN LINE, and only its own line — the
     * one surface that can also say WHY a pool is empty (filters edited since
     * the last Find, an unreachable API, no filter at all). The rule quoted the
     * count too, which is how a producer ended up reading the same number twice
     * on the way to the answer that was only ever in one of them.
     */
    it('says what is in the pool once, on the rotator’s own status line', () => {
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
            scoreboards: {
                rotation: {
                    1: {
                        game_ids: [11, 12, 13],
                        cached_games: [{ game_id: 11 }, { game_id: 12 }, { game_id: 13 }],
                    },
                },
            },
            match: {},
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getAllByText('3 games in the pool')).toHaveLength(1);
        const games = screen.getByText('Games').parentElement;
        expect(games).not.toHaveTextContent('pool');
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
     * The two axes are drawn a region apart, which is what keeps them two: the
     * DERIVED transport is a badge on the game's own rule, the CHOSEN playback a
     * control on the pool's. A HUD board has no Games region at all, which is
     * why the badge lives on the desk rather than inside ../games.
     */
    it('keeps the playback on the Games rule and the transport on the game’s', () => {
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
        expect(within(games).getByRole('radio', { name: 'Rotating' })).toBeInTheDocument();
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
     * THE BODY CARRIES NEITHER OF THE BOARD'S OWN TWO VERBS.
     *
     * Whether the board EXISTS is rig membership, which lives in the rack's
     * BOARDS section next to the + that creates one (rack.test.jsx covers it) —
     * Remove was here once, four scrolls down inside the row it deletes, and
     * could not be found. What it is CALLED is the panel's title, which this
     * body sits under: a `Name` field at the foot of four regions was setting the
     * 15px string printed at the top of the same panel (stage.test.jsx covers the
     * field that replaced it).
     */
    it('carries neither the board’s rename nor its removal in the body', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1, 2], aliases: {}, binding: {} },
        });
        ui(<BoardDesk board={2} />);
        expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
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
 * final out fires the capture on its own (server/postgame/watch.py), so the
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
        // Said ONCE, on the badge that already states the provenance — the
        // caption below it is the filename and nothing else.
        expect(screen.getByText('AUTO')).toBeInTheDocument();
        expect(screen.getByTitle(/Captured on its own the moment Project Rio wrote/)).toBeInTheDocument();
        expect(screen.getByText('decoded.Game_7.json')).toBeInTheDocument();
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
        expect(screen.getByText('WAITING')).toBeInTheDocument();
        expect(screen.getByText('Game 4242')).toBeInTheDocument();

        // With no game id there is nothing to wait FOR, and the emptiness is
        // already reported twice above — the game-state chip and the region's
        // own subject. The caption stands down rather than saying it a third time.
        cleanup();
        useStateStore.setState({ score: { 1: {} }, match: {}, postgame: {} });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByText('WAITING')).not.toBeInTheDocument();
        expect(screen.getByText('Nothing captured')).toBeInTheDocument();
    });

    it('captures immediately, staging or not — it is a recovery action', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({ score: { 1: { game_id: 'g9' } }, match: {}, postgame: {} });
        ui(<BoardDesk board={1} />);
        fireEvent.click(screen.getByRole('button', { name: /Capture finished game/ }));
        expect(fetch).toHaveBeenCalledWith(
            '/api/v1/postgame/capture?scoreboard=1', { method: 'POST' },
        );
        expect(useStagingStore.getState().order).toEqual([]);
    });

    /*
     * A CAPTURE NEEDS A GAME ID TO MATCH A STAT FILE BY, so on an empty board the
     * press can only ever answer "No game id for this scoreboard yet"
     * (server/postgame/files.py `find_file`) — and it made that answer in the
     * app's most prominent colour, as a FILLED button, on every board a producer
     * had just cleared. The hand-picked file is the way in when there is no id to
     * match: it captures WITHOUT one, which is the whole reason that hatch
     * exists, so it stays live beside the disabled press.
     */
    it('will not offer a capture on a board with no game, but keeps the file hatch', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({ score: { 1: {} }, match: {}, postgame: {} });
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: /Capture finished game/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Pick a file/ })).toBeEnabled();
    });

    /*
     * EXACTLY ONE FILLED PRESS PER PANEL, AND IT IS THE FORWARD MOVE — the clear,
     * or the take. This region is recovery: the stat file fires the capture on
     * its own, and the press a producer makes at the end of a game is the
     * turnover bar's own Capture, which is a ghost. A filled one down here was
     * the louder of the two, for the rarer act.
     */
    it('never draws the recovery capture as the panel’s filled press', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({ score: { 1: { game_id: 'g9' } }, match: {}, postgame: {} });
        ui(<BoardDesk board={1} />);
        // `bg-rio-500` is the console's filled press — the brand red the clear
        // and the take wear on the turnover bar above.
        const capture = screen.getByRole('button', { name: /Capture finished game/ });
        expect(capture.className).not.toContain('bg-rio-500');
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

    /*
     * A CAPTURE IS THE ONE THING ON A BOARD THAT WRITES ANOTHER MODEL — it moves
     * the fixture to `post` and credits the series, which is what decides a Bo1.
     * The console said so nowhere: the fixture's badge changed a row away, which
     * shows the RESULT and never the cause, so "scoreboards decide things in the
     * match" was a rule of the app nobody had been told.
     *
     * The evidence is `match.{m}.credited` — the per-game record that makes
     * crediting idempotent — because it answers the exact question ("did THIS box
     * score do it") rather than the adjacent one ("is the match decided").
     */
    it('says what the capture did to the match, in the region that did it', () => {
        board(
            { 1: { game_id: 'G1', game_over: true, match: 2, player: { 1: { rioName: 'Alice' } } } },
            { 1: { present: true, gameId: 'G1', capturedBy: 'auto', player: {} } },
        );
        useStateStore.setState({
            score: useStateStore.getState().score,
            match: {
                2: {
                    stage: 'post', decided: 2, format: { bestOf: 1 },
                    credited: { G1: 2 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('M2 decided — Bob')).toBeInTheDocument();
    });

    /*
     * ...and the case worth reporting is the one where it did NOTHING. A quit
     * game reports no winner, so the capture credits nothing and leaves a Bo1 at
     * 0-0 — the state that reads as "the app forgot", and the only one a producer
     * has to act on by hand.
     */
    it('says when a capture advanced nothing, rather than going quiet', () => {
        board(
            { 1: { game_id: 'G1', game_over: true, match: 2, player: { 1: { rioName: 'Alice' } } } },
            { 1: { present: true, gameId: 'G1', capturedBy: 'auto', player: {} } },
        );
        useStateStore.setState({
            score: useStateStore.getState().score,
            match: {
                2: {
                    stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('M2 not advanced by this capture')).toBeInTheDocument();
        // ...and NOT the Bo3 phrase that used to fill this silence.
        expect(screen.queryByText('between games')).not.toBeInTheDocument();
    });

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
     * already builds auto-capture on it (server/postgame/watch.py).
     */
    it('takes a capture for this game as the game being over', () => {
        expect(boardLifecycle({ gameId: 'G1', captured: true })).toBe('final');
        // It outranks `stranded` too: a parsed final box score is stronger
        // evidence than the server having stopped polling.
        expect(boardLifecycle({ gameId: 'G1', captured: true, liveFollowing: false })).toBe('final');
        expect(boardLifecycle({ gameId: 'G1', captured: false })).toBe('live');
    });

    /*
     * MID-SERIES, THE BAR MUST NOT OFFER THE NEXT FIXTURE.
     *
     * Game 1 of a Bo3 ends: the board is final and the fixture is undecided, which
     * is the state the bar exists for — and its take was gated on `decided` alone,
     * so it sat under a live 1–0 series offering to put the NEXT match on the
     * board. One press from replacing a match still being played.
     *
     * The existing "between games" test could not catch this: it seeds a board with
     * no `game_id`, so the bar never renders there at all.
     */
    it('offers no handover while the series can still continue', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { game_id: 'G1', game_over: true, match: 2 } },
            postgame: {},
            match: {
                2: {
                    stage: 'post', format: { bestOf: 3 }, series: { 1: 1, 2: 0 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [2, 5] },
        });
        ui(<BoardDesk board={1} />);
        // The bar IS up — the game is over and wants capturing and clearing.
        expect(screen.getByRole('button', { name: /Clear game/ })).toBeInTheDocument();
        // ...but nothing hands the board to the next fixture.
        expect(screen.queryByRole('button', { name: /Put on board/ })).not.toBeInTheDocument();
        // And it says why, where the take would have been: a bar that simply omits
        // its third button leaves the producer looking for it. A badge, like
        // everything else on this strip — the sentence it used to end with
        // ("— same match stays up") is in its title.
        expect(screen.getByText(/GAME 2\s+OF 3/)).toBeInTheDocument();
    });

    /*
     * A Bo1 is the other half and keeps its take at game end. `default_match()` is
     * `{bestOf: 1}`, so gating on `decided` would hide the producer's next press
     * behind the capture that sets it — which is what the take was ungated for.
     */
    it('offers the handover on a Bo1 the moment the game is over', () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { game_id: 'G1', game_over: true, match: 2 } },
            postgame: {},
            match: {
                2: {
                    stage: 'post', format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
                5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } },
            },
            schedule: { queue: [2, 5] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: /Put on board/ })).toBeInTheDocument();
        expect(screen.queryByText(/GAME \d+ OF \d+/)).not.toBeInTheDocument();
    });

    // A board that booted holding last night's game raises the same bar: clearing
    // and handing over are exactly the two presses that moment wants.
    it('raises the turnover bar on a board that booted holding an old game', () => {
        board({
            1: {
                game_id: 'yesterday', restored: true, inning: 6,
                // Last night's players persisted with the rest of it — which is
                // the whole shape of the problem, and what GameSlot keys its
                // "is there anything here" branch on.
                player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
            },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('OLD')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear game/ })).toBeInTheDocument();
    });

    /*
     * THE BAR LEADS WITH NOTHING. IT IS THE PRESSES.
     *
     * On a board carrying a game from a previous session it opened with
     * "Captured automatically." — a receipt for something that happened last
     * night, on the one strip a producer reads to find out what to do now, an inch
     * under a chip shouting OLD. Naming the condition instead ("Left over from
     * before PRSH started.") only moved the duplication: that is the chip's own
     * job, in the chip's own words, one row up — so three stacked rows opened
     * with the same matchup and the third opened with prose about it. The strip
     * carries verbs; every surface here already owns its fact.
     */
    it('leads with the presses, not a sentence about the board', () => {
        board(
            {
                1: {
                    game_id: 'yesterday', restored: true, inning: 6,
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            { 1: { present: true, gameId: 'yesterday', capturedBy: 'auto', player: {} } },
        );
        ui(<BoardDesk board={1} />);
        // The condition is the chip's, and the capture is the Post-game region's
        // — the bar restates neither.
        expect(screen.getByText('OLD')).toBeInTheDocument();
        expect(screen.queryByText(/Left over from before PRSH started/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Captured automatically/)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear game/ })).toBeInTheDocument();
    });

    /*
     * ONLY A GAME THAT REACHED ITS END HAS A RESULT TO CAPTURE — which is what the
     * chip's own words already say. A restored game's capture belongs to a previous
     * session (the post-game region's file picker is that recovery) and a stalled
     * one has no result at all, so offering the press on either is the bar talking
     * about stat files at the moment it is meant to be giving an instruction.
     */
    it('offers Capture only where there is a result to capture', () => {
        board({ 1: { game_id: 'yesterday', restored: true, player: { 1: { rioName: 'Alice' } } } });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByRole('button', { name: /^Capture$/ })).not.toBeInTheDocument();

        cleanup();
        board({ 1: { game_id: 'G1', live_following: false, player: { 1: { rioName: 'Alice' } } } });
        ui(<BoardDesk board={1} />);
        expect(screen.getByText('STALLED')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Capture$/ })).not.toBeInTheDocument();

        cleanup();
        board({ 1: { game_id: 'G1', game_over: true, player: { 1: { rioName: 'Alice' } } } });
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: /^Capture$/ })).toBeInTheDocument();
    });

    /*
     * "I CLEARED IT AND IT CAME BACK." Over a DECIDED fixture the plain clear
     * blanked the board and the Match projector repainted the fixture's two names
     * onto it, so the scoreboard went back to drawing a finished matchup at 0-0.
     * The clear takes the fixture with it exactly when the fixture has no further
     * game to give, and the LABEL says which of the two it is doing — a producer
     * has to be able to tell from the button what their board will hold after it.
     */
    it('takes a finished fixture off the board, and says that is what it does', async () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { game_id: 'G1', game_over: true, match: 2, player: { 1: { rioName: 'Alice' } } } },
            postgame: {},
            match: {
                2: {
                    stage: 'post', decided: 1, format: { bestOf: 1 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            schedule: { queue: [2] },
        });
        ui(<BoardDesk board={1} />);
        // IT NAMES THE FIXTURE IT WILL TAKE OFF. `Clear board` vs `Clear game`
        // was two names for two acts, which is the right shape — but the whole
        // difference between them was one word for a container the producer has
        // to already know includes the match, and the question they were asking
        // the button ("does this detach M2, or not?") is the one it answered
        // least. Now the second act is IN the label, and only in the state where
        // it happens.
        fireEvent.click(screen.getByRole('button', { name: 'Clear & unbind M2' }));
        await waitFor(() => {
            expect(global.fetch.mock.calls.some(
                ([url, opt]) => /clear-game\?release_match=true/.test(String(url))
                    && opt?.method === 'POST',
            )).toBe(true);
        });
    });

    /*
     * ...and a fixture that can still continue KEEPS its binding, which is the
     * whole reason the endpoint re-projects. A Bo3 between games must not be
     * unbound by the press that tidies game 1's numbers.
     */
    it('leaves a live series bound, and says that too', async () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { game_id: 'G1', game_over: true, match: 2, player: { 1: { rioName: 'Alice' } } } },
            postgame: {},
            match: {
                2: {
                    stage: 'post', format: { bestOf: 3 }, series: { 1: 1, 2: 0 },
                    player: { 1: { rioName: 'Alice' }, 2: { rioName: 'Bob' } },
                },
            },
            schedule: { queue: [2] },
        });
        ui(<BoardDesk board={1} />);
        expect(screen.queryByRole('button', { name: /unbind/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Clear game/ }));
        await waitFor(() => {
            expect(global.fetch.mock.calls.some(
                ([url]) => /clear-game\?release_match=false/.test(String(url)),
            )).toBe(true);
        });
    });

    /*
     * EXACTLY ONE FILLED PRESS, AND IT IS THE FORWARD MOVE. With nothing waiting,
     * clearing is the move and wears the fill. With a fixture waiting the take is,
     * and the clear stands down to a ghost beside it — because taking one clears
     * the board on its way (`_clear_superseded_game`), so a producer who presses
     * the loud button has not skipped a step.
     */
    it('fills the press that moves the night forward, and only that one', () => {
        board({ 1: { game_id: 'yesterday', restored: true, player: { 1: { rioName: 'Alice' } } } });
        ui(<BoardDesk board={1} />);
        expect(screen.getByRole('button', { name: /Clear game/ }))
            .toHaveAttribute('data-variant', 'default');

        cleanup();
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        useStateStore.setState({
            score: { 1: { game_id: 'yesterday', restored: true, player: { 1: { rioName: 'Alice' } } } },
            postgame: {},
            match: { 5: { stage: 'draft', player: { 1: { rioName: 'Cara' }, 2: { rioName: 'Dev' } } } },
            schedule: { queue: [5] },
        });
        ui(<BoardDesk board={1} />);
        // ONE take, from the slot that names the fixture — not one there and a
        // second identical one on the bar, which is what a stale UNBOUND board
        // drew until the invariant covered all three sites.
        const takes = screen.getAllByRole('button', { name: /Put on board/ });
        expect(takes).toHaveLength(1);
        expect(takes[0]).toHaveAttribute('data-variant', 'default');
        expect(screen.getByRole('button', { name: /Clear game/ }))
            .toHaveAttribute('data-variant', 'ghost');
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
        expect(screen.getByRole('button', { name: /Clear game/ })).toBeInTheDocument();
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
        // "Nothing captured" is the Post-game region's readout and stays there.
        // What the bar must not do is print a second copy of it beside its own
        // Capture button.
        expect(screen.getAllByText(/Nothing captured/)).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear game/ })).toBeInTheDocument();
    });

    it('distinguishes a game the feed LOST from one that finished', () => {
        // A quit or a crash is not a clean finish, and it is the case where a
        // producer may still want to capture by hand.
        board({ 1: { game_id: 'G1', live_following: false, player: { 1: { rioName: 'rjb' } } } });
        ui(<BoardDesk board={1} />);
        // A quit is ENDED, a clean finish is FINAL — we know it is not coming
        // back, not that it finished. Both still raise the turnover bar, because
        // a stranded game is exactly where a hand capture is wanted.
        expect(screen.getByText('STALLED')).toBeInTheDocument();
        expect(screen.queryByText('FINAL')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear game/ })).toBeInTheDocument();
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
        const clears = screen.getAllByRole('button', { name: /Clear game/ });
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
     * first of the three presses. Once it has happened the bar simply stops
     * offering it — the stat file usually fires it on its own, and the receipt
     * belongs to the Post-game region, which prints it properly (AUTO, both
     * names, the final score). A second copy on the turnover strip was a
     * sentence where a verb goes.
     */
    it('drops the capture once it has happened, and prints no receipt for it', () => {
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
        expect(screen.queryByText(/Captured automatically/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Capture' })).not.toBeInTheDocument();
        // The box score and its provenance are printed once, by the post-game
        // region below.
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
        // And exactly ONE clear on the panel.
        expect(screen.getAllByRole('button', { name: /Clear game/ })).toHaveLength(1);
    });

    /*
     * ONE PRESS, ONE PLACE. The turnover group returned null off `isStaleBoard`
     * and a second `Clear game` in the game-state region covered every other
     * time, so there was always exactly one clear on the panel and it was in a
     * DIFFERENT PLACE depending on lifecycle. What a producer saw was the button
     * moving: press Clear at the top, the board empties, and the clear they just
     * used is now at the bottom of the panel.
     */
    it.each([
        ['empty', {}],
        ['live', { game_id: 'G1', inning: 4, player: { 1: { rioName: 'rjb' } } }],
        ['final', { game_id: 'G1', game_over: true, player: { 1: { rioName: 'rjb' } } }],
    ])('keeps the clear in one place on a %s board', (_lifecycle, score) => {
        board({ 1: score });
        ui(<BoardDesk board={1} />);
        const clear = screen.getAllByRole('button', { name: /Clear game/ });
        expect(clear).toHaveLength(1);
        // On the SUBJECT ROW, above the game-state fields — never the hatch at
        // the foot of the region, which is where it used to land once the board
        // was no longer stale.
        const stadium = screen.getByText('Stadium');
        expect(clear[0].compareDocumentPosition(stadium))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

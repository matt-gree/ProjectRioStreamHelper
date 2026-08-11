import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { SocketContext } from '../../context/socket';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import BoardDesk from './desks/board';
import MatchDesk from './desks/match';
import ScheduleStage from './stage/schedule';
import { useNextUp, useQueueOrder, useWaitingCount } from './queue';

/*
 * The queue, from the board's side.
 *
 * `useNextUp` is a PREVIEW of the server's `Schedule.next_up` — it exists so the
 * button can name the fixture it will put up, and the two rules have to stay in
 * step (tests/unit/api/test_schedule_next.py pins the server half). The take
 * itself never sends an id: the server re-resolves under a lock.
 */

const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
const ui = (node) => render(
    <SocketContext value={{ socket }}>
        <TooltipProvider>{node}</TooltipProvider>
    </SocketContext>,
);

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
    useStagingStore.setState({ pending: {}, order: [] });
    useSettingsStore.setState({
        project_rio: { hud_enabled: false },
        production: {},
        scoreboards: { active: [1, 2], aliases: {}, binding: {} },
    });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const fixture = (n1, n2, over = {}) => ({
    stage: 'draft', format: { bestOf: 3 }, series: { 1: 0, 2: 0 },
    player: { 1: { rioName: n1 }, 2: { rioName: n2 } }, ...over,
});

const state = (over = {}) => useStateStore.setState({
    score: {}, match: {}, schedule: {}, ...over,
});

// A probe, so the hooks are tested through React the way they run.
function Probe() {
    const next = useNextUp();
    const waiting = useWaitingCount();
    const order = useQueueOrder();
    return (
        <span data-testid="probe">
            {next ? `${next.id}:${next.label}` : 'none'}|{waiting}|{order.join(',')}
        </span>
    );
}
const probe = () => screen.getByTestId('probe').textContent.split('|').slice(0, 2).join('|');
const orderOf = () => screen.getByTestId('probe').textContent.split('|')[2];

describe('useNextUp', () => {
    it('is the first queued fixture waiting for a board', () => {
        state({
            match: { 1: fixture('Alice', 'Bob'), 2: fixture('Carol', 'Dave') },
            schedule: { queue: [1, 2] },
        });
        ui(<Probe />);
        expect(probe()).toBe('1:Alice vs Bob|2');
    });

    it('is nothing when the queue is empty', () => {
        state({ match: { 1: fixture('Alice', 'Bob') } });
        ui(<Probe />);
        expect(probe()).toBe('none|0');
    });

    // A match fills exactly one board, so one already on air is not waiting.
    it('skips a fixture a board already holds', () => {
        state({
            score: { 1: { match: 1 } },
            match: { 1: fixture('Alice', 'Bob'), 2: fixture('Carol', 'Dave') },
            schedule: { queue: [1, 2] },
        });
        ui(<Probe />);
        expect(probe()).toBe('2:Carol vs Dave|1');
    });

    /*
     * `decided` is the finished test. NOT `stage` — a Bo3 sits at `stage: post`
     * between games and is still very much the current fixture, so asking stage
     * whether a FIXTURE is done gets the wrong answer half the time.
     */
    it('skips a decided fixture', () => {
        state({
            match: { 1: fixture('Alice', 'Bob', { decided: 1 }), 2: fixture('Carol', 'Dave') },
            schedule: { queue: [1, 2] },
        });
        ui(<Probe />);
        expect(probe()).toBe('2:Carol vs Dave|1');
    });

    /*
     * The anti-bounce rule. Without it, moving a board off an undecided fixture
     * leaves it queued, unbound and undecided — so it is immediately "next" again
     * and the verb ping-pongs between two matches.
     */
    it('does not offer a fixture that has already started as fresh', () => {
        state({
            match: { 1: fixture('Alice', 'Bob', { stage: 'live' }), 2: fixture('Carol', 'Dave') },
            schedule: { queue: [1, 2] },
        });
        ui(<Probe />);
        expect(probe()).toBe('2:Carol vs Dave|1');
    });

    it('ignores a queued id whose match is gone', () => {
        state({ match: { 2: fixture('Carol', 'Dave') }, schedule: { queue: [9, 2] } });
        ui(<Probe />);
        expect(probe()).toBe('2:Carol vs Dave|1');
    });

    // Nothing in the queue is waiting: everything is on a board or finished. The
    // count is what tells a producer that, so it must not read as "queue empty".
    it('counts nothing waiting when every fixture is placed or done', () => {
        state({
            score: { 1: { match: 1 } },
            match: { 1: fixture('Alice', 'Bob'), 2: fixture('Carol', 'Dave', { decided: 2 }) },
            schedule: { queue: [1, 2] },
        });
        ui(<Probe />);
        expect(probe()).toBe('none|0');
    });

    it('falls back to the round label when a fixture has no names yet', () => {
        state({
            match: { 1: fixture('', '', { label: 'Winners R2' }) },
            schedule: { queue: [1] },
        });
        ui(<Probe />);
        expect(probe()).toBe('1:Winners R2|1');
    });
});

describe('Up next on a board', () => {
    it('names the fixture it will put up, rather than saying Next', () => {
        state({
            match: { 1: fixture('Alice', 'Bob') },
            schedule: { queue: [1] },
        });
        ui(<BoardDesk board={2} />);
        expect(screen.getByRole('button', { name: /Up next · Alice vs Bob/ })).toBeInTheDocument();
    });

    /*
     * The take is momentary — a producer pressing it at the end of a game means
     * now, the same rule as Take and the rotation transport. And it sends NO id:
     * the server resolves and binds under one lock, so two boards pressed together
     * can't land on the same fixture.
     */
    it('takes the next fixture immediately, and sends no match id', async () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1, 2], aliases: {}, binding: {} },
        });
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [1] } });
        ui(<BoardDesk board={2} />);
        fireEvent.click(screen.getByRole('button', { name: /Up next/ }));

        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            '/api/v1/scoreboards/2/next-match',
            expect.objectContaining({ method: 'POST' }),
        ));
        const call = fetch.mock.calls.find(c => String(c[0]).includes('next-match'));
        expect(JSON.parse(call[1].body)).toEqual({});
        expect(useStagingStore.getState().order).toEqual([]);
    });

    // Nothing waiting: no button. A disabled one would be a control whose whole
    // job is to explain that there is nothing to do.
    it('is absent when nothing in the queue is waiting', () => {
        state({ match: { 1: fixture('Alice', 'Bob', { decided: 1 }) }, schedule: { queue: [1] } });
        ui(<BoardDesk board={2} />);
        expect(screen.queryByRole('button', { name: /Up next/ })).not.toBeInTheDocument();
    });

    // The bind line is the thing the verb changes, so it sits beside it — and an
    // unbound board says so rather than leaving the row blank.
    it('says a board has no match beside the verb', () => {
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [1] } });
        ui(<BoardDesk board={2} />);
        expect(screen.getByText('No match on this board')).toBeInTheDocument();
    });
});

/*
 * THE RUNNING ORDER IS AUTHORED ON THE MATCH DESK.
 *
 * It used to be authored inside the Upcoming Schedule element's stage panel — a
 * ticker's settings — which made tonight's order a second list of the same
 * matches, in a different place from the fixtures it orders, free to disagree with
 * the desk's stack. These tests pin that there is now exactly one place to change
 * it, and that the desk's stack IS the order.
 */
describe('useQueueOrder', () => {
    it('is the queue, in order', () => {
        state({
            match: { 1: fixture('Alice', 'Bob'), 2: fixture('Carol', 'Dave') },
            schedule: { queue: [2, 1] },
        });
        ui(<Probe />);
        expect(orderOf()).toBe('2,1');
    });

    // The server prunes a deleted match from the queue, but a client can see the
    // two writes out of order — a position with no fixture is not a position.
    it('drops a queued id whose match is gone, and de-duplicates', () => {
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [9, 1, 1] } });
        ui(<Probe />);
        expect(orderOf()).toBe('1');
    });
});

describe('The Match desk owns the running order', () => {
    const three = () => state({
        match: {
            1: fixture('Alice', 'Bob'),
            2: fixture('Carol', 'Dave'),
            3: fixture('Erin', 'Frank'),
        },
        schedule: { queue: [3, 1] },
    });

    // The stack is the order: queued first in queue order, then whatever is not
    // enrolled. Read the position numbers rather than the names — the number is
    // the claim being made.
    it('stacks the matches in queue order, unenrolled ones last', () => {
        three();
        ui(<MatchDesk />);
        const rows = screen.getAllByRole('button', { name: /^(Take match|Add match) \d+/ });
        expect(rows.map(b => b.getAttribute('aria-label'))).toEqual([
            'Take match 3 out of the running order',
            'Take match 1 out of the running order',
            'Add match 2 to the running order',
        ]);
    });

    /*
     * The number is the claim this row makes, and it needs a name: a bare "1"
     * between two arrows reads as loose content, so the position rides a labelled
     * group and the digit itself is aria-hidden.
     */
    it('numbers each queued row with its place in the order', () => {
        three();
        ui(<MatchDesk />);
        expect(screen.getByRole('group', { name: 'Match 3: position 1 of 2 in the running order' }))
            .toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Match 1: position 2 of 2 in the running order' }))
            .toBeInTheDocument();
        // The unenrolled match has no position at all, not position 3.
        expect(screen.queryByRole('group', { name: /Match 2: position/ })).not.toBeInTheDocument();
    });

    /*
     * Reorder asks the server to move ONE match. Sending the whole reordered list
     * back would drop anything added between this client's read and its write —
     * and creating a match now enrols it, so that window is real
     * (tests/unit/api/test_schedule_queue.py pins the server half).
     */
    it('moves one match by id rather than sending the whole order back', async () => {
        three();
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: /Move match 1 in the running order up/ }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            '/api/v1/schedule/queue/1/move?delta=-1',
            expect.objectContaining({ method: 'POST' }),
        ));
    });

    // The arrows bound at the ends of the queue, not the ends of the stack — the
    // unenrolled group below has no position to swap with.
    it('will not move the first match up or the last queued match down', () => {
        three();
        ui(<MatchDesk />);
        expect(screen.getByRole('button', { name: /Move match 3 in the running order up/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Move match 1 in the running order down/ })).toBeDisabled();
    });

    it('takes a match out of the order, and puts one back', async () => {
        three();
        ui(<MatchDesk />);
        fireEvent.click(screen.getByRole('button', { name: 'Take match 3 out of the running order' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            '/api/v1/schedule/queue/3', expect.objectContaining({ method: 'DELETE' }),
        ));
        fireEvent.click(screen.getByRole('button', { name: 'Add match 2 to the running order' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            '/api/v1/schedule/queue/2', expect.objectContaining({ method: 'POST' }),
        ));
    });

    // Normally every fixture is enrolled (creating one appends it), so the divider
    // would be furniture on the common case.
    it('explains the second group only when something is out of the order', () => {
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [1] } });
        ui(<MatchDesk />);
        expect(screen.queryByText(/Not in the running order/)).not.toBeInTheDocument();
        cleanup();
        three();
        ui(<MatchDesk />);
        expect(screen.getByText(/Not in the running order/)).toBeInTheDocument();
    });
});

/*
 * THE LIFECYCLE, made visible and reversible.
 *
 * `stage` decides whether a fixture is ever offered to a board, and it had no
 * producer-facing writer at all: `note_live` promotes draft→live on the first feed
 * event, the post-game paths set `post`, and the desk showed the result as a
 * read-only word. A fixture fed once and then unbound was therefore queued,
 * unbound, undecided — and silently never offered again.
 *
 * The reasons are mirrored from `Schedule.not_waiting_reason`, wording included
 * (tests/unit/api/test_schedule_waiting.py pins the server half).
 */
describe('The Match desk states — and can change — a fixture’s lifecycle', () => {
    const openStage = (m = 1) => fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`^Match ${m} lifecycle:`) }),
    );

    it('says a fresh fixture is waiting for a board', () => {
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [1] } });
        ui(<MatchDesk />);
        openStage();
        expect(screen.getByText(/Waiting for a board/)).toBeInTheDocument();
    });

    // The trap, from the console's side: nothing about this row used to say why
    // pressing Up next did nothing.
    it('says a played fixture is not up next, and why', () => {
        state({ match: { 1: fixture('Alice', 'Bob', { stage: 'live' }) }, schedule: { queue: [1] } });
        ui(<MatchDesk />);
        openStage();
        expect(screen.getByText(/it has already been played/)).toBeInTheDocument();
    });

    it('sets a played fixture back to draft, which is the way out of the strand', async () => {
        state({ match: { 1: fixture('Alice', 'Bob', { stage: 'live' }) }, schedule: { queue: [1] } });
        ui(<MatchDesk />);
        openStage();
        fireEvent.click(screen.getByRole('button', { name: 'draft' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            '/api/v1/match/1',
            expect.objectContaining({ method: 'PUT', body: JSON.stringify({ stage: 'draft' }) }),
        ));
    });

    /*
     * Momentary, not staged — this file's rule is that lifecycle hops run
     * immediately (the same as Next game), because a stage change corrects what
     * already happened rather than composing something to preview.
     */
    it('changes the stage immediately rather than staging it', async () => {
        // Confirm mode ON, so "nothing staged" is a real result rather than the
        // only thing that could have happened.
        useSettingsStore.setState({
            project_rio: { hud_enabled: false },
            production: { confirm: { enabled: true } },
            scoreboards: { active: [1, 2], aliases: {}, binding: {} },
        });
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [1] } });
        ui(<MatchDesk />);
        openStage();
        fireEvent.click(screen.getByRole('button', { name: 'post' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(
            '/api/v1/match/1', expect.objectContaining({ method: 'PUT' }),
        ));
        expect(Object.keys(useStagingStore.getState().pending)).toHaveLength(0);

        // And confirm mode really is on: a control that DOES stage, staging. Without
        // this the assertion above would hold just as well with the flag misspelled.
        fireEvent.click(screen.getByRole('button', { name: 'Flip sides on match 1' }));
        expect(Object.keys(useStagingStore.getState().pending)).toEqual(['match:1:flip']);
    });

    // Membership outranks the four fixture conditions: a match taken out of the
    // order is not offered whatever state it is in, so saying "waiting" would be a
    // lie even though every condition passes.
    it('reports membership ahead of the fixture’s own state', () => {
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [] } });
        ui(<MatchDesk />);
        openStage();
        expect(screen.getByText(/it is not in the running order/)).toBeInTheDocument();
        expect(screen.queryByText(/Waiting for a board/)).not.toBeInTheDocument();
    });

    it('names the board already holding a bound fixture', () => {
        state({
            match: { 1: fixture('Alice', 'Bob') },
            schedule: { queue: [1] },
            score: { 2: { match: 1 } },
        });
        ui(<MatchDesk />);
        openStage();
        expect(screen.getByText(/it is already on board 2/)).toBeInTheDocument();
    });
});

/*
 * The ticker's panel keeps what is genuinely the OVERLAY's — its heading and each
 * match's display time — and nothing that changes the order. One place to edit it.
 */
describe('The Upcoming Schedule panel no longer authors the order', () => {
    const element = { id: 'schedule', name: 'Upcoming Schedule' };

    beforeEach(() => {
        state({
            match: { 1: fixture('Alice', 'Bob'), 2: fixture('Carol', 'Dave') },
            schedule: { queue: [2, 1], title: 'Tonight' },
        });
    });

    it('has no reorder, remove or add controls', () => {
        ui(<ScheduleStage element={element} />);
        expect(screen.queryByRole('button', { name: /Move .* up/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Remove from queue/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Add match to schedule/ })).not.toBeInTheDocument();
    });

    it('keeps the heading and a display time per match, and says where the order lives', () => {
        ui(<ScheduleStage element={element} />);
        expect(screen.getByDisplayValue('Tonight')).toBeInTheDocument();
        expect(screen.getByLabelText('Display time for match 2')).toBeInTheDocument();
        expect(screen.getByLabelText('Display time for match 1')).toBeInTheDocument();
        expect(screen.getByText(/order set on the Match desk/)).toBeInTheDocument();
    });

    it('reads the order rather than owning it', () => {
        ui(<ScheduleStage element={element} />);
        // Carol vs Dave is queued first, so it draws first.
        const names = screen.getAllByText(/vs/).map(n => n.textContent);
        expect(names[0]).toMatch(/Carol vs Dave/);
    });
});

/*
 * The rail card is capped at two rows and the subject takes one, so the action row
 * is a budget. Up next displaces Re-read HUD, never Swap sides: swap is the
 * correction a producer makes most often mid-game, and anything sitting in the
 * queue would otherwise take it off the card for the whole night.
 */
describe('Up next on a rail card', () => {
    const railFace = async (board) => {
        const { deskQuickFace } = await import('./quickface');
        const { boardDeskId } = await import('./boards');
        const Face = deskQuickFace(boardDeskId(board));
        ui(<Face id={boardDeskId(board)} />);
    };

    it('keeps Swap sides when it offers the next fixture', async () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [1] } });
        await railFace(1);
        expect(screen.getByRole('button', { name: 'Up next' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Swap sides' })).toBeInTheDocument();
        // Re-read is the one that steps aside — it's a recovery path, and the panel
        // still has it.
        expect(screen.queryByRole('button', { name: /Re-read/ })).not.toBeInTheDocument();
    });

    // The card has no room to spell the fixture out beside a second button, so the
    // name lives in the tooltip and the panel is where it is written in full.
    it('names the fixture in the tooltip rather than the label', async () => {
        state({ match: { 1: fixture('Alice', 'Bob') }, schedule: { queue: [1] } });
        await railFace(1);
        expect(screen.getByRole('button', { name: 'Up next' }))
            .toHaveAttribute('title', expect.stringContaining('Alice vs Bob'));
    });

    it('falls back to swap and re-read when nothing is waiting', async () => {
        useSettingsStore.setState({
            project_rio: { hud_enabled: true },
            production: {},
            scoreboards: { active: [1], aliases: {}, binding: {} },
        });
        state({ match: {}, schedule: {} });
        await railFace(1);
        expect(screen.queryByRole('button', { name: 'Up next' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Swap sides' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Re-read HUD/ })).toBeInTheDocument();
    });
});

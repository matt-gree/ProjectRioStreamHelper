import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { ELEMENTS } from './elements';
import { QuickFace } from './quickface';
import { SAMPLE_CONTAINER_DEFS, withContainers } from '../../test/containers';

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: withContainers() });
    useStateStore.setState({ score: {}, production: {}, postgame: {} });
    useStagingStore.setState({ pending: {}, order: [] });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const el = (id) => ELEMENTS.find(e => e.id === id);

/*
 * A pinned MEMBER'S SLOT — the card for an element's place on a container,
 * which is what the fed face belongs to. A pin of the element's own source
 * gets the direct face instead (see placementFlavor in ./sources/placements), which is
 * the whole point: Push is the slot's verb, not the element's.
 */
const slot = (container) => ({
    scene: 'Main', where: 'program', item: null,
    slot: container, container, parent: `container:${container}@Main`,
});

const ui = (id, placement = slot(defaultContainerFor(id))) => render(
    <TooltipProvider>
        <QuickFace element={el(id)} placement={placement} bindings={{}} />
    </TooltipProvider>,
);

// Which container the shared test rig rosters this member on.
function defaultContainerFor(id) {
    const entry = Object.entries(SAMPLE_CONTAINER_DEFS)
        .find(([, d]) => d.members?.includes(id));
    return entry ? entry[0] : null;
}

/*
 * A rail card is the producer's one-glance control. A fed card that can only
 * re-push what the stage last picked is dead weight on its own — a pinned
 * pickable element has to be able to choose.
 *
 * The exemplar is the Character Spotlight, which is now the only pickable feed.
 * It was the fed Stats bar, an element that no longer exists: `stats` is the
 * dedicated per-side Stats source, and a direct source has no Push at all.
 */
const ch = (name) => ({ name, batting: { singles: 0, doubles: 0, triples: 0, homeruns: 0, rbi: 0 } });

const captureLoaded = () => useStateStore.setState({
    postgame: {
        1: {
            present: true,
            meta: { winnerSide: 1 },
            player: {
                1: { rioName: 'left', characters: [ch('Peach'), ch('Daisy')] },
                2: { rioName: 'right', characters: [ch('Wario')] },
            },
        },
    },
});

describe('fed quick faces', () => {
    it('a pickable element offers its content choices on the card', () => {
        captureLoaded();
        ui('postgamecallout');
        const select = screen.getByRole('combobox');
        const labels = [...select.options].map(o => o.textContent);
        // Grouped options flatten to "Side — Character" so one row can carry them.
        expect(labels).toContain('left — Daisy');
        expect(labels).toContain('right — Wario');
        // Off air there is no feed to clear, so no "Nothing fed" option.
        expect(labels).not.toContain('Nothing fed');
        // …and a Push button to air the armed pick.
        expect(screen.getByRole('button', { name: /Push/ })).toBeInTheDocument();
    });

    it('picking arms the card without airing it — Push is a separate act', () => {
        captureLoaded();
        ui('postgamecallout');
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1:1' } });
        // Armed, not aired: the intent records the pick, the container stays empty.
        expect(useStateStore.getState()?.production?.feed?.last?.postgamecallout)
            .toMatchObject({ element: 'postgamecallout', team: 1, charIndex: 1 });
        expect(useStateStore.getState()?.production?.feed?.container).toBeUndefined();
        // Push airs it.
        fireEvent.click(screen.getByRole('button', { name: /Push/ }));
        const feed = useStateStore.getState()?.production?.feed?.container;
        expect(Object.values(feed ?? {})[0])
            .toMatchObject({ element: 'postgamecallout', team: 1, charIndex: 1 });
    });

    it('says why there is nothing to pick rather than showing an empty select', () => {
        ui('postgamecallout');
        expect(screen.getByText(/No captured game on scoreboard 1 yet/)).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('an element with nothing to pick still offers push', () => {
        ui('postgamevs');
        expect(screen.getByRole('button', { name: /Push/ })).toBeEnabled();
    });

    /*
     * The same element pinned from its OWN source is a direct card: what it is
     * drawing, and whether it is on. No Push — there is nothing to push into,
     * which is exactly the state the old model could not express.
     */
    it('a member pinned from its own source gets the direct face, not a push', () => {
        const own = {
            scene: 'Main',
            where: 'program',
            element: el('postgamecallout'),
            item: {
                id: 1, sourceName: 'Spotlight', enabled: true, isPrsh: true,
                url: 'http://x/layout/postgame/spotlight.html',
            },
        };
        ui('postgamecallout', own);
        expect(screen.queryByRole('button', { name: /Push|Clear/ })).not.toBeInTheDocument();
        expect(screen.getByText(/Nothing picked yet/)).toBeInTheDocument();
        // Show/hide is the card header's eye (../rail), not a face row.
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });
});

/*
 * A DECLARED LOOK — the element's own `quickSettings`, drawn as the stage draws
 * them, writing the namespace the stage writes.
 */
describe('setting quick faces', () => {
    const board = (id, variant, extra = {}) => ({
        scene: 'Main', where: 'program', element: el(id), board: 1, variant,
        item: { id: 1, sourceName: id, enabled: true, isPrsh: true, url: `http://x/${id}` },
        ...extra,
    });
    const face = (id, placement) => render(
        <TooltipProvider>
            <QuickFace element={el(id)} placement={placement} board={placement.board} />
        </TooltipProvider>,
    );
    const chip = (name) => screen.queryByRole('button', { name });

    it('a Large scoreboard offers the parts Large draws, and none of Small\'s', () => {
        face('scoreboard', board('scoreboard', null));
        for (const n of ['Live Cluster', 'Stats', 'Rosters', 'Box Score']) expect(chip(n), n).toBeInTheDocument();
        for (const n of ['Inning', 'Game Mode', 'Team Logos']) expect(chip(n), n).not.toBeInTheDocument();
        // Short names on the chip, so four fit one strip at rail width.
        expect(chip('Box Score')).toHaveTextContent(/^Box$/);
        expect(chip('Live Cluster')).toHaveTextContent(/^Live$/);
    });

    it('a Small scoreboard offers Small\'s parts only', () => {
        face('scoreboard', board('scoreboard', 'zs'));
        for (const n of ['Inning', 'Live Cluster', 'Game Mode']) expect(chip(n), n).toBeInTheDocument();
        for (const n of ['Stats', 'Rosters', 'Box Score']) expect(chip(n), n).not.toBeInTheDocument();
    });

    it('carries no source toggle — the scoreboard is resident', () => {
        face('scoreboard', board('scoreboard', null));
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('a chip writes the pinned board\'s own namespace', () => {
        face('scoreboard', board('scoreboard', null, { board: 2 }));
        fireEvent.click(chip('Box Score'));
        expect(useSettingsStore.getState().overlays?.scoreboard?.[2]?.showBox).toBe(false);
    });

    it('a stat bar is who it draws plus its bottom line — no switch row', () => {
        face('statsbar', board('statsbar', 't1', { board: null }));
        expect(screen.queryByRole('switch')).not.toBeInTheDocument();
        // Unlabelled on the card — the row's tooltip names it, the options
        // name the choice, in their short rail names so three fit.
        expect(screen.getByTitle('Bottom Line')).toBeInTheDocument();
        for (const n of ['Game', 'Custom', 'Off']) expect(screen.getByText(n), n).toBeInTheDocument();
        expect(screen.queryByText('Game Line')).not.toBeInTheDocument();
        // The caption's text is stage work — the card only picks the mode.
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('the event header\'s two bands are one strip', () => {
        face('eventheader', board('eventheader', null, { board: null }));
        expect(chip('Header Band')).toBeInTheDocument();
        expect(chip('Footer Band')).toBeInTheDocument();
    });
});

describe('strip quick faces', () => {
    const own = (id) => ({
        scene: 'Main', where: 'program', element: el(id), board: null,
        item: { id: 1, sourceName: id, enabled: true, isPrsh: true, url: `http://x/${id}` },
    });
    const face = (id) => render(
        <TooltipProvider>
            <QuickFace element={el(id)} placement={own(id)} board={null} />
        </TooltipProvider>,
    );

    it('the lower third offers one chip per filled segment, lit while in the band', () => {
        useStateStore.setState({
            lowerthird: {
                slots: {
                    1: { type: 'logo', enabled: true },
                    2: { type: 'space', enabled: true },
                    3: { type: 'message', enabled: false },
                    4: { type: 'message', enabled: true },
                },
            },
        });
        face('lowerthird');
        expect(screen.getByRole('button', { name: 'Logo' })).toHaveAttribute('aria-pressed', 'true');
        // Two of a type are told apart by slot; a gap is not a segment.
        expect(screen.getByRole('button', { name: 'Message 3' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Message 4' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Space/ })).not.toBeInTheDocument();
    });

    it('a lower-third chip hides its segment', () => {
        useStateStore.setState({ lowerthird: { slots: { 1: { type: 'clock', enabled: true } } } });
        face('lowerthird');
        fireEvent.click(screen.getByRole('button', { name: 'Clock' }));
        expect(useStateStore.getState().lowerthird.slots[1].enabled).toBe(false);
    });

    it('the commentary card names its seated casters and says when there are none', () => {
        face('commentary');
        expect(screen.getByText('No casters seated')).toBeInTheDocument();
    });

    it('a seated caster is a named chip, lit while on the strip', () => {
        useStateStore.setState({
            commentary: {
                slots: [
                    { participantId: 'p1', visible: true },
                    { participantId: 'p2', visible: false },
                ],
                0: { name: 'Erin' },
                1: { name: 'Frank' },
            },
        });
        face('commentary');
        expect(screen.getByRole('button', { name: 'Erin' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Frank' })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('action quick faces', () => {
    const own = (id, board = 1) => ({
        scene: 'Main', where: 'program', element: el(id), board,
        item: { id: 1, sourceName: id, enabled: true, isPrsh: true, url: `http://x/${id}` },
    });
    const face = (id, board = 1) => render(
        <TooltipProvider>
            <QuickFace element={el(id)} placement={own(id, board)} board={board} />
        </TooltipProvider>,
    );

    it('the hit visualizer replays the pinned board\'s hit', () => {
        useStateStore.setState({ score: { 2: { hit: { path: [[0, 0, 0]], batter: 'Mario' } } } });
        face('hitvisualizer', 2);
        fireEvent.click(screen.getByRole('button', { name: /Replay/ }));
        expect(useStateStore.getState().score[2].hit.replay_nonce).toBeGreaterThan(0);
    });

    it('Spotlight stays off the card until the auto-cut is set up', () => {
        face('hitvisualizer');
        expect(screen.getByRole('button', { name: /Replay/ })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Spotlight/ })).not.toBeInTheDocument();
        cleanup();
        useSettingsStore.setState({ production: { ...withContainers(), spotlight: { enabled: true } } });
        face('hitvisualizer');
        expect(screen.getByRole('button', { name: /Spotlight/ })).toBeInTheDocument();
    });

    it('the matchup card picks a match and fetches it, with Clear left to the stage', () => {
        useStateStore.setState({ match: { 1: { participants: {} }, 2: { participants: {} } } });
        face('matchuphistory');
        expect(screen.getByRole('combobox')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Fetch' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useStagingStore } from '../../context/staging';
import { ELEMENTS } from './elements';
import { QuickFace } from './quickface';
import { SEEDED_CONTAINER_DEFS, withContainers } from '../../test/containers';

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
 * gets the direct face instead (see placementFlavor in ./placements), which is
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
    const entry = Object.entries(SEEDED_CONTAINER_DEFS)
        .find(([, d]) => d.members?.includes(id));
    return entry ? entry[0] : null;
}

/*
 * A rail card is the producer's one-glance control. A fed card that can only
 * re-push what the stage last picked is dead weight on its own — Stats ships
 * pinned by default, so its card has to be able to choose.
 */
describe('fed quick faces', () => {
    it('a pickable element offers its content choices on the card', () => {
        useStateStore.setState({
            score: {
                1: {
                    player: {
                        1: { msb_team: 'Mario', character: [{ name: 'Mario' }, { name: 'Luigi' }] },
                        2: { msb_team: 'Wario', character: [{ name: 'Wario' }] },
                    },
                },
            },
        });
        ui('stats');
        const select = screen.getByRole('combobox');
        const labels = [...select.options].map(o => o.textContent);
        // Grouped options flatten to "Team — Character" so one row can carry them.
        expect(labels).toContain('Mario — Luigi');
        expect(labels).toContain('Wario — Wario');
        // Off air there is no feed to clear, so no "Nothing fed" option.
        expect(labels).not.toContain('Nothing fed');
        // …and a Push button to air the armed pick.
        expect(screen.getByRole('button', { name: /Push/ })).toBeInTheDocument();
    });

    it('picking arms the card without airing it — Push is a separate act', () => {
        useStateStore.setState({
            score: { 1: { player: { 1: { msb_team: 'Mario', character: [{ name: 'Mario' }] } } } },
        });
        ui('stats');
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '1:0' } });
        // Armed, not aired: the intent records the pick, the container stays empty.
        expect(useStateStore.getState()?.production?.feed?.last?.stats)
            .toMatchObject({ element: 'stats', team: 1, charIndex: 0 });
        expect(useStateStore.getState()?.production?.feed?.container).toBeUndefined();
        // Push airs it.
        fireEvent.click(screen.getByRole('button', { name: /Push/ }));
        const feed = useStateStore.getState()?.production?.feed?.container;
        expect(Object.values(feed ?? {})[0]).toMatchObject({ element: 'stats', team: 1, charIndex: 0 });
    });

    it('says why there is nothing to pick rather than showing an empty select', () => {
        ui('stats');
        expect(screen.getByText(/No roster in live state yet/)).toBeInTheDocument();
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
        expect(screen.getByRole('switch')).toBeInTheDocument();
    });
});

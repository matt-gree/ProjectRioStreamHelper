import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { ELEMENTS, isPinnable, quickFaceFor } from './elements';
import { RAIL_SEED, seededRail } from './rack';
import { Rail } from './rail';
import { withContainers } from '../../test/containers';

const SB = 'http://x/layout/scoreboard1/scoreboard.html';
const item = (id, sourceName, url, enabled = false) =>
    ({ id, sourceName, url, enabled, inputKind: 'browser_source', isGroup: false, isPrsh: true });

// An OBS mirror. The rail resolves a pin against real placements, exactly as
// the rack does, so its tests need scenes to resolve into.
const obs = (sceneItems, extra = {}) => useObsStore.setState({
    status: 'connected',
    programScene: Object.keys(sceneItems)[0] ?? null,
    scenes: Object.keys(sceneItems),
    mirroredScenes: Object.keys(sceneItems),
    sceneItems,
    ...extra,
});

beforeEach(() => useSettingsStore.setState({ scoreboards: {}, production: withContainers() }));
afterEach(() => {
    cleanup();
    useObsStore.setState({
        status: 'disconnected', studioMode: false, programScene: null,
        previewScene: null, sceneItems: {}, scenes: [], mirroredScenes: [],
    });
});

const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

describe('rail seeding', () => {
    it('seeds a never-touched rail and leaves a deliberately emptied one empty', () => {
        expect(seededRail(null)).toEqual(RAIL_SEED);
        expect(seededRail([])).toEqual([]);
        expect(seededRail(['stats'])).toEqual(['stats']);
    });

    it('only seeds elements that are actually pinnable', () => {
        for (const id of RAIL_SEED) {
            const el = ELEMENTS.find(e => e.id === id);
            expect(el, `seed names a real element: ${id}`).toBeTruthy();
            expect(isPinnable(el), `seeded element is pinnable: ${id}`).toBe(true);
            expect(quickFaceFor(el).rows.length).toBeLessThanOrEqual(2);
        }
    });
});

describe('Rail', () => {
    const noop = () => {};

    it('explains how to fill an empty rail instead of showing a blank column', () => {
        ui(<Rail pins={[]} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(screen.getByText(/Nothing pinned/)).toBeInTheDocument();
    });

    it('renders a card per pin, in the producer’s order, and never re-sorts', () => {
        const pins = ['stats', 'scoreboard'];
        ui(<Rail pins={pins} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        const titles = [...document.querySelectorAll('header')]
            .map(h => h.querySelector('button').textContent);
        expect(titles).toEqual(['Stats', 'Scoreboard']);
    });

    it('drops a pin naming an element that no longer exists', () => {
        ui(<Rail pins={['scoreboard', 'gone-in-a-later-build']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(document.querySelectorAll('header').length).toBe(1);
    });

    it('opens a card on the stage and unpins from its header', () => {
        const onOpen = vi.fn();
        const onUnpin = vi.fn();
        ui(<Rail pins={['scoreboard']} onReorder={noop} onUnpin={onUnpin} onOpen={onOpen} />);
        fireEvent.click(screen.getByText('Scoreboard'));
        // Acted on as STORED, not as resolved: reorder and unpin address the
        // producer's array, so a pin written before instances existed must not
        // become un-removable the moment it renders as scoreboard:1.
        expect(onOpen).toHaveBeenCalledWith('scoreboard');
        fireEvent.click(screen.getByRole('button', { name: 'Unpin from quick rail' }));
        expect(onUnpin).toHaveBeenCalledWith('scoreboard');
    });

    /*
     * A pin carries a board AND a scene now; the card's chip, its quick face and
     * the rack row it came from are all one placement. A card flying the Game
     * scene's copy while showing the Break scene's state would be one card
     * disagreeing with itself.
     */
    it('titles a card by its board once there is more than one to tell apart', () => {
        obs({ Game: [item(1, 'A', `${SB}?scoreboard=1`), item(2, 'B', `${SB}?scoreboard=2`)] });
        ui(<Rail pins={['scoreboard:2@Game']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(screen.getByText('Scoreboard · Scoreboard 2')).toBeInTheDocument();
    });

    it('flies the scene the pin names, not whichever copy comes first', () => {
        obs({ Game: [item(1, 'Game SB', SB, true)], Break: [item(9, 'Break SB', SB, false)] },
            { mirroredScenes: ['Game', 'Break'] });
        ui(<Rail pins={['scoreboard@Break']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        // Off-air scene: the chip is OFF and the row names the scene, so the
        // producer can see it is staging Break rather than driving air.
        expect(document.querySelector('[data-chip-state]').getAttribute('data-chip-state')).toBe('off');
        expect(screen.getByText('In Break')).toBeInTheDocument();
    });

    it('resolves a pin written before scenes were the axis to the copy nearest air', () => {
        obs({ Game: [item(1, 'SB', SB, true)] });
        ui(<Rail pins={['scoreboard']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(screen.getByText('On air')).toBeInTheDocument();
    });

    it('keeps a card for a pin with no source rather than dropping it', () => {
        // The alternative is a card silently vanishing from the rail mid-event
        // because someone deleted a source — or, as here, because OBS is not
        // connected. The pin is the producer's, so it degrades to a sourceless
        // card that states only what we actually know.
        ui(<Rail pins={['scoreboard:9@Nowhere']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(document.querySelectorAll('header').length).toBe(1);
        expect(screen.getByText(/Not in any scene we can see/)).toBeInTheDocument();
    });
});

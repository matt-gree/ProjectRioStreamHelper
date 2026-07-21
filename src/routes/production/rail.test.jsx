import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useSettingsStore } from '../../context/store';
import { ELEMENTS, isPinnable, quickFaceFor } from './elements';
import { RAIL_SEED, seededRail } from './rack';
import { Rail } from './rail';

beforeEach(() => useSettingsStore.setState({ scoreboards: {}, production: {} }));
afterEach(cleanup);

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
     * Instances on the rail. A pin carries a board now; the card's chip, its
     * quick face and the rack row it came from are all one instance.
     */
    it('titles a card by its board once there is more than one to tell apart', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui(<Rail pins={['scoreboard:2']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(screen.getByText('Scoreboard · Scoreboard 2')).toBeInTheDocument();
    });

    it('renders a pre-instance pin as the element’s first instance', () => {
        useSettingsStore.setState({ scoreboards: { active: [1, 2] } });
        ui(<Rail pins={['scoreboard']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(screen.getByText('Scoreboard · Scoreboard 1')).toBeInTheDocument();
    });

    it('keeps a card for a pin whose board has since been removed', () => {
        // The alternative is a card silently vanishing from the rail mid-event
        // because someone edited the active boards.
        useSettingsStore.setState({ scoreboards: { active: [1] } });
        ui(<Rail pins={['scoreboard:9']} onReorder={noop} onUnpin={noop} onOpen={noop} />);
        expect(document.querySelectorAll('header').length).toBe(1);
    });
});

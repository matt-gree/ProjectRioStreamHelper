import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useStateStore, useBracketStore } from '../../context/store';
import Competition from './competition';

/*
 * The Competition tab is ONE page about one loaded event.
 *
 * It was two pages behind a segmented control — "Info & Entrants" and
 * "Bracket" — both views of the same event, which made a producer choose
 * between the event's facts and the event's sets, and bundled the competition
 * form in with the entrants table. The form is a fixed left column now and the
 * switch chooses which LIST fills the right one.
 */

beforeEach(() => {
    // Shaped like the real endpoints: `/phases` answers a list, `/entrants` a
    // page envelope. A bare [] here made the entrants fetch throw on
    // `pageInfo.page`, which is the stub being wrong, not the component.
    global.fetch = vi.fn(async (url) => ({
        ok: true,
        json: async () => (String(url).includes('/entrants')
            ? { entrants: [], pageInfo: { page: 1, totalPages: 0 } }
            : []),
    }));
    useStateStore.setState({ tournamentInfo: {} });
    useBracketStore.setState({
        entrants: [], entrantsPage: 1, entrantsTotalPages: 0, entrantsLoadedFor: null,
        phases: [], allSets: [], setsByKey: {}, tournament: null, url: '',
        selectedPhase: null, selectedPool: null, includeFinished: false,
    });
});
afterEach(() => {
    cleanup();
    delete global.fetch;
});

const ui = () => render(<TooltipProvider><Competition /></TooltipProvider>);

const loaded = () => useStateStore.setState({
    tournamentInfo: { bracket_link: 'https://start.gg/tournament/x/event/y' },
});

describe('Competition — one page, one event', () => {
    it('always shows the competition form', () => {
        ui();
        expect(screen.getByText('Competition Info')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Enter competition name')).toBeInTheDocument();
    });

    /*
     * The right column exists only once there is an event to list, and the
     * "nothing loaded" sentence is said ONCE for both lists — each view used to
     * carry its own copy, so an empty page could print it twice.
     */
    it('offers no list and one empty note until an event is loaded', () => {
        ui();
        expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
        // Not "above": the loader sits in the left column beside this space, not
        // in a row over it.
        expect(screen.getAllByText(/Load a start\.gg event to see/)).toHaveLength(1);
    });

    it('switches the right column between the two lists, keeping the form', () => {
        loaded();
        const { container } = ui();
        const shown = () => container.querySelector('[data-list][data-active]')?.dataset.list;

        // Entrants first — setup-time work comes before run-time.
        expect(screen.getByRole('radio', { name: 'Entrants' })).toHaveAttribute('aria-checked', 'true');
        expect(shown()).toBe('entrants');

        fireEvent.click(screen.getByRole('radio', { name: 'Sets' }));
        expect(shown()).toBe('sets');

        // The form is on screen for BOTH lists, which it never was behind the
        // old page-level switch.
        expect(screen.getByPlaceholderText('Enter competition name')).toBeInTheDocument();
    });

    // Both stay mounted so switching doesn't refetch or drop in-progress edits.
    it('keeps both lists mounted across a switch', () => {
        loaded();
        const { container } = ui();
        const mounted = () => container.querySelectorAll('[data-list]').length;
        expect(mounted()).toBe(2);
        fireEvent.click(screen.getByRole('radio', { name: 'Sets' }));
        expect(mounted()).toBe(2);
    });
});

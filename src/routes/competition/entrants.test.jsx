import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { useStateStore, useBracketStore } from '../../context/store';
import { useParticipantsStore } from '../../context/participants';
import EntrantsPanel from './entrants';

/*
 * THE ENTRANTS TABLE ASKS ONE QUESTION: is this entrant set up to appear on the
 * broadcast? These pin the four columns that answer it, and the absence of the
 * Address Book's own fields — which the import still carries across, they are
 * just not this page's to print.
 */

const entrant = (id, over = {}) => ({
    id,
    seed: id,
    name: `Tag${id}`,
    players: [{
        gamerTag: `Tag${id}`, prefix: '', userId: 100 + id,
        full_name: `Full Name ${id}`, pronoun: 'they/them',
        country: 'United States', state: 'MI',
        ...over,
    }],
});

const bookRow = (userId, rioName) => ({
    id: `p${userId}`,
    identities: { rioName, startgg: { userId } },
    display: { tag: `Tag${userId - 100}` },
});

beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
    useStateStore.setState({ tournamentInfo: { bracket_link: 'https://start.gg/x' } });
    useBracketStore.setState({
        entrants: [], entrantsPage: 1, entrantsTotalPages: 0,
        entrantsLoadedFor: 'https://start.gg/x',
    });
    useParticipantsStore.setState({ participants: [], loaded: true, loading: false });
});
afterEach(() => {
    cleanup();
    delete global.fetch;
});

const ui = () => render(<TooltipProvider><EntrantsPanel /></TooltipProvider>);

describe('Entrants table — the mapping surface, not a profile dump', () => {
    it('carries only the columns a producer acts on', () => {
        useBracketStore.setState({ entrants: [entrant(1)] });
        ui();
        const headers = screen.getAllByRole('columnheader').map(h => h.textContent.replace(/[▲▼]/g, ''));
        expect(headers).toEqual(['Seed', 'Player', 'Address Book', 'Rio ID']);
    });

    /*
     * These live in the Address Book — the import copies them there
     * (`sg_to_display`, server/participants.py) whether or not this page draws
     * them, so printing them here was four columns of read-only duplicate.
     */
    it('leaves name, pronouns and location to the Address Book', () => {
        useBracketStore.setState({ entrants: [entrant(1)] });
        ui();
        expect(screen.queryByText('Full Name 1')).not.toBeInTheDocument();
        expect(screen.queryByText('they/them')).not.toBeInTheDocument();
        expect(screen.queryByText('United States')).not.toBeInTheDocument();
        expect(screen.queryByText('MI')).not.toBeInTheDocument();
    });

    // A sponsor prefix identifies nobody a producer is looking for, and it was
    // costing a column. It still imports into the Address Book.
    it('shows the tag alone, never the sponsor prefix', () => {
        useBracketStore.setState({ entrants: [entrant(1, { prefix: 'PRSH' })] });
        ui();
        const cell = screen.getByText('Tag1').closest('td');
        expect(within(cell).queryByText('PRSH')).not.toBeInTheDocument();
    });

    it('states each entrant\'s link state', () => {
        useBracketStore.setState({ entrants: [entrant(1), entrant(2), entrant(3)] });
        useParticipantsStore.setState({
            participants: [bookRow(102, ''), bookRow(103, 'rio_three')],
        });
        ui();
        expect(screen.getByText('Not in book')).toBeInTheDocument();  // 1
        expect(screen.getByText('Needs Rio ID')).toBeInTheDocument(); // 2
        expect(screen.getByText('Mapped')).toBeInTheDocument();       // 3
    });

    /*
     * A chip per row is only useful while the rows differ — on a fully mapped
     * field it draws a column of colour saying the one thing that needs no
     * attention. The done state is a dot; the work keeps its chip.
     */
    it('gives a chip to the rows that need work and not to the done ones', () => {
        useBracketStore.setState({ entrants: [entrant(1), entrant(2)] });
        useParticipantsStore.setState({ participants: [bookRow(102, 'rio_two')] });
        ui();
        expect(screen.getByText('Not in book').closest('[data-slot="badge"]')).toBeTruthy();
        expect(screen.getByText('Mapped').closest('[data-slot="badge"]')).toBeNull();
    });

    /*
     * Per-row colour answers "is this one done"; nothing answered "am I done",
     * which is the question the list is opened with.
     */
    it('says how much of the field is still unmapped', () => {
        useBracketStore.setState({ entrants: [entrant(1), entrant(2)] });
        useParticipantsStore.setState({ participants: [bookRow(102, 'rio_two')] });
        ui();
        expect(screen.getByText(/2 entrants · 1 mapped · 1 still need a Rio ID/)).toBeInTheDocument();
    });

    it('drops the remainder clause once every entrant is mapped', () => {
        useBracketStore.setState({ entrants: [entrant(1)] });
        useParticipantsStore.setState({ participants: [bookRow(101, 'rio_one')] });
        ui();
        expect(screen.getByText(/1 entrants · 1 mapped/)).toBeInTheDocument();
        expect(screen.queryByText(/still need a Rio ID/)).not.toBeInTheDocument();
    });
});

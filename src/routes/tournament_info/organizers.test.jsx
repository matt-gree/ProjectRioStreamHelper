import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useStateStore } from '../../context/store';

/*
 * Organizers on the Competition tab: three address-book references, replacing
 * three trios of free text.
 *
 * The first case is the regression that matters. The rows read nine projected
 * keys plus the authored list, which invites a `useShallow` selector that builds
 * an array of slot objects — a new reference every call, never shallow-equal,
 * and the tab dies with React error #185 (maximum update depth). It shipped that
 * way in a browser once; the tests were all green, because nothing rendered it.
 */

vi.mock('../../context/organizers', async (importOriginal) => ({
    ...(await importOriginal()),
    setOrganizers: vi.fn(async () => ({ success: true })),
}));

const { setOrganizers } = await import('../../context/organizers');
const { OrganizerRows } = await import('./tournament_info');

beforeEach(() => {
    useStateStore.setState({ tournamentInfo: {} });
    setOrganizers.mockClear();
});
afterEach(cleanup);

const ui = () => render(<OrganizerRows />);

describe('OrganizerRows', () => {
    it('renders three slots without re-rendering itself to death', () => {
        ui();
        for (const n of [1, 2, 3]) {
            expect(screen.getByText(`Organizer ${n}`)).toBeInTheDocument();
        }
    });

    it('shows the picked person and their address-book details', () => {
        useStateStore.setState({
            tournamentInfo: {
                organizers: [{ participantId: 'p_1' }],
                organizer_0_name: 'Grump',
                organizer_0_twitter: '@grump',
                organizer_0_pronoun: 'he/him',
            },
        });
        ui();
        expect(screen.getByText('Grump')).toBeInTheDocument();
        expect(screen.getByText('@grump · he/him')).toBeInTheDocument();
    });

    /*
     * An ABSENT authored list is legacy hand-typed text the projector
     * deliberately doesn't own (server/organizers.py). The producer gets one
     * warning that picking anyone takes ownership of all three.
     */
    it('warns while there is legacy text to lose, and not afterwards', () => {
        useStateStore.setState({ tournamentInfo: { organizer_0_name: 'Typed By Hand' } });
        const { rerender } = ui();
        expect(screen.getByText(/Picking anyone here replaces all three/)).toBeInTheDocument();

        useStateStore.setState({
            tournamentInfo: { organizers: [{ participantId: 'p_1' }], organizer_0_name: 'Grump' },
        });
        rerender(<OrganizerRows />);
        expect(screen.queryByText(/Picking anyone here replaces all three/)).not.toBeInTheDocument();
        expect(screen.getByText(/come from the Address Book/)).toBeInTheDocument();
    });

    /*
     * The write is the whole (≤3) list, matching the server's one verb — so a
     * clear has to preserve the other two slots rather than send its own index.
     */
    it('clears one slot without dropping the others', async () => {
        useStateStore.setState({
            tournamentInfo: {
                organizers: [{ participantId: 'p_1' }, { participantId: 'p_2' }],
                organizer_0_name: 'Grump',
                organizer_1_name: 'Dyla',
            },
        });
        ui();
        fireEvent.click(screen.getByLabelText('Clear organizer 1'));
        await waitFor(() => expect(setOrganizers).toHaveBeenCalledWith([
            { participantId: null },
            { participantId: 'p_2' },
            { participantId: null },
        ]));
    });

    it('offers no clear on an empty slot', () => {
        ui();
        expect(screen.queryByLabelText('Clear organizer 1')).not.toBeInTheDocument();
    });
});

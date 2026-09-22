import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useParticipantsStore } from '../../../context/participants';
import { DraftSide } from './fields';

/*
 * A PERSON WITH NO RIO ID IS STILL A PICK, AND IT MUST LOOK LIKE ONE.
 *
 * The side stores `rioName: ''` for them, and the card used to show only the
 * live rioName — so a committed pick drew the "Pick participant…" placeholder,
 * as if the selection had not taken. It now shows the person, and says the
 * Rio ID is missing, because live games join on it.
 */
const draftFor = (player, staged = {}) => ({
    match: { player: { 1: player } },
    val: (path, live) => (path in staged ? staged[path] : live),
    isStaged: (path) => path in staged,
    setField: () => {},
});

const ui = (draft) => render(
    <MemoryRouter>
        <TooltipProvider><DraftSide m={1} side={1} draft={draft} /></TooltipProvider>
    </MemoryRouter>,
);

beforeEach(() => useParticipantsStore.setState({
    loaded: true,
    participants: [
        { id: 'p1', book: 'main', identities: { rioName: '' }, display: { tag: 'Joan' } },
        { id: 'p2', book: 'main', identities: { rioName: 'MattGree' }, display: { tag: 'Matt' } },
    ],
}));
afterEach(cleanup);

describe('a side picked without a Rio ID', () => {
    it('names the person instead of showing the empty placeholder', () => {
        ui(draftFor({ participantId: 'p1', rioName: '' }));
        expect(screen.getByText('Joan')).toBeInTheDocument();
        expect(screen.queryByText('Pick participant…')).not.toBeInTheDocument();
    });

    it('warns, and points at the Address Book', () => {
        ui(draftFor({ participantId: 'p1', rioName: '' }));
        expect(screen.getByText(/No Rio ID/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Address Book/ })).toHaveAttribute('href', '/player_list');
    });

    it('warns on a STAGED pick too', () => {
        ui(draftFor({}, { 'player.1.pick': { participantId: 'p1', rioName: '', _name: 'Joan' } }));
        expect(screen.getByText(/No Rio ID/)).toBeInTheDocument();
    });

    it('says nothing when the person has one', () => {
        ui(draftFor({ participantId: 'p2', rioName: 'MattGree' }));
        expect(screen.queryByText(/No Rio ID/)).not.toBeInTheDocument();
    });

    it('says nothing when no one is picked', () => {
        ui(draftFor({}));
        expect(screen.getByText('Pick participant…')).toBeInTheDocument();
        expect(screen.queryByText(/No Rio ID/)).not.toBeInTheDocument();
    });
});

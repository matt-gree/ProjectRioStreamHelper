import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { useParticipantsStore } from '../../../context/participants';
import { Stage } from './index';

// The desk's one write. Everything else in the module is the real thing — the
// sub-field vocabulary and the value resolver are what's under test.
const put = vi.fn(() => Promise.resolve());
vi.mock('../../../context/commentary', async (orig) => ({
    ...(await orig()),
    setCommentarySlots: (...a) => put(...a),
}));

const person = (id, tag, display = {}, rioName = tag) => ({
    id, identities: { rioName, startgg: null },
    display: { tag, prefix: '', fullName: '', pronoun: '', country: '', state: '', twitter: '', youtube: '', ...display },
    prefs: { side: null },
});

beforeEach(() => {
    vi.stubGlobal('localStorage', {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    put.mockClear();
    useSettingsStore.setState({ overlays: {}, scoreboards: {}, production: {} });
    useStagingStore.setState({ pending: {}, order: [] });
    useParticipantsStore.setState({
        loaded: true, loading: false,
        participants: [
            person('p_matt', 'MattGree', { twitter: '@mattgree', fullName: 'Matthew Greene' }),
            person('p_jo', 'PeacockSlayer', { youtube: 'PeacockSlayerTV' }),
            person('p_guest', 'Guest', {}, ''),
        ],
    });
    useStateStore.setState({
        commentary: {
            slots: [
                // A slot written while the sub-plate had a switch of its own:
                // a field, switched off.
                { participantId: 'p_guest', subField: 'rioName', visible: false, subVisible: false },
                { participantId: 'p_matt', subField: 'twitter', visible: true, subVisible: true },
                { participantId: 'p_jo', subField: 'pronoun', visible: true, subVisible: true },
                { participantId: null, subField: '', visible: true, subVisible: true },
            ],
            0: { name: 'Guest' }, 1: { name: 'MattGree' }, 2: { name: 'PeacockSlayer' },
        },
    });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(
    <MemoryRouter><TooltipProvider><Stage selection="commentary" /></TooltipProvider></MemoryRouter>,
);
const lastPut = () => put.mock.calls.at(-1)[0];

describe('Commentary stage', () => {
    /*
     * The strip compacts: a hidden or unnamed seat is not a hole. A row number
     * would call MattGree "2" while he is the leftmost plate on air.
     */
    it('numbers each row by the plate it draws, not by its index', () => {
        ui();
        const plates = screen.getAllByTitle(/Plate \d on the strip|not on the strip|draws nothing/);
        expect(plates.map(p => p.textContent)).toEqual(['–', '1', '2', '–']);
        expect(plates[0]).toHaveAttribute('title', 'Hidden — not on the strip');
        expect(plates[3]).toHaveAttribute('title', 'No caster picked — this seat draws nothing');
    });

    it('shows what the chosen sub-plate field will say', () => {
        ui();
        const field = screen.getByRole('combobox', { name: 'Caster 2 sub-plate' });
        expect(field).toHaveTextContent('Twitter');
        expect(field).toHaveTextContent('@mattgree');
    });

    /*
     * The strip drops a drawer whose value is empty, so a field picked blind is
     * a sub-plate that silently never draws. The closed control has to say so.
     */
    it('flags a chosen field this person has left empty', () => {
        ui();
        const field = screen.getByRole('combobox', { name: 'Caster 3 sub-plate' });
        expect(field).toHaveTextContent('Empty');
        expect(field).toHaveAttribute('title', expect.stringMatching(/PeacockSlayer has no pronouns/));
    });

    it('does not cry wolf on a seat with nobody picked', () => {
        ui();
        const field = screen.getByRole('combobox', { name: 'Caster 4 sub-plate' });
        expect(field).toHaveTextContent('No sub-plate');
        expect(field).not.toHaveTextContent('Empty');
    });

    it('lists every field with its value, marks the empty ones, and picks one', async () => {
        const user = userEvent.setup();
        ui();
        await user.click(screen.getByRole('combobox', { name: 'Caster 3 sub-plate' }));
        const list = within(screen.getByRole('listbox'));
        expect(list.getByRole('option', { name: /YouTube\s*PeacockSlayerTV/ })).toBeInTheDocument();
        expect(list.getByRole('option', { name: /Pronouns\s*empty/ })).toBeInTheDocument();
        // An empty field is still pickable — the book may be filled in later —
        // and the list says where that happens.
        expect(screen.getByRole('link', { name: 'Address Book' })).toHaveAttribute('href', '/player_list');

        await user.click(list.getByRole('option', { name: /YouTube/ }));
        expect(lastPut()[2]).toEqual({
            participantId: 'p_jo', subField: 'youtube', visible: true, subVisible: true,
        });
    });

    it('clears the sub-plate from the same list', async () => {
        const user = userEvent.setup();
        ui();
        await user.click(screen.getByRole('combobox', { name: 'Caster 2 sub-plate' }));
        await user.click(screen.getByRole('option', { name: /No sub-plate/ }));
        expect(lastPut()[1].subField).toBe('');
    });

    it('switches a caster on and off air', async () => {
        const user = userEvent.setup();
        ui();
        await user.click(screen.getByRole('switch', { name: 'Caster 2 on air' }));
        expect(lastPut()[1].visible).toBe(false);
    });

    // The picker is the sub-plate's only control, so there is no second switch
    // that could leave a named field silently off.
    it('has no separate sub-plate switch', () => {
        ui();
        expect(screen.queryByRole('switch', { name: /sub-plate/ })).not.toBeInTheDocument();
    });

    it('reads a field left switched off as no sub-plate, and a pick turns it back on', async () => {
        const user = userEvent.setup();
        ui();
        const field = screen.getByRole('combobox', { name: 'Caster 1 sub-plate' });
        expect(field).toHaveTextContent('No sub-plate');

        await user.click(field);
        await user.click(screen.getByRole('option', { name: /Rio Name/ }));
        expect(lastPut()[0]).toMatchObject({ subField: 'rioName', subVisible: true });
    });

    it('reorders seats with the arrows', async () => {
        const user = userEvent.setup();
        ui();
        await user.click(screen.getByLabelText('Move caster 2 up'));
        expect(lastPut().map(s => s.participantId)).toEqual(['p_matt', 'p_guest', 'p_jo', null]);
    });

    /*
     * The desk is the strip's four seats, always: the on-air switch is the only
     * way off, so there is nothing to add and nothing to delete.
     */
    it('always shows four seats, with no add or remove', () => {
        ui();
        expect(screen.getAllByRole('switch', { name: /on air$/ })).toHaveLength(4);
        expect(screen.queryByRole('button', { name: /Add commentator/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    });

    it('pads a shorter stored desk to four, and writes all four back', async () => {
        useStateStore.setState({
            commentary: {
                slots: [{ participantId: 'p_matt', subField: '', visible: true, subVisible: true }],
                0: { name: 'MattGree' },
            },
        });
        const user = userEvent.setup();
        ui();
        expect(screen.getAllByRole('switch', { name: /on air$/ })).toHaveLength(4);

        // Filling an empty seat is what adding a caster is now — and they go
        // straight on air, because a blank seat is left switched on.
        await user.click(screen.getByRole('switch', { name: 'Caster 1 on air' }));
        expect(lastPut()).toHaveLength(4);
        expect(lastPut()[0].visible).toBe(false);
        expect(lastPut()[3]).toEqual({ participantId: null, subField: '', visible: true, subVisible: true });
    });
});

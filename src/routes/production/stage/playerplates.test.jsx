import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { useStagingStore } from '../../../context/staging';
import { useParticipantsStore } from '../../../context/participants';
import { Stage } from './index';

// The band's one write. Normalization, the anchor rule and the sub-field
// vocabulary are the real thing.
const put = vi.fn(() => Promise.resolve());
vi.mock('../../../context/playerplates', async (orig) => ({
    ...(await orig()),
    setPlayerPlatesConfig: (...a) => put(...a),
}));

const person = (id, tag, display = {}) => ({
    id, identities: { rioName: tag, startgg: null },
    display: { tag, prefix: '', fullName: '', pronoun: '', country: '', state: '', twitter: '', youtube: '', ...display },
    prefs: { side: null },
});

const side = (over = {}) => ({
    participantId: null, name: '', subField: '', subLabel: '', subValue: '',
    visible: true, subVisible: true, location: 'left', ...over,
});

const setConfig = (config) => useStateStore.setState({
    match: {
        1: {
            player: {
                1: { participantId: 'p_rjb', rioName: 'rjb' },
                // Named only by rioName, as a fixture built before the book was.
                2: { participantId: null, rioName: 'mattgree' },
            },
        },
    },
    playerplates: { config },
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
            person('p_rjb', 'rjb', { twitter: '@rjb_msb' }),
            person('p_matt', 'MattGree', { fullName: 'Matt Greene' }),
        ],
    });
    setConfig({
        source: 'match', matchId: 1,
        sides: {
            1: side({ subField: 'twitter', location: 'left' }),
            2: side({ subField: 'pronoun', location: 'right' }),
        },
    });
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const ui = () => render(
    <MemoryRouter><TooltipProvider><Stage selection="playerplates" /></TooltipProvider></MemoryRouter>,
);
const lastPut = () => put.mock.calls.at(-1)[0];
const cards = () => screen.getAllByRole('region', { name: /plate$/ }).map(c => c.getAttribute('aria-label'));
const card = (name) => within(screen.getByRole('region', { name }));

describe('Player Plates stage', () => {
    it('names each match-fed plate from the fixture, read-only', () => {
        ui();
        expect(card('Side 1 plate').getByText('rjb')).toBeInTheDocument();
        // Resolved through the book by rioName, case and all, as the projector does.
        expect(card('Side 2 plate').getByText('MattGree')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Pick side/ })).not.toBeInTheDocument();
    });

    it('shows each sub-plate field with what it will say, and flags an empty one', () => {
        ui();
        expect(card('Side 1 plate').getByRole('combobox', { name: 'Side 1 sub-plate' }))
            .toHaveTextContent('@rjb_msb');
        const empty = card('Side 2 plate').getByRole('combobox', { name: 'Side 2 sub-plate' });
        expect(empty).toHaveTextContent('Empty');
    });

    /*
     * Where the cards sit is where the plates sit: side 1 on the right puts its
     * card on the right, and the swap between them is the whole order control.
     */
    it('lays the cards out in on-air order, and the swap flips both anchors', async () => {
        const user = userEvent.setup();
        ui();
        expect(cards()).toEqual(['Side 1 plate', 'Side 2 plate']);
        await user.click(screen.getByRole('button', { name: 'Swap plates' }));
        expect(lastPut().sides[1].location).toBe('right');
        expect(lastPut().sides[2].location).toBe('left');

        cleanup();
        setConfig({ ...lastPut() });
        ui();
        expect(cards()).toEqual(['Side 2 plate', 'Side 1 plate']);
    });

    it('turns a plate off air from its own switch', async () => {
        const user = userEvent.setup();
        ui();
        await user.click(screen.getByRole('switch', { name: 'Side 2 plate on air' }));
        expect(lastPut().sides[2].visible).toBe(false);
    });

    /*
     * One plate up has no partner to be ordered against, so the swap stands
     * down and that plate gets its own position — including the middle.
     */
    it('gives a lone plate its own position and no swap', async () => {
        setConfig({
            source: 'match', matchId: 1,
            sides: { 1: side({ location: 'left' }), 2: side({ visible: false, location: 'right' }) },
        });
        const user = userEvent.setup();
        ui();
        expect(screen.getByRole('button', { name: 'Swap plates' })).toBeDisabled();
        expect(card('Side 2 plate').getByText('Hidden')).toBeInTheDocument();
        expect(card('Side 2 plate').queryByRole('radiogroup', { name: 'Side 2 position' })).not.toBeInTheDocument();

        await user.click(card('Side 1 plate').getByRole('radio', { name: 'Center' }));
        expect(lastPut().sides[1].location).toBe('center');
    });

    it('says when a shown plate has no name and so draws nothing', () => {
        setConfig({ source: 'match', matchId: null, sides: { 1: side(), 2: side({ location: 'right' }) } });
        ui();
        expect(card('Side 1 plate').getByText('No name — nothing draws')).toBeInTheDocument();
        expect(card('Side 1 plate').getByText('Pick a match above')).toBeInTheDocument();
    });

    // The picker is the sub-plate's only control, exactly as on the caster desk.
    it('has no separate sub-plate toggle, and a pick turns a switched-off one back on', async () => {
        setConfig({
            source: 'match', matchId: 1,
            sides: {
                1: side({ subField: 'twitter', subVisible: false }),
                2: side({ location: 'right' }),
            },
        });
        const user = userEvent.setup();
        ui();
        expect(screen.queryByRole('switch', { name: /sub-plate/ })).not.toBeInTheDocument();
        const field = screen.getByRole('combobox', { name: 'Side 1 sub-plate' });
        expect(field).toHaveTextContent('No sub-plate');

        await user.click(field);
        await user.click(screen.getByRole('option', { name: /Twitter/ }));
        expect(lastPut().sides[1]).toMatchObject({ subField: 'twitter', subVisible: true });
    });

    it('picks a manual plate from the book, and types the sub-plate only for a guest', async () => {
        setConfig({
            source: 'manual', matchId: null,
            sides: {
                1: side({ participantId: 'p_matt', subField: 'fullName' }),
                2: side({ name: 'Guest Player', location: 'right' }),
            },
        });
        const user = userEvent.setup();
        ui();
        expect(card('Side 1 plate').getByRole('combobox', { name: 'Side 1 sub-plate' }))
            .toHaveTextContent('Matt Greene');

        // Nothing to resolve for a typed name, so its sub-plate is typed too.
        expect(card('Side 2 plate').queryByRole('combobox', { name: 'Side 2 sub-plate' })).not.toBeInTheDocument();
        await user.type(card('Side 2 plate').getByLabelText('Side 2 sub value'), 'Chicago');
        await user.tab();
        expect(lastPut().sides[2]).toMatchObject({ subValue: 'Chicago', subVisible: true });
    });
});

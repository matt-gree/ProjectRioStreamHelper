import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useStateStore } from '../../../context/store';
import { ELEMENTS } from '../elements';
import { ReadinessNote } from './generic';

afterEach(() => {
    cleanup();
    useStateStore.setState({ score: {} }, true);
});

const el = (id) => ELEMENTS.find(e => e.id === id);
const withPlayers = (board, p1, p2) => useStateStore.setState({
    score: { [board]: { player: { 1: { rioName: p1 }, 2: { rioName: p2 } } } },
}, true);

/*
 * A scoreboard with no player names hides itself, which is correct on air and
 * indistinguishable from a broken overlay anywhere else. This note is the only
 * place a producer is told why without opening the browser source's dev tools.
 *
 * The predicate is mirrored in `blankReason` (public/layout/lib/scoreboard-
 * mount.js) — different runtimes, no shared module. These tests pin the state
 * keys so the two cannot drift silently.
 */
describe('ReadinessNote', () => {
    it('explains the blank when the board has no player names', () => {
        withPlayers(1, '', '');
        render(<ReadinessNote element={el('scoreboard')} board={1} />);
        expect(screen.getByText(/no player names yet/i)).toBeInTheDocument();
    });

    it('says nothing once either side has a name', () => {
        withPlayers(1, 'Baltor33', '');
        const { container } = render(<ReadinessNote element={el('scoreboard')} board={1} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('reads the board it was given, not board 1', () => {
        useStateStore.setState({
            score: {
                1: { player: { 1: { rioName: 'Someone' }, 2: { rioName: 'Else' } } },
                2: { player: { 1: { rioName: '' }, 2: { rioName: '' } } },
            },
        }, true);
        render(<ReadinessNote element={el('scoreboard')} board={2} />);
        expect(screen.getByText(/scoreboard 2 has no player names/i)).toBeInTheDocument();
    });

    it('warns for a board with no state at all', () => {
        render(<ReadinessNote element={el('scoreboard')} board={9} />);
        expect(screen.getByText(/no player names yet/i)).toBeInTheDocument();
    });

    // A Lower Third has no board, so it has no board-readiness to report — the
    // note must not invent one.
    it('stays silent for elements that are not board-scoped', () => {
        withPlayers(1, '', '');
        const { container } = render(<ReadinessNote element={el('lowerthird')} board={1} />);
        expect(container).toBeEmptyDOMElement();
    });
});
